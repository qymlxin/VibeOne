const codes: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  502: "UPSTREAM_UNAVAILABLE",
  503: "SERVICE_UNAVAILABLE",
  504: "UPSTREAM_TIMEOUT",
};

export interface HostErrorPayload {
  error?: string;
  code?: string;
  requestId?: string;
}

/** 封装工作主机 HTTP 错误响应的结构化异常 */
export class HostRequestError extends Error {
  status: number;
  code: string;
  requestId: string | null;

  constructor(status: number, payload?: HostErrorPayload | null) {
    super(
      typeof payload?.error === "string" && payload.error
        ? payload.error
        : `请求未成功（${status}），请检查主机连接`,
    );
    this.name = "HostRequestError";
    this.status = status;
    this.code =
      typeof payload?.code === "string"
        ? payload.code
        : (codes[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"));
    this.requestId =
      typeof payload?.requestId === "string" ? payload.requestId : null;
  }
}
