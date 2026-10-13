/**
 * La portada de una publicación (#591, RF-2 del PRD de E22), contada sin
 * Supabase delante.
 *
 * Lo que se guarda no es lo que se sube, sino dos versiones WebP (decisión
 * D6): la miniatura de las filas del feed y la grande de la tarjeta destacada
 * y de la publicación abierta. Las dos viven en el bucket privado de los
 * adjuntos y se sirven con una dirección firmada, sólo a quien puede ver la
 * publicación: la regla de audiencia la aplican el feed y `openNewsPost`
 * antes de firmar nada.
 *
 * Cada subida es una fila de `news_cover_uploads` y `news_posts` la apunta.
 * La ruta de sus ficheros se deduce del club y del id, así que la fila no
 * guarda ninguna.
 */

/** Un día, como las subidas de adjuntos: más de lo que nadie tarda en
 * escribir una publicación, y poco para que lo abandonado se acumule. */
export const STALE_COVER_AGE_MS = 24 * 60 * 60 * 1000;

const COVERS_FOLDER = "covers";

/** Una portada subida, por su id y su club. */
export type NewsCoverRef = { readonly id: string; readonly clubId: string };

/** Una fila de `news_cover_uploads`, con la publicación que la apunta. */
export type NewsCoverUpload = NewsCoverRef & {
  readonly uploadedBy: string;
  readonly postId: string | null;
};

export type NewsCoverPaths = {
  readonly thumbnail: string;
  readonly large: string;
};

/** Lo que reciben el feed y el detalle: direcciones firmadas, o null si la
 * publicación no tiene portada o Storage ya no tiene el fichero. */
export type NewsCoverUrls = {
  readonly coverThumbnailUrl: string | null;
  readonly coverUrl: string | null;
};

export const NO_COVER_URLS: NewsCoverUrls = {
  coverThumbnailUrl: null,
  coverUrl: null,
};

export type NewsCoversGateway = {
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
    cover: NewsCoverRef & { readonly uploadedBy: string },
  ): Promise<void>;
  findCover(coverId: string): Promise<NewsCoverUpload | null>;
  /** Las que subió esa persona antes de `createdBefore` y no apunta ninguna
   * publicación. */
  findStaleCovers(query: {
    readonly uploadedBy: string;
    readonly createdBefore: string;
  }): Promise<readonly NewsCoverRef[]>;
  deleteCover(coverId: string): Promise<void>;
};

export function newsCoverPathsOf(cover: NewsCoverRef): NewsCoverPaths {
  const base = `${cover.clubId}/${COVERS_FOLDER}/${cover.id}`;
  return { thumbnail: `${base}-thumb.webp`, large: `${base}-large.webp` };
}

function filesOf(cover: NewsCoverRef): readonly string[] {
  const paths = newsCoverPathsOf(cover);
  return [paths.thumbnail, paths.large];
}

/** Las dos direcciones de cada portada, firmadas en una sola llamada. */
export async function signNewsCovers(
  covers: NewsCoversGateway,
  coverRefs: readonly NewsCoverRef[],
): Promise<ReadonlyMap<string, NewsCoverUrls>> {
  if (coverRefs.length === 0) {
    return new Map();
  }
  const signed = await covers.signUrls(coverRefs.flatMap(filesOf));
  return new Map(
    coverRefs.map((cover) => {
      const paths = newsCoverPathsOf(cover);
      return [
        cover.id,
        {
          coverThumbnailUrl: signed.get(paths.thumbnail) ?? null,
          coverUrl: signed.get(paths.large) ?? null,
        },
      ];
    }),
  );
}

/** Sólo la grande, para la publicación abierta. */
export async function signNewsCoverUrl(
  covers: NewsCoversGateway,
  cover: NewsCoverRef | null,
): Promise<string | null> {
  if (cover === null) {
    return null;
  }
  const { large } = newsCoverPathsOf(cover);
  const signed = await covers.signUrls([large]);
  return signed.get(large) ?? null;
}

/** Quita la fila y después los ficheros, como un adjunto: un fallo a mitad
 * deja a lo sumo ficheros que nadie sirve, nunca una portada que apunta a
 * nada. Quien la descarta ya guardó lo suyo, así que un fallo se registra con
 * sus rutas y no se lanza. */
export async function discardNewsCover(
  covers: NewsCoversGateway,
  cover: NewsCoverRef,
): Promise<void> {
  try {
    await covers.deleteCover(cover.id);
    await covers.removeFiles(filesOf(cover));
  } catch (error) {
    console.error(
      `[news-covers] quedó sin borrar la portada ${filesOf(cover).join(", ")}`,
      error,
    );
  }
}

/** Borra las portadas propias que se subieron hace más de un día y ninguna
 * publicación apunta. */
export async function sweepStaleNewsCovers(
  covers: NewsCoversGateway,
  request: { readonly uploadedBy: string; readonly now: Date },
): Promise<void> {
  try {
    const stale = await covers.findStaleCovers({
      uploadedBy: request.uploadedBy,
      createdBefore: new Date(
        request.now.getTime() - STALE_COVER_AGE_MS,
      ).toISOString(),
    });
    for (const cover of stale) {
      await discardNewsCover(covers, cover);
    }
  } catch (error) {
    console.error(
      `[news-covers] no se pudieron buscar las portadas abandonadas de ${request.uploadedBy}`,
      error,
    );
  }
}
