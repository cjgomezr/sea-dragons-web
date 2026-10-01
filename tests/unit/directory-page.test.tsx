import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * La página del directorio pasa a la pantalla el texto de `?q=` (#427): es a
 * donde llevan "Ver todos" y un socio de la búsqueda global.
 */

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));

const { default: DirectorioPage } = await import("@/app/(app)/directorio/page");

function stubDirectory(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { kind: "member", members: [] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("página del directorio", () => {
  it("pone en la búsqueda el texto que llega en ?q=", async () => {
    stubDirectory();

    render(
      await DirectorioPage({ searchParams: Promise.resolve({ q: "Grace" }) }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Search by name")).toHaveValue("Grace"),
    );
  });

  it("sin ?q= arranca con la búsqueda vacía", async () => {
    stubDirectory();

    render(await DirectorioPage({ searchParams: Promise.resolve({}) }));

    await waitFor(() =>
      expect(screen.getByLabelText("Search by name")).toHaveValue(""),
    );
  });
});
