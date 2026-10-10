"use client";

import { useState } from "react";
import type { DirectoryQuery } from "@/lib/directory/directory";
import {
  type DirectoryExportFailure,
  downloadDirectoryExport,
} from "./directory-export-client";

/**
 * Descargar la lista que se ve como CSV (#500), y cómo fue. Lo usan el botón
 * de la cabecera de escritorio y el menú "⋯" del móvil (#553).
 */

export type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "exporting" }
  | { readonly kind: "failed"; readonly failure: DirectoryExportFailure };

export function useDirectoryExport(): {
  readonly state: ExportState;
  readonly exportList: (query: DirectoryQuery) => Promise<void>;
} {
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  async function exportList(query: DirectoryQuery): Promise<void> {
    setState({ kind: "exporting" });
    const outcome = await downloadDirectoryExport(query);
    setState(
      outcome.kind === "failed"
        ? { kind: "failed", failure: outcome.failure }
        : { kind: "idle" },
    );
  }

  return { state, exportList };
}
