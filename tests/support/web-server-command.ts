/**
 * Qué levanta Playwright para servir la aplicación.
 *
 * En CI, la aplicación compilada: `next dev` compila cada pantalla la primera
 * vez que alguien la pide, y con cientos de pruebas en paralelo esa espera
 * hacía fallar cada corrida un test distinto, siempre por tiempo (#254). El
 * workflow compila antes de lanzar la suite (#255). En local sigue `next dev`,
 * que no obliga a compilar tras cada cambio.
 */
export function webServerCommand(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return environment.CI ? "npm run start" : "npm run dev";
}
