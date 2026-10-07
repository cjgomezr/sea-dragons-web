import { DIRECTORY_EXPORT_API_PATH } from "@/lib/auth/routes";
import type { DirectoryQuery } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import { directoryPath } from "./directory-client";

/**
 * La descarga del CSV del directorio (#500) desde la pantalla. Pide a
 * `GET /api/v1/directory/export` la misma consulta que la lista que se está
 * viendo, y guarda el archivo con el nombre que le da el servidor.
 *
 * Va por `fetch` y no por un enlace: un rechazo del servidor tiene que
 * quedarse en la pantalla como aviso, no descargarse como un archivo con el
 * JSON del error dentro.
 */

/** El nombre que trae `Content-Disposition`. El servidor lo escribe en ASCII
 * y entre comillas. */
const ATTACHMENT_FILENAME = /filename="([^"]+)"/;

/** Por si la cabecera no llega: un archivo sin nombre se guarda como
 * "download", sin extensión, y Excel no lo abre con un doble clic. */
const FALLBACK_FILENAME = "directory.csv";

export type DirectoryExportFailure = "network" | "rejected";

export type DirectoryExportOutcome =
  | { readonly kind: "downloaded" }
  | { readonly kind: "failed"; readonly failure: DirectoryExportFailure };

function filenameOf(response: Response): string {
  const disposition = response.headers.get("content-disposition");
  const match =
    disposition === null ? null : ATTACHMENT_FILENAME.exec(disposition);
  return match?.[1] ?? FALLBACK_FILENAME;
}

/** Un enlace que nadie ve, pulsado una vez: es como el navegador guarda un
 * archivo que no viene de navegar. */
function saveFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Después del clic y no en él: algún navegador cancela la descarga si la
  // dirección desaparece antes de que empiece.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Nunca rechaza: el fallo de red y la respuesta de error salen como
 * resultado, para que la pantalla los diga. */
export async function downloadDirectoryExport(
  query: DirectoryQuery,
): Promise<DirectoryExportOutcome> {
  try {
    const response = await fetch(
      directoryPath(query, DIRECTORY_EXPORT_API_PATH),
    );
    if (!response.ok) {
      return { kind: "failed", failure: "rejected" };
    }
    saveFile(await response.blob(), filenameOf(response));
    return { kind: "downloaded" };
  } catch {
    // La conexión se cortó al pedirlo o a mitad del archivo.
    return { kind: "failed", failure: "network" };
  }
}

export function describeDirectoryExportFailure(
  translate: Translator,
  failure: DirectoryExportFailure,
): string {
  return failure === "network"
    ? translate("auth.error.network")
    : translate("directory.export.error");
}
