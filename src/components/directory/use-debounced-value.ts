"use client";

import { useEffect, useState } from "react";

/**
 * El mismo valor, pero sólo cuando deja de cambiar durante `delayMs`.
 *
 * Lo necesita la búsqueda del directorio: la lista la filtra el servidor, así
 * que mandar la consulta en cada tecla sería una petición por letra. El primer
 * valor sale ya asentado, de modo que la primera lectura no espera a nadie.
 */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
