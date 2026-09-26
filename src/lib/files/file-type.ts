/**
 * El tipo de un fichero según sus primeros bytes (#328). Lo comparten la foto
 * de perfil, el logo del club y los adjuntos de las noticias: el nombre y la
 * cabecera `Content-Type` los escribe quien sube, así que no dicen nada.
 *
 * Sin `Buffer` a propósito: la pantalla importa la validación de la foto, y
 * este módulo tiene que poder viajar al navegador.
 */

export const DETECTABLE_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
] as const;

export type DetectableFileType = (typeof DETECTABLE_FILE_TYPES)[number];

function asciiCodes(text: string): readonly number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

function utf16leCodes(text: string): readonly number[] {
  return asciiCodes(text).flatMap((code) => [code, 0]);
}

function startsWithBytes(
  bytes: Uint8Array,
  expected: readonly number[],
  offset = 0,
): boolean {
  return (
    bytes.length >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte)
  );
}

function containsBytes(
  bytes: Uint8Array,
  expected: readonly number[],
): boolean {
  const lastStart = bytes.length - expected.length;
  for (let start = 0; start <= lastStart; start += 1) {
    if (startsWithBytes(bytes, expected, start)) {
      return true;
    }
  }
  return false;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = asciiCodes("RIFF");
const WEBP_SIGNATURE = asciiCodes("WEBP");
/** En un WebP, "WEBP" va después de "RIFF" y de los cuatro bytes del largo. */
const WEBP_SIGNATURE_OFFSET = 8;
const PDF_SIGNATURE = asciiCodes("%PDF-");
/** Un .docx es un ZIP; lo que lo distingue de cualquier otro ZIP es la
 * carpeta `word/`, cuyo nombre va sin comprimir en las cabeceras. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const DOCX_MARKER = asciiCodes("word/");
/** Un .doc es un documento compuesto de OLE, igual que un .xls; lo que lo
 * distingue es su flujo `WordDocument`, nombrado en UTF-16. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const DOC_MARKER = utf16leCodes("WordDocument");

function detectImageType(bytes: Uint8Array): DetectableFileType | null {
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

function detectDocumentType(bytes: Uint8Array): DetectableFileType | null {
  if (startsWithBytes(bytes, PDF_SIGNATURE)) {
    return "application/pdf";
  }
  if (
    startsWithBytes(bytes, ZIP_SIGNATURE) &&
    containsBytes(bytes, DOCX_MARKER)
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (
    startsWithBytes(bytes, OLE_SIGNATURE) &&
    containsBytes(bytes, DOC_MARKER)
  ) {
    return "application/msword";
  }
  return null;
}

/** El tipo que dicen los bytes, o null si no es ninguno de los que la
 * aplicación sabe reconocer. */
export function detectFileType(bytes: Uint8Array): DetectableFileType | null {
  return detectImageType(bytes) ?? detectDocumentType(bytes);
}
