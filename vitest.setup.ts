import "@testing-library/jest-dom/vitest";

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
