import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { DecorateApiResponse } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { MemberNotFoundError } from "./account-activation";
import { AccountAlreadyResolvedError } from "./complete-registration";
import { readAuthenticatedUserId } from "./session-reader";
import {
  type SupabaseAuthGateways,
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "./supabase-auth-gateways";
import {
  applySessionCookies,
  createSessionClient,
  readIncomingCookies,
} from "@/lib/supabase/session-client";

/**
 * Lo que comparten los endpoints de la cuenta de quien llama: completar el
 * registro y registrar el consentimiento del tutor.
 *
 * Los dos actúan siempre sobre la cuenta que identifica la cookie de sesión,
 * nunca sobre un id que venga en el cuerpo. Es lo que impide usarlos para
 * escribir en la fila de otra persona, y es la misma garantía para la
 * aplicación móvil de Release 2 (CON-002).
 */

const NO_SESSION_MESSAGE =
  "Necesitas iniciar sesión para consultar o completar tu cuenta.";
const NO_MEMBER_MESSAGE =
  "Tu sesión no corresponde a ningún socio del club. Escribe al club para que la revisen.";

type AccountCallerArgs = {
  readonly request: NextRequest;
  readonly decorateResponse: (decorate: DecorateApiResponse) => void;
};

/** Quién llama y el cliente de su sesión, para los endpoints que leen con la
 * RLS de quien llama en vez de con la llave de servicio. */
export type AccountSession = {
  readonly userId: string;
  readonly client: SupabaseClient;
};

/** Quién está pidiendo, según su cookie de sesión, junto al cliente que la
 * lleva. Las cookies que Supabase emita al validarla se apuntan en la
 * respuesta: perderlas es el fallo clásico de este patrón. */
export async function openAccountSession(
  args: AccountCallerArgs,
): Promise<AccountSession> {
  const session = createSessionClient(
    process.env,
    readIncomingCookies(args.request),
  );
  if (session.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(session.missingKeys),
    );
  }
  args.decorateResponse((response) =>
    applySessionCookies(response, session.recorder),
  );

  const userId = await readAuthenticatedUserId(session.client);
  if (userId === null) {
    throw new ApiError("unauthenticated", NO_SESSION_MESSAGE);
  }
  return { userId, client: session.client };
}

/** Sólo el id de quien pide, para los endpoints que después leen o escriben
 * con la llave de servicio, acotados a ese id. */
export async function identifyAccountCaller(
  args: AccountCallerArgs,
): Promise<string> {
  return (await openAccountSession(args)).userId;
}

export function requireAuthGateways(): SupabaseAuthGateways {
  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

/** Los errores de cuenta que los dos endpoints responden igual. Lo que no
 * reconoce se relanza: un fallo de la base no puede salir disfrazado de
 * petición mal hecha. */
export function asAccountApiError(error: unknown): never {
  if (error instanceof MemberNotFoundError) {
    throw new ApiError("forbidden", NO_MEMBER_MESSAGE);
  }
  if (error instanceof AccountAlreadyResolvedError) {
    throw new ApiError("conflict", error.message);
  }
  throw error;
}
