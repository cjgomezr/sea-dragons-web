import { DIRECTORY_EXPORT_API_PATH } from "@/lib/auth/routes";
import type { DirectoryQuery } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import { saveFile } from "@/components/save-file";
import { SELECTED_MEMBER_QUERY_PARAM } from "@/lib/directory/directory-query";
import { directoryPath } from "./directory-client";

/**
 * La descarga del CSV del directorio (#500) desde la pantalla. Pide a
 * `GET /api/v1/directory/export` la misma consulta que la lista que se está
 * viendo, acotada a los socios marcados si los hay (#552), y guarda el
 * archivo con el nombre que le da el servidor.
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

/** La consulta de la lista y, uno por parámetro, los socios marcados. */
function exportPath(
  query: DirectoryQuery,
  selectedUserIds: readonly string[] | null,
): string {
  const path = directoryPath(query, DIRECTORY_EXPORT_API_PATH);
  if (selectedUserIds === null) {
    return path;
  }
  const selected = new URLSearchParams(
    selectedUserIds.map((userId) => [SELECTED_MEMBER_QUERY_PARAM, userId]),
  ).toString();
  return `${path}${path.includes("?") ? "&" : "?"}${selected}`;
}

/** Nunca rechaza: el fallo de red y la respuesta de error salen como
 * resultado, para que la pantalla los diga. Sin socios marcados (`null`),
 * exporta la lista filtrada entera. */
export async function downloadDirectoryExport(
  query: DirectoryQuery,
  selectedUserIds: readonly string[] | null,
): Promise<DirectoryExportOutcome> {
  try {
    const response = await fetch(exportPath(query, selectedUserIds));
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
