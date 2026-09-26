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

// jsdom has HTMLDialogElement and its `open`, but not `showModal` nor `close`
// (jsdom/jsdom#3294). The photo viewer (#355) opens a modal `<dialog>`: this
// gives tests the open/close half. The top layer and the inert page behind it
// only exist in a real browser, so Playwright covers those.
if (!("showModal" in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement): void {
      this.open = true;
    },
    close(this: HTMLDialogElement): void {
      if (!this.open) {
        return;
      }
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
}
