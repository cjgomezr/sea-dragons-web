import "@testing-library/jest-dom/vitest";
import { assertTestSupabaseEnvironment } from "@/lib/supabase/environment-guard";
import { loadLocalEnvFile } from "./tests/support/load-local-env";

// Antes que cualquier test pueda abrir un cliente de Supabase real: si
// `.env.local` apunta a un proyecto que no es `seadragons-dev`, la corrida
// entera falla aquí, no solo el archivo de test que hubiera intentado usarlo.
loadLocalEnvFile();
assertTestSupabaseEnvironment();

// jsdom ships no matchMedia, and the theme resolver asks it for the OS
// preference. Default to light so tests state their own preference explicitly.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
