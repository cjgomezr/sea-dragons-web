import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { detectFileType } from "@/lib/files/file-type";
import { NEWS_COVER_MAX_BYTES } from "@/lib/news/news-cover-uploads";
import type { ShrunkNewsCover } from "@/lib/news/shrink-news-cover";
import { EventValidationError, findEventOrganizer } from "./event-creation";

/**
 * La imagen de un evento o una serie (#644, RF-3 y D7 del PRD de E24),
 * contada sin Supabase delante.
 *
 * Como la portada de noticias (E22 D6): se sube antes de guardar el evento,
 * se reduce en el momento a una miniatura para las filas y una grande para el
 * panel y la pantalla del evento, y el original no se guarda nunca. Las dos
 * viven en el bucket privado `event-covers` y se sirven con una dirección
 * firmada, sólo a quien está en la audiencia: eso lo decide la agenda antes
 * de firmar nada.
 *
 * Cada subida es una fila de `event_cover_uploads` que eventos y series
 * apuntan. La ruta de sus ficheros se deduce del club y del id.
 */

const COVER_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Una imagen subida, por su id y su club. */
export type EventCoverRef = { readonly id: string; readonly clubId: string };

/** Una fila de `event_cover_uploads`. `uploadedBy` es nula si se borró la
 * ficha de quien la subió. */
export type EventCoverUpload = EventCoverRef & {
  readonly uploadedBy: string | null;
};

export type EventCoverPaths = {
  readonly thumbnail: string;
  readonly large: string;
};

/** Lo que recibe el detalle: direcciones firmadas, o null si el evento no
 * tiene imagen, quien consulta no es su audiencia o Storage ya no tiene el
 * fichero. */
export type EventCoverUrls = {
  readonly coverThumbUrl: string | null;
  readonly coverUrl: string | null;
};

export const NO_EVENT_COVER_URLS: EventCoverUrls = {
  coverThumbUrl: null,
  coverUrl: null,
};

export type EventCoversGateway = {
  upload(file: {
    readonly storagePath: string;
    readonly bytes: Uint8Array;
  }): Promise<void>;
  removeFiles(storagePaths: readonly string[]): Promise<void>;
  /** Las direcciones firmadas de las rutas que Storage pudo firmar; la que
   * falta es un fichero que ya no está. */
  signUrls(
    storagePaths: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  insertCover(
    cover: EventCoverRef & { readonly uploadedBy: string },
  ): Promise<void>;
  findCover(coverId: string): Promise<EventCoverUpload | null>;
};

export type EventCoverUploadGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly eventCovers: EventCoversGateway;
  readonly images: {
    shrinkCover(bytes: Uint8Array): Promise<ShrunkNewsCover>;
  };
  newFileId(): string;
};

/** Lo que se manda después en `coverUploadId`. */
export type StagedEventCover = { readonly id: string };

export function eventCoverPathsOf(cover: EventCoverRef): EventCoverPaths {
  const base = `${cover.clubId}/${cover.id}`;
  return { thumbnail: `${base}-thumb.webp`, large: `${base}-large.webp` };
}

/** El tipo se mira en los bytes, no en el nombre ni en la cabecera: la
 * imagen se vuelve a codificar, así que lo de dentro es lo único que
 * cuenta. */
function assertUsableCoverBytes(bytes: Uint8Array): void {
  if (bytes.length === 0) {
    throw new EventValidationError("event_cover_empty");
  }
  if (bytes.length > NEWS_COVER_MAX_BYTES) {
    throw new EventValidationError("event_cover_too_large");
  }
  const type = detectFileType(bytes);
  if (type === null || !COVER_TYPES.has(type)) {
    throw new EventValidationError("event_cover_type_unsupported");
  }
}

async function removeOrphanCoverFiles(
  covers: EventCoversGateway,
  storagePaths: readonly string[],
): Promise<void> {
  if (storagePaths.length === 0) {
    return;
  }
  try {
    await covers.removeFiles(storagePaths);
  } catch (cleanupError) {
    console.error(
      `[event-covers] quedó sin borrar la imagen huérfana ${storagePaths.join(", ")}`,
      cleanupError,
    );
  }
}

/** Si la fila no entra, se borran los ficheros para no dejarlos huérfanos, y
 * quien subió recibe el error de verdad. */
async function storeCover(
  covers: EventCoversGateway,
  cover: EventCoverRef & { readonly uploadedBy: string },
  versions: { readonly thumbnail: Uint8Array; readonly large: Uint8Array },
): Promise<void> {
  const paths = eventCoverPathsOf(cover);
  const uploaded: string[] = [];
  try {
    for (const [storagePath, bytes] of [
      [paths.thumbnail, versions.thumbnail],
      [paths.large, versions.large],
    ] as const) {
      await covers.upload({ storagePath, bytes });
      uploaded.push(storagePath);
    }
    await covers.insertCover(cover);
  } catch (error) {
    await removeOrphanCoverFiles(covers, uploaded);
    throw error;
  }
}

/** Sube la imagen de un evento antes de guardarlo. Todo se comprueba antes
 * de subir: un rechazo no deja rastro. */
export async function stageEventCover(
  gateways: EventCoverUploadGateways,
  request: { readonly callerId: string; readonly bytes: Uint8Array },
): Promise<StagedEventCover> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  assertUsableCoverBytes(request.bytes);
  const shrunk = await gateways.images.shrinkCover(request.bytes);
  if (shrunk.kind === "undecodable") {
    throw new EventValidationError("event_cover_type_unsupported");
  }
  const id = gateways.newFileId();
  await storeCover(
    gateways.eventCovers,
    { id, clubId: caller.clubId, uploadedBy: request.callerId },
    shrunk,
  );
  return { id };
}

/** La miniatura de cada imagen, por su id, firmadas todas en una sola
 * llamada: una página de la agenda no hace una petición por evento. */
export async function signEventCoverThumbnails(
  covers: Pick<EventCoversGateway, "signUrls">,
  coverRefs: readonly EventCoverRef[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [
    ...new Map(coverRefs.map((cover) => [cover.id, cover])).values(),
  ];
  if (unique.length === 0) {
    return new Map();
  }
  const signed = await covers.signUrls(
    unique.map((cover) => eventCoverPathsOf(cover).thumbnail),
  );
  return new Map(
    unique.flatMap((cover) => {
      const url = signed.get(eventCoverPathsOf(cover).thumbnail);
      return url === undefined ? [] : [[cover.id, url] as const];
    }),
  );
}

/** Las dos versiones de una imagen, para el detalle. */
export async function signEventCover(
  covers: Pick<EventCoversGateway, "signUrls">,
  cover: EventCoverRef,
): Promise<EventCoverUrls> {
  const paths = eventCoverPathsOf(cover);
  const signed = await covers.signUrls([paths.thumbnail, paths.large]);
  return {
    coverThumbUrl: signed.get(paths.thumbnail) ?? null,
    coverUrl: signed.get(paths.large) ?? null,
  };
}
