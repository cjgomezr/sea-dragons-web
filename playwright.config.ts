import { defineConfig, devices } from "@playwright/test";
import { webServerCommand } from "./tests/support/web-server-command";

const APP_URL = process.env.APP_URL ?? "http://localhost:3417";

export default defineConfig({
  testDir: "./tests",
  // *.spec.ts only: tests/unit/**/*.test.ts belongs to Vitest.
  testMatch: "**/*.spec.ts",
  // Dos cosas antes del primer test. Sólo Linux tiene línea base visual
  // versionada (issue #58): en cualquier otra plataforma el arranque avisa de
  // que la comparación es informativa, no la que decide si el PR pasa. Y
  // desde #135 la cáscara de la aplicación está detrás de la frontera de
  // sesión, así que hace falta un socio de prueba con el que entrar.
  globalSetup: "./tests/support/playwright-global-setup.ts",
  // Borra ese socio de `seadragons-dev` al terminar.
  globalTeardown: "./tests/support/playwright-global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Hasta el #255 la suite corría en CI contra `next dev`, que compila cada
  // pantalla la primera vez que alguien la pide, y con los 5 s por defecto
  // fallaba cada vez un test distinto, siempre por tiempo y sin nada roto
  // (#254). Ahora CI sirve la aplicación compilada, que quita esa causa, pero
  // cada máquina sigue corriendo su parte de la suite en paralelo contra
  // Supabase. 15 s no debilita ninguna comprobación: lo que está roto falla
  // igual, solo deja de fallar lo que era lento.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: APP_URL,
    // Las pantallas salen en el idioma que pide el navegador (E17), y sin
    // esto Playwright pide el de la máquina: las capturas y los textos que
    // buscan los tests cambiarían según quién corra la suite.
    locale: "en-AU",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: webServerCommand(process.env),
    url: APP_URL,
    // Off a propósito: si algo ya responde en esa URL, Playwright falla en vez
    // de adoptarlo. Un servidor ajeno en el puerto haría que la suite compare
    // baselines contra otra app. Para reusar el tuyo: FABRICA_REUSE_SERVER=1.
    reuseExistingServer: !!process.env.FABRICA_REUSE_SERVER,
    timeout: 120_000,
  },
});
