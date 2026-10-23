import { NextResponse } from "next/server";
import type { ApiErrorCode } from "./error-codes";

export type { ApiErrorCode };
export { MEMBERSHIP_NOT_CURRENT_REASON } from "./error-codes";

export type ApiSuccessStatus = 200 | 201;

export type ApiSuccessBody<T> = { readonly data: T };

/** `reason` sólo aparece cuando un mismo código cubre casos que quien llama
 * tiene que explicar distinto, y es tan estable como el código: la pantalla
 * lo traduce, igual que traduce el código. */
export type ApiErrorBody = {
  readonly error: ApiErrorDetails & {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly reason?: string;
  };
};

/** Lo que un error lleva además de su código para que quien llama pueda
 * actuar, como el socio que ya tiene un correo (#861). Va dentro de `error`,
 * junto al código, y nunca lo pisa. */
export type ApiErrorDetails = Readonly<Record<string, unknown>>;

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
  bad_gateway: 502,
  internal_error: 500,
};

const DEFAULT_SUCCESS_STATUS: ApiSuccessStatus = 200;

export const NO_CONTENT_STATUS = 204;

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

/** Un error con datos para quien llama, además del motivo que lo distingue. */
export class ApiErrorWithDetails extends ApiError {
  readonly details: ApiErrorDetails;

  constructor(
    code: ApiErrorCode,
    message: string,
    {
      reason,
      details,
    }: { readonly reason: string; readonly details: ApiErrorDetails },
  ) {
    super(code, message, reason);
    this.name = "ApiErrorWithDetails";
    this.details = details;
  }
}

export function apiSuccess<T>(
  data: T,
  status: ApiSuccessStatus = DEFAULT_SUCCESS_STATUS,
): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ data }, { status });
}

/** Lo que responde una operación que salió bien y no tiene nada que devolver,
 * como un borrado. Un 204 no lleva cuerpo, ni siquiera `{ data }`. */
export function apiNoContent(): NextResponse<null> {
  return new NextResponse(null, { status: NO_CONTENT_STATUS });
}

/** Un archivo para descargar, como el CSV del directorio (#500). Sale tal
 * cual, sin `{ data }`: quien lo pide lo guarda, no lo lee. */
export type ApiFile = {
  readonly body: string;
  readonly contentType: string;
  /** Sin comillas ni caracteres fuera de ASCII: va dentro de la cabecera sin
   * codificar. */
  readonly filename: string;
};

/** El cuerpo de un archivo, para tipar la respuesta que lo lleva. */
export type ApiFileBody = string;

export function apiFile(file: ApiFile): NextResponse<ApiFileBody> {
  return new NextResponse<ApiFileBody>(file.body, {
    status: DEFAULT_SUCCESS_STATUS,
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      // Lleva datos personales (el CSV del directorio): que no se quede una
      // copia en ninguna caché por el camino.
      "cache-control": "no-store",
    },
  });
}

/** Una redirección a otra dirección, como la firmada de una imagen del
 * cuerpo de una noticia (#603): un `<img>` sigue la redirección, pero no
 * puede leer un `{ data }`. */
export type ApiRedirect = {
  readonly url: string;
  /** Cuánto la puede guardar el navegador de quien la pidió, y nadie más:
   * depende de su sesión. */
  readonly maxAgeSeconds: number;
};

const REDIRECT_STATUS = 302;

export function apiRedirect(redirect: ApiRedirect): NextResponse<null> {
  return new NextResponse(null, {
    status: REDIRECT_STATUS,
    headers: {
      location: redirect.url,
      "cache-control": `private, max-age=${redirect.maxAgeSeconds}`,
    },
  });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  reason?: string,
): NextResponse<ApiErrorBody> {
  return apiErrorFrom(new ApiError(code, message, reason));
}

/** La respuesta de un `ApiError`, con los datos que lleve. */
export function apiErrorFrom(error: ApiError): NextResponse<ApiErrorBody> {
  const details = error instanceof ApiErrorWithDetails ? error.details : {};
  const { code, message, reason } = error;
  return NextResponse.json(
    {
      error: {
        ...details,
        code,
        message,
        ...(reason === undefined ? {} : { reason }),
      },
    },
    { status: HTTP_STATUS_BY_ERROR_CODE[code] },
  );
}
