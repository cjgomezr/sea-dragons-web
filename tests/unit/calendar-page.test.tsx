import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";

/**
 * La página del Calendario decide en el servidor, con el rol de la sesión, si
 * se pinta "+ Evento" (#313, RF-9 del PRD de E7). El endpoint ya rechaza a
 * quien no tiene `createEvents` (#307): el botón no es la defensa.
 */

const callerRole = { current: "Player" as Role };
const callerMembershipCurrent = { current: true };

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));
vi.mock("@/lib/auth/caller-role", () => ({
  readCallerRole: async () => callerRole.current,
  readCallerAccess: async () => ({
    role: callerRole.current,
    membershipCurrent: callerMembershipCurrent.current,
  }),
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
  callerMembershipCurrent.current = true;
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

// #427: un evento de la búsqueda global llega con su id y, si ya pasó, con
// el periodo.
describe("llegar a un evento", () => {
  it("con ?periodo=past abre los pasados", async () => {
    callerRole.current = "Player";
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return new Response(
          JSON.stringify({ data: { events: [], nextCursor: null } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    render(
      await CalendarioPage({
        searchParams: Promise.resolve({ evento: "evento-1", periodo: "past" }),
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Past events" }),
    ).toBeInTheDocument();
    expect(requested).toEqual(["/api/v1/events?period=past"]);
  });

  it("un periodo que no conoce abre los próximos", async () => {
    callerRole.current = "Player";
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

    render(
      await CalendarioPage({
        searchParams: Promise.resolve({ periodo: "ayer" }),
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Upcoming events" }),
    ).toBeInTheDocument();
  });
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

// #453: quien no tiene la membresía al día ve el calendario en lectura.
describe("el calendario de quien no tiene la membresía al día", () => {
  it("le deshabilita el RSVP y le enlaza Pagos", async () => {
    callerMembershipCurrent.current = false;
    callerRole.current = "Player";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                events: [
                  {
                    id: "aaaaaaaa-0000-4000-8000-00000000000a",
                    seriesId: null,
                    title: "Pool training",
                    eventType: "training",
                    startsOn: "2999-06-23",
                    startTime: "19:00",
                    location: "MSAC",
                    status: "scheduled",
                    inAudience: true,
                    goingCount: 1,
                    maybeCount: 0,
                    myResponse: null,
                  },
                ],
                nextCursor: null,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    render(await CalendarioPage({ searchParams: Promise.resolve({}) }));

    expect(await screen.findByRole("button", { name: "Yes" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Go to Payments" }),
    ).toBeInTheDocument();
  });
});
