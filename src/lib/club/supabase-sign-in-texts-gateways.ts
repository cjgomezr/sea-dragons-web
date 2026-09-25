import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import {
  type SignInTextRow,
  type SignInTexts,
  type SignInTextsGateways,
  toSignInTexts,
} from "./sign-in-texts";

/**
 * Adaptador entre los textos del inicio de sesión (#301) y Supabase.
 *
 * Va por la llave de servicio: `0028_club_sign_in_texts.sql` no deja escribir
 * a nadie más. El servidor ya comprobó que quien pide es Admin, y cada
 * consulta filtra por su club.
 */

const SIGN_IN_TEXTS_TABLE = "club_sign_in_texts";
const TEXT_COLUMNS = "locale, tagline, welcome";

type Environment = Readonly<Record<string, string | undefined>>;

async function findSignInTexts(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<SignInTexts> {
  const { data, error } = await serviceClient
    .from(SIGN_IN_TEXTS_TABLE)
    .select(TEXT_COLUMNS)
    .eq("club_id", clubId)
    .overrideTypes<SignInTextRow[], { merge: false }>();
  if (error) {
    throw new Error(
      `No se pudieron leer los textos del inicio de sesión del club ${clubId}: ${error.message}`,
    );
  }
  return toSignInTexts(data);
}

/** Los dos idiomas en un solo `upsert`, que es una sola sentencia: o quedan
 * los dos o ninguno. Un idioma sin textos se queda con su fila en nulos. */
async function replaceSignInTexts(
  serviceClient: SupabaseClient,
  clubId: string,
  texts: SignInTexts,
): Promise<SignInTexts> {
  const rows = SUPPORTED_LOCALES.map((locale) => ({
    club_id: clubId,
    locale,
    ...texts[locale],
  }));
  const { data, error } = await serviceClient
    .from(SIGN_IN_TEXTS_TABLE)
    .upsert(rows, { onConflict: "club_id,locale" })
    .select(TEXT_COLUMNS)
    .overrideTypes<SignInTextRow[], { merge: false }>();
  if (error) {
    throw new Error(
      `No se pudieron guardar los textos del inicio de sesión del club ${clubId}: ${error.message}`,
    );
  }
  return toSignInTexts(data);
}

export function createSignInTextsGateways(
  serviceClient: SupabaseClient,
): SignInTextsGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    signInTexts: {
      findSignInTexts: (clubId) => findSignInTexts(serviceClient, clubId),
      replaceSignInTexts: (clubId, texts) =>
        replaceSignInTexts(serviceClient, clubId, texts),
    },
    audit: createSupabaseAuditLogWriter(serviceClient),
  };
}

export type SignInTextsGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: SignInTextsGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseSignInTextsGateways(
  env: Environment,
): SignInTextsGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createSignInTextsGateways(createServiceRoleClient(env)),
  };
}
