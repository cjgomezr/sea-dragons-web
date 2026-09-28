import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";

/**
 * La página del Calendario decide en el servidor, con el rol de la sesión, si
 * se pinta "+ Evento" (#313, RF-9 del PRD de E7). El endpoint ya rechaza a
 * quien no tiene `createEvents` (#307): el botón no es la defensa.
 */

const callerRole = { current: "Player" as Role };

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));
vi.mock("@/lib/auth/caller-role", () => ({
  readCallerRole: async () => callerRole.current,
}));

const { default: CalendarioPage } = await import("@/app/(app)/calendario/page");

async function renderAs(role: Role): Promise<void> {
  callerRole.current = role;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { events: [], nextCursor: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  render(await CalendarioPage());
  await screen.findByText("There are no upcoming events.");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("botón + Evento en la página", () => {
  it.each<Role>(["Admin", "Committee"])(
    "lo ve un %s, que puede crear eventos",
    async (role) => {
      await renderAs(role);

      expect(screen.getByRole("button", { name: "Event" })).toBeInTheDocument();
    },
  );

  it.each<Role>(["Coach", "Player"])(
    "no lo ve un %s, que no puede crear eventos",
    async (role) => {
      await renderAs(role);

      expect(
        screen.queryByRole("button", { name: "Event" }),
      ).not.toBeInTheDocument();
    },
  );
});
