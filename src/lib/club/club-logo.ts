import { type AuditLogWriter, recordAuditEvent } from "@/lib/audit/audit-log";
import type { RoleRequestMember } from "@/lib/auth/role-request";
import { detectProfilePhotoType } from "@/lib/members/profile-photo";
import {
  ClubSettingsConflictError,
  type ClubSettingsGateways,
  findAdministrator,
} from "./club-settings";

/**
 * El logo del club (#295, RF-4 del PRD de E18a), contado sin Supabase
 * delante. El Admin sube un PNG o un WebP de hasta 512 KB, o lo quita; sin
 * logo, la marca vuelve a las iniciales.
 *
 * Sigue a la foto de perfil (`profile-photo.ts`): un nombre nuevo por subida,
 * el anterior se borra sólo cuando el nuevo quedó apuntado. Y a la
 * configuración del club en lo demás: sólo el Admin, la escritura sólo casa
 * si nadie cambió el logo entretanto, y la bitácora nombra el campo.
 */

/** El `file_size_limit` del bucket en `0024_club_logos.sql`. */
export const CLUB_LOGO_MAX_BYTES = 512 * 1024;

/** Sin SVG a propósito: un SVG puede llevar código. */
export const CLUB_LOGO_TYPES = ["image/png", "image/webp"] as const;

export type ClubLogoType = (typeof CLUB_LOGO_TYPES)[number];

export const CLUB_LOGO_ISSUE_CODES = [
  "logo_empty",
  "logo_too_large",
  "logo_type_unsupported",
  "logo_undecodable",
] as const;

export type ClubLogoIssueCode = (typeof CLUB_LOGO_ISSUE_CODES)[number];

/** La dirección pública del logo, o null si el club no tiene. */
export type ClubLogo = { readonly logoUrl: string | null };

export class ClubLogoValidationError extends Error {
  readonly code: ClubLogoIssueCode;

  constructor(code: ClubLogoIssueCode) {
    super(`El logo no vale: ${code}.`);
    this.name = "ClubLogoValidationError";
    this.code = code;
  }
}

export type ClubLogoWrite =
  { readonly kind: "saved" } | { readonly kind: "changed_meanwhile" };

export type ClubLogoGateways = {
  readonly members: ClubSettingsGateways["members"];
  readonly logos: {
    findLogoPath(clubId: string): Promise<string | null>;
    /** Apunta `path` sólo si el club sigue con `expected`, en la misma
     * escritura. */
    saveLogoPath(
      clubId: string,
      write: { readonly expected: string | null; readonly path: string | null },
    ): Promise<ClubLogoWrite>;
  };
  readonly storage: {
    upload(path: string, bytes: Uint8Array, type: ClubLogoType): Promise<void>;
    remove(path: string): Promise<void>;
    publicUrl(path: string): string;
  };
  readonly images: {
    isDecodable(bytes: Uint8Array): Promise<boolean>;
  };
  readonly audit: AuditLogWriter;
  /** El nombre aleatorio del fichero nuevo. Se inyecta para que los tests
   * sepan qué ruta esperar. */
  readonly newFileId: () => string;
};

const FILE_EXTENSIONS: Readonly<Record<ClubLogoType, string>> = {
  "image/png": "png",
  "image/webp": "webp",
};

function isClubLogoType(type: string | null): type is ClubLogoType {
  return CLUB_LOGO_TYPES.some((accepted) => accepted === type);
}

/** Lo que la pantalla puede comprobar antes de subir, con lo que el navegador
 * dice del fichero. El servidor lo vuelve a comprobar con los bytes. */
export function validateClubLogoFile(file: {
  readonly type: string;
  readonly size: number;
}): ClubLogoIssueCode | null {
  if (file.size === 0) {
    return "logo_empty";
  }
  if (!isClubLogoType(file.type)) {
    return "logo_type_unsupported";
  }
  return file.size > CLUB_LOGO_MAX_BYTES ? "logo_too_large" : null;
}

/** El tipo sale de los primeros bytes, no de la cabecera de quien sube; y
 * unos bytes que empiezan como un PNG todavía tienen que decodificarse. */
async function validateLogoBytes(
  gateways: ClubLogoGateways,
  bytes: Uint8Array,
): Promise<ClubLogoType> {
  if (bytes.length === 0) {
    throw new ClubLogoValidationError("logo_empty");
  }
  if (bytes.length > CLUB_LOGO_MAX_BYTES) {
    throw new ClubLogoValidationError("logo_too_large");
  }
  const type = detectProfilePhotoType(bytes);
  if (!isClubLogoType(type)) {
    throw new ClubLogoValidationError("logo_type_unsupported");
  }
  if (!(await gateways.images.isDecodable(bytes))) {
    throw new ClubLogoValidationError("logo_undecodable");
  }
  return type;
}

/** Como el resto de la configuración: la bitácora nombra el campo, nunca la
 * ruta del fichero. */
function recordLogoChanged(
  gateways: ClubLogoGateways,
  caller: { readonly id: string; readonly clubId: string },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: caller,
    clubId: caller.clubId,
    action: "club.settings_changed",
    entityType: "club",
    entityId: caller.clubId,
    result: "success",
    metadata: { fields: ["logo"] },
  });
}

/** Un fichero que ya nadie enseña. La marca ya quedó como debía, así que no
 * poder borrarlo no deshace nada ni tapa otro error: queda en el registro con
 * su ruta para borrarlo a mano. */
async function removeUnusedLogo(
  gateways: ClubLogoGateways,
  path: string,
): Promise<void> {
  try {
    await gateways.storage.remove(path);
  } catch (error) {
    console.error(
      `[club-logo] quedó sin borrar el logo ${path}, que ya nadie enseña`,
      error,
    );
  }
}

async function saveOrThrowConflict(
  gateways: ClubLogoGateways,
  caller: RoleRequestMember,
  write: { readonly expected: string | null; readonly path: string | null },
): Promise<void> {
  const result = await gateways.logos.saveLogoPath(caller.clubId, write);
  if (result.kind === "changed_meanwhile") {
    throw new ClubSettingsConflictError();
  }
}

/** Sube el logo nuevo, lo apunta en el club y sólo entonces borra el anterior.
 * Si apuntarlo falla, se borra el nuevo para que no quede huérfano. */
export async function replaceClubLogo(
  gateways: ClubLogoGateways,
  request: { readonly callerId: string; readonly bytes: Uint8Array },
): Promise<ClubLogo> {
  const caller = await findAdministrator(gateways, request.callerId);
  const type = await validateLogoBytes(gateways, request.bytes);
  const previousPath = await gateways.logos.findLogoPath(caller.clubId);
  const path = `${caller.clubId}/${gateways.newFileId()}.${FILE_EXTENSIONS[type]}`;

  await gateways.storage.upload(path, request.bytes, type);
  try {
    await saveOrThrowConflict(gateways, caller, {
      expected: previousPath,
      path,
    });
  } catch (error) {
    await removeUnusedLogo(gateways, path);
    throw error;
  }
  await recordLogoChanged(gateways, { id: request.callerId, ...caller });
  if (previousPath !== null) {
    await removeUnusedLogo(gateways, previousPath);
  }
  return { logoUrl: gateways.storage.publicUrl(path) };
}

/** Deja el club sin logo y después borra el fichero. En ese orden, un fallo a
 * mitad deja a lo sumo un fichero que nadie enseña, nunca una marca que
 * apunta a nada. */
export async function removeClubLogo(
  gateways: ClubLogoGateways,
  request: { readonly callerId: string },
): Promise<ClubLogo> {
  const caller = await findAdministrator(gateways, request.callerId);
  const previousPath = await gateways.logos.findLogoPath(caller.clubId);
  if (previousPath === null) {
    return { logoUrl: null };
  }
  await saveOrThrowConflict(gateways, caller, {
    expected: previousPath,
    path: null,
  });
  await recordLogoChanged(gateways, { id: request.callerId, ...caller });
  await removeUnusedLogo(gateways, previousPath);
  return { logoUrl: null };
}
