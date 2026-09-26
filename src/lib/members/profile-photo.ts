import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import { type DetectableFileType, detectFileType } from "@/lib/files/file-type";

/**
 * La foto de perfil (#245, RF-7 del PRD de E5, FR-084), contada sin Supabase
 * delante.
 *
 * Cada miembro cambia sólo la suya: quien llama la identifica por su sesión y
 * nunca por un id que viaje en la petición. La foto se guarda en la carpeta
 * de su `user_id` con un nombre aleatorio por subida, así que la ruta no dice
 * ni el correo ni el nombre de nadie, y la foto nueva no pisa la anterior
 * hasta que ya quedó apuntada en la ficha.
 *
 * Lo que se guarda no es lo que se sube, sino dos versiones reducidas (#271,
 * #353): así el directorio no gasta el tráfico de salida del plan de
 * Supabase. Las dos comparten nombre y se distinguen por el sufijo
 * (`<id>-thumb.webp`, `<id>-large.webp`). La ficha apunta a la miniatura, que
 * es lo que piden el directorio y el perfil, y la ruta de la grande se deduce
 * de ella: no hace falta otra columna.
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

const THUMBNAIL_SUFFIX = "-thumb";
const LARGE_SUFFIX = "-large";

/** El sufijo de la miniatura justo antes de la extensión, y nada después. */
const THUMBNAIL_NAME = new RegExp(`${THUMBNAIL_SUFFIX}(\\.[a-z]+)$`);

/** Dónde está la versión grande de la foto que apunta la ficha. Una foto
 * subida antes de #353 no lleva sufijo porque sólo tiene un tamaño (400 px):
 * su grande es ella misma, y quien la abre la ve sin error. */
export function largePhotoPathOf(photoPath: string): string {
  return photoPath.replace(THUMBNAIL_NAME, `${LARGE_SUFFIX}$1`);
}

/** Todos los ficheros de una foto, para borrarlos juntos. */
function photoFilesOf(photoPath: string): readonly string[] {
  return [...new Set([photoPath, largePhotoPathOf(photoPath)])];
}

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

/** Una de las dos versiones reducidas que se guardan. */
export type PhotoVersion = {
  readonly bytes: Uint8Array;
  readonly type: ProfilePhotoType;
};

/** Las dos versiones de la foto (#353): la miniatura de las listas y la
 * grande que sólo se descarga al abrirla. O la señal de que los bytes empiezan
 * como una imagen admitida pero no se pueden decodificar. */
export type ShrunkPhoto =
  | {
      readonly kind: "shrunk";
      readonly thumbnail: PhotoVersion;
      readonly large: PhotoVersion;
    }
  | { readonly kind: "undecodable" };

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
    remove(photoPaths: readonly string[]): Promise<void>;
  };
  readonly signing: {
    /** Null cuando Storage no la pudo firmar (el fichero ya no está): quien
     * la enseña pone entonces las iniciales en vez de fallar. */
    signPhotoUrl(photoPath: string): Promise<string | null>;
  };
  readonly images: {
    shrinkPhoto(bytes: Uint8Array): Promise<ShrunkPhoto>;
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

function isProfilePhotoType(
  type: DetectableFileType | null,
): type is ProfilePhotoType {
  return PROFILE_PHOTO_TYPES.some((photoType) => photoType === type);
}

/** El tipo que dicen los primeros bytes, no el que declara quien sube: una
 * cabecera `Content-Type` se escribe a mano. */
export function detectProfilePhotoType(
  bytes: Uint8Array,
): ProfilePhotoType | null {
  const type = detectFileType(bytes);
  return isProfilePhotoType(type) ? type : null;
}

function validatePhotoBytes(bytes: Uint8Array): void {
  if (bytes.length === 0) {
    throw new ProfilePhotoValidationError("photo_empty");
  }
  if (bytes.length > PROFILE_PHOTO_MAX_BYTES) {
    throw new ProfilePhotoValidationError("photo_too_large");
  }
  if (detectProfilePhotoType(bytes) === null) {
    throw new ProfilePhotoValidationError("photo_type_unsupported");
  }
}

/** Para quien sube, un fichero que no se decodifica es un formato que no
 * vale: recibe el mismo mensaje que un GIF. */
async function shrinkValidPhoto(
  gateways: ProfilePhotoGateways,
  bytes: Uint8Array,
): Promise<Extract<ShrunkPhoto, { readonly kind: "shrunk" }>> {
  validatePhotoBytes(bytes);
  const shrunk = await gateways.images.shrinkPhoto(bytes);
  if (shrunk.kind === "undecodable") {
    throw new ProfilePhotoValidationError("photo_type_unsupported");
  }
  return shrunk;
}

function versionPath(
  userId: string,
  fileId: string,
  { suffix, version }: { suffix: string; version: PhotoVersion },
): string {
  return `${userId}/${fileId}${suffix}.${FILE_EXTENSIONS[version.type]}`;
}

/** Sube las dos versiones y devuelve la ruta de la miniatura. Si la grande
 * no sube, se borra la miniatura: o quedan las dos, o ninguna. */
async function uploadPhotoVersions(
  gateways: ProfilePhotoGateways,
  userId: string,
  photo: Extract<ShrunkPhoto, { readonly kind: "shrunk" }>,
): Promise<string> {
  const fileId = gateways.newFileId();
  const thumbnailPath = versionPath(userId, fileId, {
    suffix: THUMBNAIL_SUFFIX,
    version: photo.thumbnail,
  });
  const largePath = versionPath(userId, fileId, {
    suffix: LARGE_SUFFIX,
    version: photo.large,
  });

  await gateways.storage.upload(
    thumbnailPath,
    photo.thumbnail.bytes,
    photo.thumbnail.type,
  );
  try {
    await gateways.storage.upload(
      largePath,
      photo.large.bytes,
      photo.large.type,
    );
  } catch (error) {
    await gateways.storage.remove([thumbnailPath]);
    throw error;
  }
  return thumbnailPath;
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
  const photo = await shrinkValidPhoto(gateways, request.bytes);
  const photoPath = await uploadPhotoVersions(gateways, request.userId, photo);

  try {
    await gateways.members.savePhotoPath(request.userId, photoPath);
  } catch (error) {
    await gateways.storage.remove(photoFilesOf(photoPath));
    throw error;
  }
  if (owner.photoPath !== null) {
    await removeReplacedPhoto(gateways, owner.photoPath);
  }
  return { photoUrl: await gateways.signing.signPhotoUrl(photoPath) };
}

/** La foto nueva ya está guardada, así que no poder borrar la anterior no
 * deshace el reemplazo: responder error haría que quien sube reintente, y el
 * reintento borraría la recién guardada en vez de ésta. Queda registrada con
 * su ruta para limpiarla a mano. */
async function removeReplacedPhoto(
  gateways: ProfilePhotoGateways,
  photoPath: string,
): Promise<void> {
  try {
    await gateways.storage.remove(photoFilesOf(photoPath));
  } catch (error) {
    console.error(
      `[profile-photo] quedó sin borrar la foto reemplazada ${photoPath}`,
      error,
    );
  }
}

/** Deja la ficha sin foto y después borra sus ficheros. En ese orden, un
 * fallo a mitad deja a lo sumo un fichero que nadie enseña, nunca una ficha
 * que apunta a nada. */
export async function removeProfilePhoto(
  gateways: ProfilePhotoGateways,
  userId: string,
): Promise<void> {
  const owner = await findOperatingOwner(gateways, userId);
  if (owner.photoPath === null) {
    return;
  }
  await gateways.members.savePhotoPath(userId, null);
  await gateways.storage.remove(photoFilesOf(owner.photoPath));
}
