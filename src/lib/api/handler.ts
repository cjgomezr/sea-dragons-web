import type { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { describeErrorWithoutEmail } from "@/lib/email/redact-email";
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
/** Una modificación que la respuesta de la ruta tiene que llevar pase lo que
 * pase, también si el handler termina lanzando. El caso que la pide es el
 * endpoint de la sesión: las cookies que Supabase emite al cerrar sesión o al
 * rechazar unas credenciales viajan en una respuesta de error, y sin esto se
 * perderían justo cuando importa. */
export type DecorateApiResponse = (response: NextResponse) => void;

type ApiHandlerArgs<Body> = {
  readonly request: NextRequest;
  readonly body: Body;
  readonly decorateResponse: (decorate: DecorateApiResponse) => void;
};
type ApiHandlerFn<T, Body> = (
  args: ApiHandlerArgs<Body>,
) => Promise<ApiHandlerResult<T>>;

/** Los campos del cuerpo que son texto. Sólo esos pueden declararse como el
 * del correo: si se pudiera señalar un booleano, no habría nada que redactar y
 * la protección se apagaría sin que nadie se enterara. */
type StringFieldOf<Body> = {
  [K in keyof Body]-?: Body[K] extends string ? K : never;
}[keyof Body] &
  string;

type ApiRouteConfig<T, Body> = {
  readonly schema?: ZodType<Body>;
  /** Qué campo del cuerpo trae una dirección de correo, cuando la ruta recibe
   * una. El envoltorio la quita de lo que registra si el handler lanza: se la
   * pasa a Supabase y a Resend antes de responder, y los mensajes de esos
   * proveedores a veces la citan. */
  readonly emailField?: StringFieldOf<Body>;
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

/** La dirección que llegó en el cuerpo, si la ruta declaró cuál es su campo.
 * Sin campo declarado no hay nada que quitar del registro. */
function readEmailField<Body>(
  body: Body,
  emailField: StringFieldOf<Body> | undefined,
): string | undefined {
  if (emailField === undefined || typeof body !== "object" || body === null) {
    return undefined;
  }
  const value = body[emailField];
  return typeof value === "string" ? value : undefined;
}

/** El error listo para el registro del servidor: sin la dirección cuando la
 * petición trajo una, y tal cual cuando no hay ninguna que quitar, para que el
 * registro conserve el objeto con su pila. */
function describeUnhandledError(
  error: unknown,
  email: string | undefined,
): unknown {
  return email === undefined ? error : describeErrorWithoutEmail(error, email);
}

/** Envoltorio único de los handlers de la API v1: valida entrada, envuelve la
 * respuesta en `{ data }` o `{ error }` y nunca deja escapar una excepción ni
 * un mensaje de la base de datos hacia el cliente. */
export function createApiRoute<T, Body = undefined>(
  config: ApiRouteConfig<T, Body>,
): ApiRouteHandler<T> {
  return async function handleRequest(request) {
    const decorations: DecorateApiResponse[] = [];
    function decorated<R extends NextResponse>(response: R): R {
      for (const decorate of decorations) {
        decorate(response);
      }
      return response;
    }

    // Fuera del try porque el catch la necesita, y el cuerpo se lee una sola
    // vez: la petición no se puede volver a leer para averiguarla después.
    let requestEmail: string | undefined;

    try {
      const parsedBody = await readValidatedBody(request, config.schema);
      if (!parsedBody.ok) {
        return decorated(parsedBody.response);
      }
      requestEmail = readEmailField(parsedBody.body, config.emailField);

      const result = await config.handler({
        request,
        body: parsedBody.body,
        decorateResponse: (decorate) => {
          decorations.push(decorate);
        },
      });
      return decorated(apiSuccess(result.data, result.status));
    } catch (error) {
      if (error instanceof ApiError) {
        return decorated(apiError(error.code, error.message, error.reason));
      }
      console.error(
        "[api/v1] unhandled error",
        describeUnhandledError(error, requestEmail),
      );
      return decorated(apiError("internal_error", UNEXPECTED_ERROR_MESSAGE));
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
