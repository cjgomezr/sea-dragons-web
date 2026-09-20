"use client";

import { useRef, useState } from "react";

/**
 * La acción de la pantalla Grupos que está esperando respuesta.
 *
 * Son dos cosas a la vez porque hacen falta las dos. El estado dice cuál es,
 * para desactivar los botones y escribir "Creando…" en el suyo. La referencia
 * es la que impide que un doble clic mande dos peticiones: el estado llega en
 * el pintado siguiente y el segundo clic llega antes que él.
 */
export type PendingAction<Action> = {
  readonly pending: Action | null;
  /** Lo que devuelva `work`, o `null` si había otra acción en vuelo y esta no
   * llegó a salir. */
  readonly run: <Value>(
    action: Action,
    work: () => Promise<Value>,
  ) => Promise<Value | null>;
};

export function usePendingAction<Action>(): PendingAction<Action> {
  const [pending, setPending] = useState<Action | null>(null);
  const isRunningRef = useRef(false);

  async function run<Value>(
    action: Action,
    work: () => Promise<Value>,
  ): Promise<Value | null> {
    if (isRunningRef.current) {
      return null;
    }
    isRunningRef.current = true;
    setPending(action);
    try {
      return await work();
    } finally {
      isRunningRef.current = false;
      setPending(null);
    }
  }

  return { pending, run };
}
