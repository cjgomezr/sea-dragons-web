import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUIET_CLUB_SUMMARY } from "./helpers/club-summary";

/**
 * La página del directorio pasa a la pantalla el texto de `?q=` (#427): es a
 * donde llevan "Ver todos" y un socio de la búsqueda global.
 */

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));

vi.mock("@/lib/club/supabase-club-brand", async () => {
  const { DEFAULT_CLUB_BRAND } = await import("@/lib/club/club-brand");
  return { readClubBrand: async () => DEFAULT_CLUB_BRAND };
});

const { default: DirectorioPage } = await import("@/app/(app)/directorio/page");

const directoryRequests: string[] = [];

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubDirectory(kind: "admin" | "member" = "member"): void {
  directoryRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/club/positions") {
        return jsonResponse({ data: { positions: [] } });
      }
      if (url === "/api/v1/groups") {
        return jsonResponse({ data: { groups: [] } });
      }
      if (url.startsWith("/api/v1/role-requests")) {
        return jsonResponse({ data: { requests: [] } });
      }
      directoryRequests.push(url);
      return jsonResponse({
        data: {
          kind,
          members: [],
          availableFilters: ["position"],
          total: 0,
          ...(kind === "admin" ? { summary: QUIET_CLUB_SUMMARY } : {}),
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

  it("con ?invite=1 un Admin llega con el panel de invitar abierto (#862)", async () => {
    stubDirectory("admin");

    render(
      await DirectorioPage({ searchParams: Promise.resolve({ invite: "1" }) }),
    );

    expect(
      await screen.findByRole("region", { name: "Invite a member" }),
    ).toBeVisible();
  });

  it("con ?invite=1 quien no es Admin no ve el panel (#862)", async () => {
    stubDirectory("member");

    render(
      await DirectorioPage({ searchParams: Promise.resolve({ invite: "1" }) }),
    );

    await waitFor(() => expect(directoryRequests).toHaveLength(1));
    await screen.findByLabelText("Search by name");
    expect(
      screen.queryByRole("region", { name: "Invite a member" }),
    ).not.toBeInTheDocument();
  });
});
