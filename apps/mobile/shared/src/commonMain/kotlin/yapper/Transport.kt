package yapper

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.URLProtocol
import io.ktor.http.Url
import io.ktor.http.contentType
import io.ktor.http.encodedPath
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal expect fun createHttpClient(configure: HttpClientConfig<*>.() -> Unit): HttpClient

internal val wire = Json { ignoreUnknownKeys = true; explicitNulls = false }

internal class ServerError(val code: String, val status: Int = 0) : Exception(code)

internal fun serverOrigin(input: String, allowLoopback: Boolean): String {
    val text = input.trim()
    if (text.isEmpty() || text.any { it.isWhitespace() || it == '\\' }) throw ServerError("invalid_server")
    val url = runCatching { Url(if ("://" in text) text else "https://$text") }
        .getOrElse { throw ServerError("invalid_server") }
    val loopback = url.host in setOf("localhost", "127.0.0.1", "[::1]", "::1")
    if (url.host.isBlank() || url.user != null || url.password != null || url.encodedPath !in setOf("", "/") ||
        !url.parameters.isEmpty() || url.trailingQuery || url.fragment.isNotEmpty() || '#' in text ||
        (url.protocol != URLProtocol.HTTPS && !(allowLoopback && loopback && url.protocol == URLProtocol.HTTP))
    ) throw ServerError("invalid_server")
    val host = url.host.lowercase().let { if (':' in it && !it.startsWith("[")) "[$it]" else it }
    val port = if (url.port == url.protocol.defaultPort) "" else ":${url.port}"
    return "${url.protocol.name}://$host$port"
}

internal interface MobileTransport {
    suspend fun request(
        origin: String,
        path: String,
        payload: JsonElement? = null,
        cookie: String? = null,
        bearer: String? = null,
        methodOverride: HttpMethod? = null,
    ): Reply

    suspend fun events(origin: String, ticket: String, event: suspend (Event) -> Unit)
    fun close()
}

internal data class Reply(val body: String, val cookies: List<String> = emptyList())

internal class Transport : MobileTransport {
    private val http = createHttpClient {
        followRedirects = false
        install(HttpTimeout) { requestTimeoutMillis = 12_000 }
        install(WebSockets)
    }

    override suspend fun request(
        origin: String,
        path: String,
        payload: JsonElement?,
        cookie: String?,
        bearer: String?,
        methodOverride: HttpMethod?,
    ): Reply {
        val response = http.request(origin + path) {
            method = methodOverride ?: if (payload == null) HttpMethod.Get else HttpMethod.Post
            header(HttpHeaders.Origin, origin)
            if (cookie != null) header(HttpHeaders.Cookie, cookie)
            if (bearer != null) header(HttpHeaders.Authorization, "Bearer $bearer")
            if (payload != null) {
                contentType(ContentType.Application.Json)
                setBody(payload.toString())
            }
        }
        val body = response.bodyAsText()
        if (response.status.value !in 200..299) {
            val code = runCatching { wire.parseToJsonElement(body).jsonObject["code"]?.jsonPrimitive?.content }
                .getOrNull()
            throw ServerError(code ?: "service_unavailable", response.status.value)
        }
        return Reply(body, response.headers.getAll(HttpHeaders.SetCookie).orEmpty())
    }

    override suspend fun events(origin: String, ticket: String, event: suspend (Event) -> Unit) {
        val address = origin.replaceFirst("http", "ws") + "/api/v1/events"
        http.webSocket(address, request = {
            header(HttpHeaders.Origin, origin)
            header(HttpHeaders.SecWebSocketProtocol, "yapper.v1, yapper.ticket.$ticket")
        }) {
            for (frame in incoming) {
                val data = (frame as? Frame.Text)?.readText() ?: continue
                val envelope = runCatching { wire.decodeFromString<Event>(data) }.getOrNull()
                if (envelope?.version == 1) event(envelope)
            }
            if (closeReason.await()?.code?.toInt() == 4001) throw ServerError("kicked", 403)
        }
    }

    override fun close() = http.close()
}
