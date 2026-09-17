import { NextResponse } from "next/server";
import type { ApiErrorCode } from "./error-codes";

export type { ApiErrorCode };

export type ApiSuccessStatus = 200 | 201;

export type ApiSuccessBody<T> = { readonly data: T };

/** `reason` sólo aparece cuando un mismo código cubre casos que quien llama
 * tiene que explicar distinto, y es tan estable como el código: la pantalla
 * lo traduce, igual que traduce el código. */
export type ApiErrorBody = {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly reason?: string;
  };
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
  readonly reason: string | undefined;

  constructor(code: ApiErrorCode, message: string, reason?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.reason = reason;
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
  reason?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(reason === undefined ? {} : { reason }) } },
    { status: HTTP_STATUS_BY_ERROR_CODE[code] },
  );
}
