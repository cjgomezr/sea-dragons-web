"use client";

import { useEffect, useState } from "react";

/** Lo que dura a la vista el aviso de un cambio (RF-8 de E32). */
export const CHANGE_NOTICE_DURATION_MS = 3_000;

/**
 * El aviso de que un cambio de la pantalla Grupos salió bien: "Alevines
 * creado", "Nerea ya no está en Senior". Se va solo, y uno nuevo reinicia la
 * cuenta en vez de sumarse al anterior.
 *
 * Guarda la frase ya escrita, y no el cambio, porque vive tres segundos: no
 * hay tiempo para que el interruptor de idioma lo pille a medias.
 */
export function useChangeNotice(): {
  readonly notice: string | null;
  readonly announce: (notice: string) => void;
} {
  // Un objeto y no la frase a secas: dos avisos con la misma frase son dos
  // valores distintos, así que el segundo también reinicia la cuenta.
  const [current, setCurrent] = useState<{ readonly text: string } | null>(
    null,
  );

  useEffect(() => {
    if (current === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setCurrent(null),
      CHANGE_NOTICE_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [current]);

  function announce(text: string): void {
    setCurrent({ text });
  }

  return { notice: current?.text ?? null, announce };
}
