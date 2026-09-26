import { z } from "zod";
import { readApiPayload, requestApi } from "@/lib/api/request-api";
import { DIRECTORY_MEMBER_PHOTO_API_PATH } from "@/lib/auth/routes";

/**
 * Pedir la foto grande de un socio (#355) al abrirla, por la API v1 (#353).
 * La dirección firmada no se pide antes para no firmar la de toda la lista.
 *
 * El visor sólo distingue si hay foto que enseñar: la causa de un fallo no
 * cambia lo que puede hacer quien mira, que es cerrar.
 */

const largePhotoResponseSchema = z.object({
  // Null si el socio ya no tiene foto, o Storage no la pudo firmar.
  data: z.object({ photoUrl: z.url({ protocol: /^https?$/ }).nullable() }),
});

export type LargePhotoResult =
  | { readonly kind: "found"; readonly photoUrl: string }
  | { readonly kind: "unavailable" };

export async function fetchLargeMemberPhoto(
  userId: string,
): Promise<LargePhotoResult> {
  const read = readApiPayload(
    await requestApi(DIRECTORY_MEMBER_PHOTO_API_PATH.replace("[id]", userId)),
    largePhotoResponseSchema,
  );
  if (read.kind === "failed" || read.value.data.photoUrl === null) {
    return { kind: "unavailable" };
  }
  return { kind: "found", photoUrl: read.value.data.photoUrl };
}
