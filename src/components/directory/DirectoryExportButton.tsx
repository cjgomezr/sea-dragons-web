"use client";

import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { Icon } from "@/components/Icon";
import type { DirectoryQuery } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import { describeDirectoryExportFailure } from "./directory-export-client";
import { useDirectoryExport } from "./use-directory-export";

/**
 * "Exportar CSV" (#500, RF-5 del PRD de E19): descarga la lista que se está
 * viendo. La pantalla sólo lo pinta a quien recibe la lista de Admin o de
 * Committee; el servidor lo vuelve a comprobar al exportar.
 *
 * Con la lista vacía no hay nada que exportar: el botón se deshabilita y el
 * motivo queda enlazado como su descripción, igual que el de escribir un
 * correo. Desde #548 es un botón de solo icono en la cabecera: el motivo lo
 * lee el lector de pantalla, y a la vista lo explica la lista vacía de abajo.
 */

const EXPORT_EMPTY_REASON_ID = "exportar-directorio-sin-socios";

export function DirectoryExportButton({
  translate,
  query,
  selectedUserIds,
  isEmpty,
}: {
  translate: Translator;
  /** La consulta de la lista que se está viendo. */
  query: DirectoryQuery;
  /** Los socios marcados (#552), o `null` para la lista entera. */
  selectedUserIds: readonly string[] | null;
  isEmpty: boolean;
}): React.JSX.Element {
  const { state, exportList } = useDirectoryExport();
  const label = translate("directory.export.open");

  return (
    <div className="directory-export-open">
      <button
        type="button"
        className="directory-icon-button"
        aria-label={label}
        title={label}
        disabled={isEmpty || state.kind === "exporting"}
        aria-describedby={isEmpty ? EXPORT_EMPTY_REASON_ID : undefined}
        onClick={() => void exportList(query, selectedUserIds)}
      >
        <Icon glyph={DownloadSimple} />
      </button>
      {isEmpty ? (
        <p className="visually-hidden" id={EXPORT_EMPTY_REASON_ID}>
          {translate("directory.export.emptyReason")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeDirectoryExportFailure(translate, state.failure)}
        </p>
      ) : null}
    </div>
  );
}
