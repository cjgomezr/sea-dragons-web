import { render, screen, within } from "@testing-library/react";
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

const GROUPS_PATH = "/api/v1/groups";

type SearchParams = Record<string, string | string[] | undefined>;

async function renderAs(
  role: Role,
  searchParams: SearchParams = {},
): Promise<void> {
  callerRole.current = role;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      // El diálogo de crear pide los grupos para la audiencia.
      const payload = input.startsWith(GROUPS_PATH)
        ? { data: { groups: [] } }
        : { data: { events: [], nextCursor: null } };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  render(await CalendarioPage({ searchParams: Promise.resolve(searchParams) }));
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

describe("?nuevo= desde el inicio (#426)", () => {
  it("abre a un Admin el formulario de crear con entrenamiento elegido", async () => {
    await renderAs("Admin", { nuevo: "training" });

    const dialog = await screen.findByRole("dialog", { name: "New event" });
    expect(within(dialog).getByRole("combobox", { name: "Type" })).toHaveValue(
      "training",
    );
  });

  it("elige el tipo que nombra el parámetro", async () => {
    await renderAs("Committee", { nuevo: "meeting" });

    const dialog = await screen.findByRole("dialog", { name: "New event" });
    expect(within(dialog).getByRole("combobox", { name: "Type" })).toHaveValue(
      "meeting",
    );
  });

  it("no abre nada a quien no puede crear eventos", async () => {
    await renderAs("Player", { nuevo: "training" });

    expect(
      screen.queryByRole("dialog", { name: "New event" }),
    ).not.toBeInTheDocument();
  });

  it("no abre nada con un tipo que no existe", async () => {
    await renderAs("Admin", { nuevo: "picnic" });

    expect(
      screen.queryByRole("dialog", { name: "New event" }),
    ).not.toBeInTheDocument();
  });
});
