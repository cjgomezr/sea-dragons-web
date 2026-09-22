import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAccountStatus } from "@/lib/auth/account-status";
import { readText } from "@/lib/auth/supabase-auth-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type { PhotoOwner, ProfilePhotoGateways } from "./profile-photo";
import { shrinkProfilePhoto } from "./shrink-profile-photo";

/**
 * Adaptador entre la foto de perfil (#245) y Supabase.
 *
 * Usa dos clientes a propósito. El fichero se sube y se borra con la sesión
 * de quien pide, así que las policies de `0018_member_photos.sql` son las que
 * deciden: aunque el servidor calculara mal una ruta, Storage no le dejaría
 * escribir en la carpeta de otro. La ficha se escribe con la llave de
 * servicio, porque `authenticated` no tiene `update` sobre `members`, y las
 * direcciones se firman también con ella: el bucket es privado y nadie lee la
 * carpeta de otro con su sesión.
 */

export const PROFILE_PHOTO_BUCKET = "member-photos";

/** Una hora: lo bastante para que una pantalla abierta no pierda las fotos
 * que ya pidió, y poco para que una dirección copiada sirva de algo. */
export const PROFILE_PHOTO_URL_LIFETIME_SECONDS = 60 * 60;

const MEMBERS_TABLE = "members";

type Environment = Readonly<Record<string, string | undefined>>;

type Row = Record<string, unknown>;

function toPhotoOwner(row: Row): PhotoOwner {
  const status = parseAccountStatus(row.account_status);
  if (status === null) {
    throw new Error(
      `${MEMBERS_TABLE}.account_status devolvió ${String(row.account_status)}, que el catálogo no reconoce.`,
    );
  }
  return { status, photoPath: readText(row, "photo_path", MEMBERS_TABLE) };
}

/** Las direcciones firmadas de varias fotos en una sola llamada, por ruta.
 * La usa también el directorio, que enseña decenas a la vez.
 *
 * Una ruta que Storage no firma (el fichero ya no existe, por ejemplo porque
 * alguien lo borró desde el dashboard) no tumba la lista de todo el club: se
 * registra con su motivo y se deja fuera, y quien la enseña pone las
 * iniciales. Un fallo de la llamada entera sí se lanza. */
export async function signProfilePhotoUrls(
  serviceClient: SupabaseClient,
  photoPaths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (photoPaths.length === 0) {
    return new Map();
  }
  const { data, error } = await serviceClient.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrls([...photoPaths], PROFILE_PHOTO_URL_LIFETIME_SECONDS);
  if (error) {
    throw new Error(`No se pudieron firmar las fotos: ${error.message}`);
  }
  return new Map(
    data.flatMap((signed): [string, string][] => {
      if (
        signed.error !== null ||
        signed.path === null ||
        signed.signedUrl === null
      ) {
        console.error(
          `[profile-photo] no se pudo firmar la foto ${signed.path ?? "(sin ruta)"}: ${signed.error ?? "sin detalle"}`,
        );
        return [];
      }
      return [[signed.path, signed.signedUrl]];
    }),
  );
}

/** Una sola dirección firmada, para quien enseña una sola foto. Null si
 * Storage no la firmó, con el motivo ya registrado. */
export async function signProfilePhotoUrl(
  serviceClient: SupabaseClient,
  photoPath: string,
): Promise<string | null> {
  const signed = await signProfilePhotoUrls(serviceClient, [photoPath]);
  return signed.get(photoPath) ?? null;
}

export function createProfilePhotoGateways(clients: {
  readonly sessionClient: SupabaseClient;
  readonly serviceClient: SupabaseClient;
}): ProfilePhotoGateways {
  const { sessionClient, serviceClient } = clients;
  return {
    members: {
      async findPhotoOwner(userId) {
        const { data, error } = await serviceClient
          .from(MEMBERS_TABLE)
          .select("account_status, photo_path")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `No se pudo leer la foto de ${userId}: ${error.message}`,
          );
        }
        return data === null ? null : toPhotoOwner(data);
      },

      async savePhotoPath(userId, photoPath) {
        const { error } = await serviceClient
          .from(MEMBERS_TABLE)
          .update({ photo_path: photoPath })
          .eq("user_id", userId);
        if (error) {
          throw new Error(
            `No se pudo apuntar la foto de ${userId}: ${error.message}`,
          );
        }
      },
    },
    storage: {
      async upload(photoPath, bytes, type) {
        const { error } = await sessionClient.storage
          .from(PROFILE_PHOTO_BUCKET)
          .upload(photoPath, bytes, { contentType: type, upsert: false });
        if (error) {
          throw new Error(
            `No se pudo subir la foto ${photoPath}: ${error.message}`,
          );
        }
      },

      async remove(photoPath) {
        const { data, error } = await sessionClient.storage
          .from(PROFILE_PHOTO_BUCKET)
          .remove([photoPath]);
        if (error) {
          throw new Error(
            `No se pudo borrar la foto ${photoPath}: ${error.message}`,
          );
        }
        // Storage responde bien aunque la policy no le haya dejado borrar
        // nada: la lista vacía es la única señal de que el fichero sigue ahí.
        if (data.length === 0) {
          throw new Error(`Storage no borró la foto ${photoPath}.`);
        }
      },
    },
    signing: {
      signPhotoUrl: (photoPath) =>
        signProfilePhotoUrl(serviceClient, photoPath),
    },
    images: { shrinkPhoto: shrinkProfilePhoto },
    newFileId: randomUUID,
  };
}

export type ProfilePhotoGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: ProfilePhotoGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. La sesión la trae quien llama, ya
 * validada; aquí sólo falta la llave de servicio. */
export function createSupabaseProfilePhotoGateways(
  env: Environment,
  sessionClient: SupabaseClient,
): ProfilePhotoGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createProfilePhotoGateways({
      sessionClient,
      serviceClient: createServiceRoleClient(env),
    }),
  };
}
