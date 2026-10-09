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

const directoryRequests: string[] = [];

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubDirectory(): void {
  directoryRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/club/positions") {
        return jsonResponse({ data: { positions: [] } });
      }
      directoryRequests.push(url);
      return jsonResponse({
        data: {
          kind: "member",
          members: [],
          availableFilters: ["position"],
          total: 0,
        },
      });
    }),
  );
}

function lastDirectoryRequest(): URLSearchParams {
  return new URL(directoryRequests.at(-1) ?? "", "http://localhost")
    .searchParams;
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

  it("pide al directorio los filtros que trae la dirección (#497)", async () => {
    stubDirectory();

    render(
      await DirectorioPage({
        searchParams: Promise.resolve({ position: "none", sort: "role" }),
      }),
    );

    await waitFor(() => expect(directoryRequests).toHaveLength(1));
    expect(lastDirectoryRequest().get("position")).toBe("none");
    expect(lastDirectoryRequest().get("sort")).toBe("role");
  });

  it("con una dirección que no sabe leer arranca sin filtros", async () => {
    stubDirectory();

    render(
      await DirectorioPage({
        searchParams: Promise.resolve({ auf: "soon", q: "Grace" }),
      }),
    );

    await waitFor(() => expect(directoryRequests).toHaveLength(1));
    expect(lastDirectoryRequest().get("auf")).toBeNull();
    expect(lastDirectoryRequest().get("q")).toBeNull();
  });

  it("sin ?q= arranca con la búsqueda vacía", async () => {
    stubDirectory();

    render(await DirectorioPage({ searchParams: Promise.resolve({}) }));

    await waitFor(() =>
      expect(screen.getByLabelText("Search by name")).toHaveValue(""),
    );
  });
});
