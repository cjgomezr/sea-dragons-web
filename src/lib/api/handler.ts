import type { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import {
  ApiError,
  type ApiErrorBody,
  type ApiSuccessBody,
  type ApiSuccessStatus,
  apiError,
  apiSuccess,
} from "./response";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const UNEXPECTED_ERROR_MESSAGE =
  "Ocurrió un error inesperado. Intenta de nuevo más tarde.";
const METHOD_NOT_ALLOWED_MESSAGE = "Método no soportado para este endpoint.";
const NOT_FOUND_MESSAGE = "El endpoint solicitado no existe.";
const INVALID_JSON_MESSAGE = "El cuerpo de la petición no es JSON válido.";

export type ApiResponseBody<T> = ApiSuccessBody<T> | ApiErrorBody;
export type ApiRouteHandler<T> = (
  request: NextRequest,
) => Promise<NextResponse<ApiResponseBody<T>>>;

type ApiHandlerResult<T> = {
  readonly data: T;
  readonly status?: ApiSuccessStatus;
};
type ApiHandlerArgs<Body> = {
  readonly request: NextRequest;
  readonly body: Body;
};
type ApiHandlerFn<T, Body> = (
  args: ApiHandlerArgs<Body>,
) => Promise<ApiHandlerResult<T>>;

type ApiRouteConfig<T, Body> = {
  readonly schema?: ZodType<Body>;
  readonly handler: ApiHandlerFn<T, Body>;
};

type BodyParseResult<Body> =
  | { readonly ok: true; readonly body: Body }
  | { readonly ok: false; readonly response: NextResponse<ApiErrorBody> };

function describeInvalidField(issuePath: readonly PropertyKey[]): string {
  return issuePath.length > 0 ? issuePath.map(String).join(".") : "(cuerpo)";
}

async function readValidatedBody<Body>(
  request: NextRequest,
  schema: ZodType<Body> | undefined,
): Promise<BodyParseResult<Body>> {
  if (!schema) {
    return { ok: true, body: undefined as Body };
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError("validation_error", INVALID_JSON_MESSAGE),
    };
  }

  const result = schema.safeParse(rawBody);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => describeInvalidField(issue.path))
      .join(", ");
    return {
      ok: false,
      response: apiError("validation_error", `Campos inválidos: ${fields}.`),
    };
  }

  return { ok: true, body: result.data };
}

/** Envoltorio único de los handlers de la API v1: valida entrada, envuelve la
 * respuesta en `{ data }` o `{ error }` y nunca deja escapar una excepción ni
 * un mensaje de la base de datos hacia el cliente. */
export function createApiRoute<T, Body = undefined>(
  config: ApiRouteConfig<T, Body>,
): ApiRouteHandler<T> {
  return async function handleRequest(request) {
    try {
      const parsedBody = await readValidatedBody(request, config.schema);
      if (!parsedBody.ok) {
        return parsedBody.response;
      }

      const result = await config.handler({ request, body: parsedBody.body });
      return apiSuccess(result.data, result.status);
    } catch (error) {
      if (error instanceof ApiError) {
        return apiError(error.code, error.message);
      }
      console.error("[api/v1] unhandled error", error);
      return apiError("internal_error", UNEXPECTED_ERROR_MESSAGE);
    }
  };
}

type ApiModule = Record<
  HttpMethod,
  (request: NextRequest) => Promise<NextResponse>
>;

async function respondMethodNotAllowed(): Promise<NextResponse<ApiErrorBody>> {
  return apiError("method_not_allowed", METHOD_NOT_ALLOWED_MESSAGE);
}

async function respondNotFound(): Promise<NextResponse<ApiErrorBody>> {
  return apiError("not_found", NOT_FOUND_MESSAGE);
}

/** Completa un route.ts con los métodos HTTP que el endpoint no implementa,
 * para que respondan 405 con la forma de error en lugar de la página por
 * defecto de Next. */
export function createApiModule(handlers: Partial<ApiModule>): ApiModule {
  return HTTP_METHODS.reduce<ApiModule>((module, method) => {
    module[method] = handlers[method] ?? respondMethodNotAllowed;
    return module;
  }, {} as ApiModule);
}

/** Módulo para el catch-all de `/api/v1`: cualquier método sobre una ruta
 * inexistente responde 404 con la forma de error de la convención. */
export function createNotFoundModule(): ApiModule {
  return HTTP_METHODS.reduce<ApiModule>((module, method) => {
    module[method] = respondNotFound;
    return module;
  }, {} as ApiModule);
}
