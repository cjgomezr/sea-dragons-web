/**
 * El inicio de la temporada (#744, D1 del PRD de E27). La app no guarda
 * temporadas: el Admin fija la fecha en que empieza la actual, y la temporada
 * va de ahí a hoy. No hay fecha de fin; la siguiente empieza cuando el Admin
 * pone otra fecha.
 */

/** El 1 de enero del año de `today`. Los dos son días del club en
 * YYYY-MM-DD, que ordenan como texto igual que como fechas. */
function firstOfJanuaryOf(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/** Sin fecha, o con una que todavía no llegó, la temporada cuenta desde el 1
 * de enero del año en curso. */
export function seasonStartFor(
  settingDate: string | null,
  today: string,
): string {
  if (settingDate === null || settingDate > today) {
    return firstOfJanuaryOf(today);
  }
  return settingDate;
}
