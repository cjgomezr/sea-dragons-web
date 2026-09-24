import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuditLogWriter } from "@/lib/audit/audit-log";
import { readText } from "@/lib/auth/supabase-auth-gateways";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { ClubLogoGateways, ClubLogoWrite } from "./club-logo";
import { isDecodableLogo } from "./decode-club-logo";

/**
 * Adaptador entre el logo del club (#295) y Supabase.
 *
 * Todo va por la llave de servicio: `0024_club_logos.sql` no deja a ninguna
 * sesión escribir en el bucket, y `0022_club_brand.sql` tampoco en `clubs`.
 * El servidor ya comprobó que quien pide es Admin, y cada escritura filtra
 * por su club.
 */

export const CLUB_LOGO_BUCKET = "club-logos";

const CLUBS_TABLE = "clubs";

type Environment = Readonly<Record<string, string | undefined>>;

/** La dirección pública del logo. No llama a nadie: el bucket es público y la
 * dirección se deduce de la ruta. */
export function readClubLogoUrl(
  client: SupabaseClient,
  path: string | null,
): string | null {
  return path === null
    ? null
    : client.storage.from(CLUB_LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function findLogoPath(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from(CLUBS_TABLE)
    .select("logo_path")
    .eq("id", clubId)
    .single<Record<string, unknown>>();
  if (error) {
    throw new Error(
      `No se pudo leer el logo del club ${clubId}: ${error.message}`,
    );
  }
  return readText(data, "logo_path", CLUBS_TABLE);
}

/** Sin fila de vuelta, alguien cambió el logo entretanto: el club no
 * desaparece, porque quien llama es miembro suyo. */
async function saveLogoPath(
  serviceClient: SupabaseClient,
  clubId: string,
  write: { readonly expected: string | null; readonly path: string | null },
): Promise<ClubLogoWrite> {
  const update = serviceClient
    .from(CLUBS_TABLE)
    .update({ logo_path: write.path })
    .eq("id", clubId);
  const matchingRow =
    write.expected === null
      ? update.is("logo_path", null)
      : update.eq("logo_path", write.expected);
  const { data, error } = await matchingRow.select("id").maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo apuntar el logo del club ${clubId}: ${error.message}`,
    );
  }
  return data === null ? { kind: "changed_meanwhile" } : { kind: "saved" };
}

function createLogoStorage(
  serviceClient: SupabaseClient,
): ClubLogoGateways["storage"] {
  const bucket = (): ReturnType<SupabaseClient["storage"]["from"]> =>
    serviceClient.storage.from(CLUB_LOGO_BUCKET);
  return {
    async upload(path, bytes, type) {
      const { error } = await bucket().upload(path, bytes, {
        contentType: type,
        upsert: false,
      });
      if (error) {
        throw new Error(`No se pudo subir el logo ${path}: ${error.message}`);
      }
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) {
        throw new Error(`No se pudo borrar el logo ${path}: ${error.message}`);
      }
    },
    publicUrl: (path) => bucket().getPublicUrl(path).data.publicUrl,
  };
}

export function createClubLogoGateways(
  serviceClient: SupabaseClient,
): ClubLogoGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    logos: {
      findLogoPath: (clubId) => findLogoPath(serviceClient, clubId),
      saveLogoPath: (clubId, write) =>
        saveLogoPath(serviceClient, clubId, write),
    },
    storage: createLogoStorage(serviceClient),
    images: { isDecodable: isDecodableLogo },
    audit: createSupabaseAuditLogWriter(serviceClient),
    newFileId: randomUUID,
  };
}

export type ClubLogoGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ClubLogoGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseClubLogoGateways(
  env: Environment,
): ClubLogoGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createClubLogoGateways(createServiceRoleClient(env)),
  };
}
