import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "validation_error"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "business_rule"
  // Un recurso que existió y ya no sirve, como un enlace de un solo uso ya
  // canjeado o caducado. No es un 404: el cliente tiene que ofrecer pedir otro.
  | "gone"
  // Demasiadas peticiones seguidas. Se responde pidiendo esperar, nunca en
  // silencio (RF-6 de E2).
  | "rate_limited"
  | "method_not_allowed"
  | "service_unavailable"
  | "internal_error";

export type ApiSuccessStatus = 200 | 201;

export type ApiSuccessBody<T> = { readonly data: T };

export type ApiErrorBody = {
  readonly error: { readonly code: ApiErrorCode; readonly message: string };
};

const HTTP_STATUS_BY_ERROR_CODE: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  business_rule: 422,
  gone: 410,
  rate_limited: 429,
  method_not_allowed: 405,
  service_unavailable: 503,
  internal_error: 500,
};

const DEFAULT_SUCCESS_STATUS: ApiSuccessStatus = 200;

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export function apiSuccess<T>(
  data: T,
  status: ApiSuccessStatus = DEFAULT_SUCCESS_STATUS,
): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ data }, { status });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message } },
    { status: HTTP_STATUS_BY_ERROR_CODE[code] },
  );
}
