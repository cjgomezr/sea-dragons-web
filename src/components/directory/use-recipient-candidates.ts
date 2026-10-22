"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_DIRECTORY_QUERY } from "@/lib/directory/directory";
import type { RecipientCandidate } from "@/lib/directory/recipient-search";
import { loadDirectory } from "./directory-client";

/**
 * La lista del club en la que busca el correo (#858, D8 del PRD de E33).
 * Desde Grupos no hay directorio cargado, y el de la pantalla puede estar
 * filtrado, así que se pide `GET /api/v1/directory` entero la primera vez
 * que el buscador recibe el foco y se guarda mientras el redactor siga
 * abierto. No hace falta endpoint nuevo.
 */

export type CandidatesLoad =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "loaded";
      readonly candidates: readonly RecipientCandidate[];
    }
  | { readonly kind: "failed" };

export function useRecipientCandidates(): {
  readonly load: CandidatesLoad;
  /** Pide la lista si todavía no se pidió; después no hace nada. */
  readonly requestOnce: () => void;
  readonly retry: () => void;
} {
  const [load, setLoad] = useState<CandidatesLoad>({ kind: "idle" });
  const hasRequestedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function request(): void {
    hasRequestedRef.current = true;
    setLoad({ kind: "loading" });
    void loadDirectory(DEFAULT_DIRECTORY_QUERY).then((outcome) => {
      if (!isMountedRef.current) {
        return;
      }
      setLoad(
        outcome.kind === "loaded"
          ? { kind: "loaded", candidates: outcome.listing.members }
          : { kind: "failed" },
      );
    });
  }

  function requestOnce(): void {
    if (!hasRequestedRef.current) {
      request();
    }
  }

  return { load, requestOnce, retry: request };
}
