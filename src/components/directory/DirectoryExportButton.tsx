"use client";

import { useState } from "react";
import type { DirectoryQuery } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import {
  type DirectoryExportFailure,
  describeDirectoryExportFailure,
  downloadDirectoryExport,
} from "./directory-export-client";

/**
 * "Exportar CSV" (#500, RF-5 del PRD de E19): descarga la lista que se está
 * viendo. La pantalla sólo lo pinta a quien recibe la lista de Admin o de
 * Committee; el servidor lo vuelve a comprobar al exportar.
 *
 * Con la lista vacía no hay nada que exportar: el botón se deshabilita y el
 * motivo queda escrito al lado y enlazado como su descripción, igual que el
 * de escribir un correo.
 */

const EXPORT_EMPTY_REASON_ID = "exportar-directorio-sin-socios";

type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "exporting" }
  | { readonly kind: "failed"; readonly failure: DirectoryExportFailure };

export function DirectoryExportButton({
  translate,
  query,
  isEmpty,
}: {
  translate: Translator;
  /** La consulta de la lista que se está viendo. */
  query: DirectoryQuery;
  isEmpty: boolean;
}): React.JSX.Element {
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  async function exportList(): Promise<void> {
    setState({ kind: "exporting" });
    const outcome = await downloadDirectoryExport(query);
    setState(
      outcome.kind === "failed"
        ? { kind: "failed", failure: outcome.failure }
        : { kind: "idle" },
    );
  }

  return (
    <div className="directory-export-open">
      <button
        type="button"
        className="admin-secondary"
        disabled={isEmpty || state.kind === "exporting"}
        aria-describedby={isEmpty ? EXPORT_EMPTY_REASON_ID : undefined}
        onClick={() => void exportList()}
      >
        {translate("directory.export.open")}
      </button>
      {isEmpty ? (
        <p className="auth-hint" id={EXPORT_EMPTY_REASON_ID}>
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
