import type { Page } from "@playwright/test";

/**
 * La hora a la que se fotografía el inicio (#561).
 *
 * El saludo del inicio ("Good morning / afternoon / evening") sale de la hora
 * del navegador. Sin fijarla, la captura dependía de a qué hora corría la
 * visual: la línea base aceptada por la mañana en Melbourne fallaba en la
 * corrida de la tarde. Miércoles 30 de septiembre de 2026 a las 18:00 en
 * Melbourne (AEST), lejos de las horas en que cambia el saludo.
 */
export const HOME_NOW = new Date("2026-09-30T08:00:00.000Z");

/** Las rutas que pintan el inicio, de fondo o en primer plano. */
const HOME_SCREEN_PATHS: ReadonlySet<string> = new Set(["/", "/dashboard"]);

/** Sólo para leer la ruta de un camino relativo; no se visita. */
const PATH_PARSING_BASE = "http://localhost";

/** Lo único del `page` de Playwright que hace falta para fijar la hora. */
export type ClockPage = Pick<Page, "clock">;

export function showsHome(path: string): boolean {
  return HOME_SCREEN_PATHS.has(new URL(path, PATH_PARSING_BASE).pathname);
}

/** Fija la hora antes de visitar `path` si esa pantalla es el inicio. */
export async function fixClockOnHome(
  page: ClockPage,
  path: string,
): Promise<void> {
  if (!showsHome(path)) {
    return;
  }
  await page.clock.setFixedTime(HOME_NOW);
}
