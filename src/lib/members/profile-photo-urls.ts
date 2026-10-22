/** Quien firma las miniaturas de una lista: por ruta, y la que no se firma no
 * está. Lo cablea cada adaptador con `signProfilePhotoUrls`. */
export type ProfilePhotoSigner = {
  signPhotoUrls(
    photoPaths: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
};

/** Las miniaturas firmadas de una lista en una sola llamada. Si la llamada
 * entera falla, la lista no se cae: salen las iniciales y el fallo queda
 * registrado con su motivo y con `context`, que dice qué lista era. */
export async function signPhotosOrNone(
  signer: ProfilePhotoSigner,
  photoPaths: readonly (string | null)[],
  context: string,
): Promise<ReadonlyMap<string, string>> {
  const paths = photoPaths.filter((path): path is string => path !== null);
  if (paths.length === 0) {
    return new Map();
  }
  try {
    return await signer.signPhotoUrls(paths);
  } catch (error) {
    console.error(
      `[${context}] no se pudieron firmar ${paths.length} fotos; salen las iniciales: ${String(error)}`,
    );
    return new Map();
  }
}

/** La dirección firmada de una foto, o null si no tiene o no se firmó. */
export function signedPhotoUrl(
  photoUrls: ReadonlyMap<string, string>,
  photoPath: string | null,
): string | null {
  return photoPath === null ? null : (photoUrls.get(photoPath) ?? null);
}
