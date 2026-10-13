/**
 * Cuánto tiempo queda fijada una publicación (#595, RF-5 del PRD de E22): 1,
 * 2 o 4 semanas, o hasta que el Admin la desfije. La misma regla sirve a la
 * tira del feed, al formulario (#599) y a la hoja ⋯ del móvil (#601).
 *
 * Las semanas se cuentan en horas exactas desde ahora. Si en medio cambia el
 * horario de verano, el fijado termina una hora antes o después en Melbourne,
 * y para quitar un destacado eso no importa.
 */

export const NEWS_PIN_DURATIONS = [
  "oneWeek",
  "twoWeeks",
  "fourWeeks",
  "untilUnpinned",
] as const;

export type NewsPinDuration = (typeof NEWS_PIN_DURATIONS)[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DAYS_PINNED: Record<Exclude<NewsPinDuration, "untilUnpinned">, number> = {
  oneWeek: 7,
  twoWeeks: 14,
  fourWeeks: 28,
};

/** La fecha de fin que se manda a `POST /api/v1/news/{id}/pin`, o `null` si
 * se queda fijada hasta que la desfijen. */
export function newsPinEndDate(
  duration: NewsPinDuration,
  now: Date,
): string | null {
  if (duration === "untilUnpinned") {
    return null;
  }
  return new Date(
    now.getTime() + DAYS_PINNED[duration] * MS_PER_DAY,
  ).toISOString();
}
