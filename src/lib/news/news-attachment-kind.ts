import type { DetectableFileType } from "@/lib/files/file-type";

/** Qué icono lleva la tarjeta de un adjunto en la publicación abierta
 * (#596). */
export type NewsAttachmentKind = "pdf" | "image" | "word" | "other";

const KINDS: Readonly<Record<DetectableFileType, NewsAttachmentKind>> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "word",
  "application/msword": "word",
};

function isKnownType(contentType: string): contentType is DetectableFileType {
  return Object.hasOwn(KINDS, contentType);
}

/** El tipo llega como texto: un adjunto de un tipo que hoy no se admite cae
 * al icono de archivo genérico en vez de romper la tarjeta. */
export function newsAttachmentKindOf(contentType: string): NewsAttachmentKind {
  return isKnownType(contentType) ? KINDS[contentType] : "other";
}
