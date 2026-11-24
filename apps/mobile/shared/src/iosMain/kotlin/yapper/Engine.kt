package yapper

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.darwin.Darwin

internal actual fun createHttpClient(configure: HttpClientConfig<*>.() -> Unit): HttpClient =
    HttpClient(Darwin) {
        configure()
        engine {
            configureSession {
                HTTPCookieStorage = null
                HTTPShouldSetCookies = false
            }
        }
    }
