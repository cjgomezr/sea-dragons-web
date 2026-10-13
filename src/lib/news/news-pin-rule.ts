/**
 * La regla de "está fijada" (#592, RF-3 del PRD de E22), sin nada delante.
 *
 * La caducidad se calcula al leer (D7): una fijada cuyo `pinnedUntil` ya
 * llegó cuenta como no fijada, sin ningún trabajo programado que la quite.
 */

/** Desde cuándo está fijada y hasta cuándo; `pinnedUntil` nulo es "hasta que
 * la desfije". Una publicación sin fijar no tiene `NewsPin`, no uno vacío. */
export type NewsPin = {
  readonly pinnedAt: string;
  readonly pinnedUntil: string | null;
};

export class InvalidNewsPinUntilError extends Error {
  constructor() {
    super("La fecha hasta la que se fija tiene que ser una fecha futura.");
    this.name = "InvalidNewsPinUntilError";
  }
}

export function isNewsPinActive(pin: NewsPin | null, now: Date): boolean {
  if (pin === null) {
    return false;
  }
  return (
    pin.pinnedUntil === null || Date.parse(pin.pinnedUntil) > now.getTime()
  );
}

/** La fecha de fin tal como se guarda, en ISO y UTC, o el motivo por el que
 * no vale: tiene que ser una fecha y estar en el futuro. */
export function readNewsPinUntil(
  until: string | null,
  now: Date,
): string | null {
  if (until === null) {
    return null;
  }
  const instant = Date.parse(until);
  if (Number.isNaN(instant) || instant <= now.getTime()) {
    throw new InvalidNewsPinUntilError();
  }
  return new Date(instant).toISOString();
}
