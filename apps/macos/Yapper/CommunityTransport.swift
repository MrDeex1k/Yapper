import Foundation

struct ServiceError: Error {
    let code: String
    var status = 0
    init(_ code: String, status: Int = 0) { self.code = code; self.status = status }
}

final class CommunityTransport: NSObject, URLSessionTaskDelegate {
    private(set) lazy var http: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 12
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    static func origin(_ input: String, debugLoopback: Bool) throws -> String {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("\\"), !value.contains(where: \.isWhitespace),
              var parts = URLComponents(string: value.contains("://") ? value : "https://" + value),
              let host = parts.host?.lowercased(), !host.isEmpty, parts.user == nil, parts.password == nil,
              ["", "/"].contains(parts.percentEncodedPath), parts.query == nil, parts.fragment == nil,
              let scheme = parts.scheme?.lowercased(),
              scheme == "https" || (scheme == "http" && debugLoopback && ["localhost", "127.0.0.1", "[::1]"].contains(host))
        else { throw ServiceError("invalid_server") }
        parts.scheme = scheme
        parts.host = host
        parts.path = ""
        if parts.port == (scheme == "https" ? 443 : 80) { parts.port = nil }
        guard let url = parts.url else { throw ServiceError("invalid_server") }
        return url.absoluteString
    }

    func exchange(_ origin: String, _ path: String, body: [String: Any]? = nil, method: String? = nil,
                  cookie: String? = nil, bearer: String? = nil) async throws -> (Data, HTTPURLResponse) {
        guard path.hasPrefix("/api/"), !path.contains(".."), let url = URL(string: origin + path) else {
            throw ServiceError("invalid_request")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method ?? (body == nil ? "GET" : "POST")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        if let bearer { request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await http.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw ServiceError("network_error") }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable { let code: String }
            throw ServiceError((try? JSONDecoder().decode(Failure.self, from: data).code) ?? "service_unavailable", status: response.statusCode)
        }
        return (data, response)
    }

    func events(origin: String, ticket: String) throws -> URLSessionWebSocketTask {
        guard let url = URL(string: "ws" + origin.dropFirst(4) + "/api/v1/events") else { throw ServiceError("invalid_server") }
        var request = URLRequest(url: url)
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue("yapper.v1, yapper.ticket." + ticket, forHTTPHeaderField: "Sec-WebSocket-Protocol")
        return http.webSocketTask(with: request)
    }
}

func pathSegment(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
}
