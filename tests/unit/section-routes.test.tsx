import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
import type { MembershipStatus } from "@/lib/membership/membership";
import type { MembershipView } from "@/lib/membership/membership-view";

const requestLocale = { current: "en" as Locale };
const callerRole = { current: "Player" as Role };

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => requestLocale.current,
}));
// La marca sale de la base (#292): la del test es otra que la de Victoria,
// así que un nombre escrito a mano en la pantalla no pasaría.
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => ({ name: "Hobart Orcas", initials: "HO" }),
}));
vi.mock("@/lib/auth/caller-role", () => ({
  readCallerRole: async () => callerRole.current,
}));
const callerStatus = { current: "active" as MembershipStatus };
vi.mock("@/lib/membership/caller-membership", () => ({
  readCallerMembershipView: async (): Promise<MembershipView> => ({
    paymentsConfigured: true,
    membership: { plan: "Full", status: callerStatus.current, trialEnd: null },
  }),
}));

const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
const { default: PagosPage } = await import("@/app/(app)/pagos/page");
const { default: HomePage } = await import("@/app/(app)/page");

type ServerPage = (props: {
  readonly searchParams: Promise<Record<string, string>>;
}) => Promise<React.JSX.Element>;

async function renderIn(locale: Locale, Page: ServerPage): Promise<void> {
  requestLocale.current = locale;
  render(await Page({ searchParams: Promise.resolve({}) }));
}

/** Las secciones que siguen siendo un marcador de posición. El directorio
 * salió de aquí en #239, Noticias en #329, Evaluaciones en #322, el
 * Calendario en #311, Equipos en #402 y el Dashboard en #426, que les dieron
 * su pantalla: lo que enseña cada una se prueba en su test de
 * `tests/unit/components/`. */
const SECTIONS: ReadonlyArray<
  readonly [english: string, spanish: string, Page: ServerPage]
> = [["Payments", "Pagos", PagosPage]];

describe("secciones", () => {
  it.each(SECTIONS)(
    "la ruta de %s se titula y avisa en inglés que está en construcción",
    async (english, _spanish, Page) => {
      await renderIn("en", Page);

      expect(
        screen.getByRole("heading", { level: 1, name: english }),
      ).toBeInTheDocument();
      expect(screen.getByText(/under construction/i)).toBeInTheDocument();
    },
  );

  it.each(SECTIONS)(
    "la ruta de %s dice en español lo mismo que antes de traducirla",
    async (_english, spanish, Page) => {
      await renderIn("es", Page);

      expect(
        screen.getByRole("heading", { level: 1, name: spanish }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Esta sección está en construcción."),
      ).toBeInTheDocument();
    },
  );
});

// #453: Pagos es a donde la frontera lleva a quien no está al día, y le dice
// por qué. Lo que ofrece a cada uno (#454) se prueba en
// `tests/unit/components/payments-screen.test.tsx`.
describe("Pagos de quien no tiene la membresía al día", () => {
  afterEach(() => {
    callerStatus.current = "active";
  });

  it.each<[MembershipStatus, string]>([
    ["pending", "Your membership is pending: you haven't added a card yet."],
    ["past_due", "Your last payment didn't go through."],
    ["cancelled", "Your membership is cancelled."],
  ])("dice el motivo de una membresía %s", async (status, reason) => {
    callerStatus.current = status;

    await renderIn("en", PagosPage);

    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(
      screen.getByText(/you only see your profile, Payments and the calendar/),
    ).toBeInTheDocument();
  });

  it("dice el motivo en español", async () => {
    callerStatus.current = "past_due";

    await renderIn("es", PagosPage);

    expect(
      screen.getByText("Tu último pago no se pudo cobrar."),
    ).toBeInTheDocument();
  });

  it("lee de la dirección con qué vuelve el socio de Checkout", async () => {
    callerStatus.current = "pending";
    requestLocale.current = "en";

    render(
      await PagosPage({
        searchParams: Promise.resolve({ checkout: "cancelado" }),
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /without adding a card/,
    );
  });

  it("no dice ningún motivo a quien está al día", async () => {
    await renderIn("en", PagosPage);

    expect(screen.queryByText(/only see your profile/)).not.toBeInTheDocument();
  });
});

describe("panel principal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // La pantalla pide el dashboard al montarse; aquí sólo importa qué ruta
  // la pinta, así que la petición se queda sin responder.
  function stubPendingDashboard(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
  }

  it.each<[string, ServerPage]>([
    ["/", HomePage],
    ["/dashboard", DashboardPage],
  ])(
    "%s pinta el dashboard y no el marcador del bootstrap",
    async (_path, Page) => {
      stubPendingDashboard();

      await renderIn("en", Page);

      expect(
        screen.getByRole("heading", { level: 1, name: "Dashboard" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Service status")).not.toBeInTheDocument();
      expect(screen.queryByText(/under construction/i)).not.toBeInTheDocument();
    },
  );

  /** Un dashboard vacío pero cargado: la cabecera, donde vive el botón, sólo
   * se pinta cuando la petición ya llegó. */
  function stubLoadedDashboard(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                kind: "member",
                viewer: { firstName: "Alba" },
                tiles: {
                  attendance: { kind: "unavailable" },
                  members: { kind: "unavailable" },
                  nextTraining: { kind: "none" },
                  unreadNews: { kind: "unavailable" },
                },
                upcomingEvents: { kind: "events", events: [] },
                latestNews: { kind: "news", posts: [] },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
  }

  it("ofrece Nuevo entrenamiento al Admin cuando llega el dashboard", async () => {
    callerRole.current = "Admin";
    stubLoadedDashboard();

    await renderIn("en", HomePage);

    expect(
      await screen.findByRole("link", { name: "New training" }),
    ).toBeInTheDocument();
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "no ofrece Nuevo entrenamiento a un %s ni con el dashboard cargado",
    async (role) => {
      callerRole.current = role;
      stubLoadedDashboard();

      await renderIn("en", HomePage);

      // Con la petición sin responder el botón no estaría para nadie: hay que
      // esperar al saludo, que llega con la misma respuesta que la cabecera.
      await screen.findByRole("heading", { level: 1, name: /Alba/ });
      expect(
        screen.queryByRole("link", { name: "New training" }),
      ).not.toBeInTheDocument();
    },
  );
});
