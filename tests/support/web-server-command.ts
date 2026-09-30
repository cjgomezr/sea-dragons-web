/**
 * Qué levanta Playwright para servir la aplicación.
 *
 * En CI, la aplicación compilada: `next dev` compila cada pantalla la primera
 * vez que alguien la pide, y con cientos de pruebas en paralelo esa espera
 * hacía fallar cada corrida un test distinto, siempre por tiempo (#254). El
 * workflow compila antes de lanzar la suite (#255). En local sigue `next dev`,
 * que no obliga a compilar tras cada cambio.
 */
type Environment = Readonly<Record<string, string | undefined>>;

export function webServerCommand(environment: Environment): string {
  return servesCompiledApp(environment) ? "npm run start" : "npm run dev";
}

/** Lo que sólo pasa en la aplicación compilada, como la precarga de los
 * enlaces (Next la apaga en `next dev`), sólo se puede probar aquí (#435). */
export function servesCompiledApp(environment: Environment): boolean {
  return Boolean(environment.CI);
}
