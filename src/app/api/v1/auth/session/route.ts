import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { signIn } from "@/lib/auth/sign-in";
import {
  type SessionGatewaysResult,
  createSupabaseSessionGateways,
} from "@/lib/auth/supabase-session-gateways";
import { readIncomingCookies } from "@/lib/supabase/session-client";

/**
 * La sesión como recurso: se crea con POST y se tira con DELETE. Es el mismo
 * endpoint que consumirá la aplicación móvil de Release 2 (CON-002), así que
 * no asume que quien llama es la web propia.
 *
 * Es uno de los dos endpoints públicos de la API (ver `src/lib/auth/routes.ts`):
 * exigir sesión para pedir una sesión dejaría la aplicación sin puerta.
 */

// Depende de la sesión de quien llama y escribe cookies: no hay respuesta que
// una caché pueda reutilizar sin filtrar la sesión de alguien.
export const dynamic = "force-dynamic";

/** Sólo la forma del cuerpo. Que las credenciales valgan no lo dice un
 * esquema, y el mensaje de que no valen es el mismo para todos los casos. */
const signInBodySchema = z.object({
  email: z.string(),
  password: z.string(),
});

type SignInBody = z.infer<typeof signInBodySchema>;

/** A dónde mandar a quien acaba de entrar: el panel principal, o completar
 * registro si su cuenta sigue `incomplete`. Lo decide el servidor, que es
 * quien sabe el estado de la cuenta. */
export type SignInResponse = { readonly destination: string };

export type SignOutResponse = { readonly signedOut: true };

const SERVICE_UNAVAILABLE_MESSAGE_PREFIX =
  "El servicio de cuentas no está configurado: faltan";

function requireGateways(
  wiring: SessionGatewaysResult,
): Extract<SessionGatewaysResult, { kind: "ready" }> {
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      `${SERVICE_UNAVAILABLE_MESSAGE_PREFIX} ${wiring.missingKeys.join(", ")}.`,
    );
  }
  return wiring;
}

const postSession = createApiRoute<SignInResponse, SignInBody>({
  schema: signInBodySchema,
  handler: async ({ request, body, decorateResponse }) => {
    const wiring = requireGateways(
      createSupabaseSessionGateways(process.env, readIncomingCookies(request)),
    );
    // Se registra antes de hablar con Supabase a propósito: un rechazo sale de
    // aquí lanzando, y las cookies que Supabase emita (incluido el borrado de
    // la sesión que se acaba de descartar) tienen que viajar igual.
    decorateResponse(wiring.applyCookies);

    const outcome = await signIn(wiring.gateways, body);
    if (outcome.kind === "rejected") {
      throw new ApiError(
        outcome.reason === "invalid_credentials"
          ? "unauthenticated"
          : "forbidden",
        outcome.message,
      );
    }
    return { data: { destination: outcome.destination } };
  },
});

const deleteSession = createApiRoute<SignOutResponse>({
  handler: async ({ request, decorateResponse }) => {
    const wiring = requireGateways(
      createSupabaseSessionGateways(process.env, readIncomingCookies(request)),
    );
    decorateResponse(wiring.applyCookies);

    await wiring.signOut();
    return { data: { signedOut: true } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postSession,
  DELETE: deleteSession,
});
