import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";

/**
 * La foto de perfil (#245, RF-7 del PRD de E5, FR-084), contada sin Supabase
 * delante.
 *
 * Cada miembro cambia sólo la suya: quien llama la identifica por su sesión y
 * nunca por un id que viaje en la petición. La foto se guarda en la carpeta
 * de su `user_id` con un nombre aleatorio por subida, así que la ruta no dice
 * ni el correo ni el nombre de nadie, y la foto nueva no pisa la anterior
 * hasta que ya quedó apuntada en la ficha.
 */

/** 2 MB: una foto de móvil recién sacada cabe si es JPEG o WebP, y el
 * directorio no carga decenas de fotos de cámara. */
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const PROFILE_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ProfilePhotoType = (typeof PROFILE_PHOTO_TYPES)[number];

export const PROFILE_PHOTO_ISSUE_CODES = [
  "photo_empty",
  "photo_too_large",
  "photo_type_unsupported",
] as const;

export type ProfilePhotoIssueCode = (typeof PROFILE_PHOTO_ISSUE_CODES)[number];

/** La foto tal como la ven el perfil y el directorio: una dirección firmada de
 * vida corta, o null para enseñar las iniciales. */
export type ProfilePhoto = {
  readonly photoUrl: string | null;
};

const FILE_EXTENSIONS: Readonly<Record<ProfilePhotoType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class ProfilePhotoValidationError extends Error {
  readonly code: ProfilePhotoIssueCode;

  constructor(code: ProfilePhotoIssueCode) {
    super(`La foto no vale: ${code}.`);
    this.name = "ProfilePhotoValidationError";
    this.code = code;
  }
}

/** Una baja o una cuenta a medias no cambia nada de su perfil. La frontera ya
 * la para antes, pero la regla es del dominio. */
export class AccountNotOperatingError extends Error {
  constructor(status: AccountStatus) {
    super(`Una cuenta ${status} no puede cambiar su foto de perfil.`);
    this.name = "AccountNotOperatingError";
  }
}

/** Lo que el dominio necesita saber de la ficha de quien pide. */
export type PhotoOwner = {
  readonly status: AccountStatus;
  readonly photoPath: string | null;
};

export type ProfilePhotoGateways = {
  readonly members: {
    findPhotoOwner(userId: string): Promise<PhotoOwner | null>;
    savePhotoPath(userId: string, photoPath: string | null): Promise<void>;
  };
  readonly storage: {
    upload(
      photoPath: string,
      bytes: Uint8Array,
      type: ProfilePhotoType,
    ): Promise<void>;
    remove(photoPath: string): Promise<void>;
  };
  readonly signing: {
    signPhotoUrl(photoPath: string): Promise<string>;
  };
  /** El nombre aleatorio del fichero nuevo. Se inyecta para que los tests
   * sepan qué ruta esperar. */
  readonly newFileId: () => string;
};

/** Lo que la pantalla puede comprobar antes de subir, con lo que el navegador
 * dice del fichero. El servidor lo vuelve a comprobar con los bytes. */
export function validateProfilePhotoFile(file: {
  readonly type: string;
  readonly size: number;
}): ProfilePhotoIssueCode | null {
  if (file.size === 0) {
    return "photo_empty";
  }
  if (!PROFILE_PHOTO_TYPES.some((type) => type === file.type)) {
    return "photo_type_unsupported";
  }
  return file.size > PROFILE_PHOTO_MAX_BYTES ? "photo_too_large" : null;
}

function startsWithBytes(
  bytes: Uint8Array,
  expected: readonly number[],
  offset = 0,
): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function asciiCodes(text: string): readonly number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = asciiCodes("RIFF");
const WEBP_SIGNATURE = asciiCodes("WEBP");
/** En un WebP, "WEBP" va después de "RIFF" y de los cuatro bytes del largo. */
const WEBP_SIGNATURE_OFFSET = 8;

/** El tipo que dicen los primeros bytes, no el que declara quien sube: una
 * cabecera `Content-Type` se escribe a mano. */
export function detectProfilePhotoType(
  bytes: Uint8Array,
): ProfilePhotoType | null {
  if (startsWithBytes(bytes, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (startsWithBytes(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }
  const isWebp =
    startsWithBytes(bytes, RIFF_SIGNATURE) &&
    startsWithBytes(bytes, WEBP_SIGNATURE, WEBP_SIGNATURE_OFFSET);
  return isWebp ? "image/webp" : null;
}

function validatePhotoBytes(bytes: Uint8Array): ProfilePhotoType {
  if (bytes.length === 0) {
    throw new ProfilePhotoValidationError("photo_empty");
  }
  if (bytes.length > PROFILE_PHOTO_MAX_BYTES) {
    throw new ProfilePhotoValidationError("photo_too_large");
  }
  const type = detectProfilePhotoType(bytes);
  if (type === null) {
    throw new ProfilePhotoValidationError("photo_type_unsupported");
  }
  return type;
}

async function findOperatingOwner(
  gateways: ProfilePhotoGateways,
  userId: string,
): Promise<PhotoOwner> {
  const owner = await gateways.members.findPhotoOwner(userId);
  if (owner === null) {
    throw new MemberNotFoundError(userId);
  }
  if (owner.status !== "active") {
    throw new AccountNotOperatingError(owner.status);
  }
  return owner;
}

/** La foto que enseña el perfil propio. Leerla no pide que la cuenta opere:
 * a quien no opera la frontera ya no le deja abrir la pantalla. */
export async function readProfilePhoto(
  gateways: ProfilePhotoGateways,
  userId: string,
): Promise<ProfilePhoto> {
  const owner = await gateways.members.findPhotoOwner(userId);
  if (owner === null) {
    throw new MemberNotFoundError(userId);
  }
  return {
    photoUrl:
      owner.photoPath === null
        ? null
        : await gateways.signing.signPhotoUrl(owner.photoPath),
  };
}

/** Sube la foto nueva, la apunta en la ficha y sólo entonces borra la
 * anterior. Si la subida falla, la ficha sigue con la de antes; si falla
 * apuntarla, se borra la nueva para que no quede huérfana. */
export async function replaceProfilePhoto(
  gateways: ProfilePhotoGateways,
  request: { readonly userId: string; readonly bytes: Uint8Array },
): Promise<ProfilePhoto> {
  const owner = await findOperatingOwner(gateways, request.userId);
  const type = validatePhotoBytes(request.bytes);
  const photoPath = `${request.userId}/${gateways.newFileId()}.${FILE_EXTENSIONS[type]}`;

  await gateways.storage.upload(photoPath, request.bytes, type);
  try {
    await gateways.members.savePhotoPath(request.userId, photoPath);
  } catch (error) {
    await gateways.storage.remove(photoPath);
    throw error;
  }
  if (owner.photoPath !== null) {
    await gateways.storage.remove(owner.photoPath);
  }
  return { photoUrl: await gateways.signing.signPhotoUrl(photoPath) };
}

/** Deja la ficha sin foto y después borra el fichero. En ese orden, un fallo
 * a mitad deja a lo sumo un fichero que nadie enseña, nunca una ficha que
 * apunta a nada. */
export async function removeProfilePhoto(
  gateways: ProfilePhotoGateways,
  userId: string,
): Promise<void> {
  const owner = await findOperatingOwner(gateways, userId);
  if (owner.photoPath === null) {
    return;
  }
  await gateways.members.savePhotoPath(userId, null);
  await gateways.storage.remove(owner.photoPath);
}
