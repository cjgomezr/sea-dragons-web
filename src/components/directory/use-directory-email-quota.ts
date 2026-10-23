"use client";

import { useEffect, useState } from "react";
import {
  DIRECTORY_EMAIL_QUOTA,
  type DirectoryEmailQuota,
} from "@/lib/directory/directory-email-rules";
import {
  type QuotaOutcome,
  loadDirectoryEmailQuota,
} from "./directory-email-client";

/**
 * El cupo del correo del directorio a la vista mientras se escribe (#859, D9
 * del PRD de E33): se pide al abrir el redactor y se pone al día con lo que
 * diga cada envío. Sólo informa: quien decide si cabe es el servidor, que es
 * el único que ve los envíos de los demás.
 */

export type QuotaState = { readonly kind: "loading" } | QuotaOutcome;

/** Con menos de estos libres, el pie y el diálogo avisan. */
export const LOW_QUOTA_THRESHOLD = 10;

export function isQuotaLow(remaining: number): boolean {
  return remaining < LOW_QUOTA_THRESHOLD;
}

/** Los que quedan, o `null` si todavía no se sabe o no se pudo saber. */
export function knownQuota(quota: QuotaState): DirectoryEmailQuota | null {
  return quota.kind === "loaded" ? quota.quota : null;
}

export function useDirectoryEmailQuota(): {
  readonly quota: QuotaState;
  /** Lo que queda según la última respuesta del servidor. */
  readonly showRemaining: (remaining: number) => void;
} {
  const [quota, setQuota] = useState<QuotaState>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    void loadDirectoryEmailQuota().then((outcome) => {
      if (isCurrent) {
        setQuota(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  function showRemaining(remaining: number): void {
    setQuota({
      kind: "loaded",
      quota: { limit: DIRECTORY_EMAIL_QUOTA, remaining },
    });
  }

  return { quota, showRemaining };
}
