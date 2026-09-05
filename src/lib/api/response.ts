import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "validation_error"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "business_rule"
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
