//! One transport error envelope, including router and request-extractor failures.
use super::*;
use crate::contracts::HttpErrorResponse;
use axum::{
    body::{Body, to_bytes},
    http::HeaderValue,
};

pub(super) fn status_code(status: StatusCode) -> &'static str {
    match status.as_u16() {
        400 => "INVALID_REQUEST",
        401 => "UNAUTHENTICATED",
        403 => "FORBIDDEN",
        404 => "NOT_FOUND",
        405 => "METHOD_NOT_ALLOWED",
        408 => "REQUEST_TIMEOUT",
        409 => "CONFLICT",
        413 => "PAYLOAD_TOO_LARGE",
        415 => "UNSUPPORTED_MEDIA_TYPE",
        422 => "VALIDATION_FAILED",
        429 => "RATE_LIMITED",
        502 => "UPSTREAM_UNAVAILABLE",
        503 => "SERVICE_UNAVAILABLE",
        504 => "UPSTREAM_TIMEOUT",
        500..=599 => "INTERNAL_ERROR",
        _ => "REQUEST_FAILED",
    }
}
fn default_message(status: StatusCode) -> &'static str {
    match status.as_u16() {
        401 => "设备未配对、已过期或已撤销",
        403 => "没有执行该操作的权限",
        404 => "请求的接口或记录不存在",
        405 => "该接口不支持此请求方法",
        413 => "请求内容超过大小限制",
        415 => "请求需要使用application/json内容类型",
        422 => "请求字段类型或格式不符合要求",
        429 => "请求过于频繁，请稍后重试",
        500..=599 => "主机暂时无法完成请求，请检查连接或诊断",
        _ => "请求格式无效，请检查输入后重试",
    }
}
pub(super) async fn normalize(request: axum::extract::Request, next: Next) -> Response {
    let path = request.uri().path();
    let is_api = path == "/v1" || path.starts_with("/v1/");
    let response = next.run(request).await;
    if !is_api {
        return response;
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let (mut parts, body) = response.into_parts();
    parts.headers.insert(
        "x-vibeone-request-id",
        HeaderValue::from_str(&request_id).expect("generated UUID"),
    );
    if !parts.status.is_client_error() && !parts.status.is_server_error() {
        return Response::from_parts(parts, body);
    }
    let bytes = to_bytes(body, 64 * 1024).await.ok();
    let original = bytes
        .as_deref()
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok());
    let existing = original
        .as_ref()
        .and_then(|value| value["code"].as_str())
        .filter(|code| !code.is_empty() && code.len() <= 128 && code.is_ascii());
    let error = original
        .as_ref()
        .and_then(|value| value["error"].as_str())
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| default_message(parts.status));
    let envelope = HttpErrorResponse {
        code: existing.unwrap_or_else(|| status_code(parts.status)).into(),
        error: error.chars().take(4000).collect(),
        status: parts.status.as_u16(),
        request_id,
    };
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.remove(header::CONTENT_ENCODING);
    parts.headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    parts
        .headers
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Response::from_parts(
        parts,
        Body::from(serde_json::to_vec(&envelope).expect("error DTO")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn server_failure_preserves_retry_headers_but_not_uncontracted_fields() {
        let router = Router::new()
            .route(
                "/v1/failure",
                get(|| async {
                    (
                        StatusCode::SERVICE_UNAVAILABLE,
                        [("retry-after", "2")],
                        Json(json!({"error":"fixture failure","private":"must not forward"})),
                    )
                }),
            )
            .layer(middleware::from_fn(normalize));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket
            .write_all(b"GET /v1/failure HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(3), socket.read_to_end(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        task.abort();
        let _ = task.await;
        let response = String::from_utf8(bytes).unwrap();
        let (headers, body) = response.split_once("\r\n\r\n").unwrap();
        assert!(headers.starts_with("HTTP/1.1 503"));
        assert!(headers.contains("retry-after: 2"));
        let error: Value = serde_json::from_str(body).unwrap();
        assert_eq!(error["code"], "SERVICE_UNAVAILABLE");
        assert_eq!(error["error"], "fixture failure");
        assert_eq!(error["status"], 503);
        assert!(error.get("private").is_none());
        assert!(headers.contains(error["requestId"].as_str().unwrap()));
    }
}
