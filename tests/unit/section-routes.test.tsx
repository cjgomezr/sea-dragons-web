import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locale";
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

// Pagos dejó de ser un marcador con #455, la última sección que lo era: lo
// que enseña se prueba en `tests/unit/components/payments-screen.test.tsx`.
// Aquí sólo importa que la ruta le pase con qué se vuelve de Stripe.
describe("Pagos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMembership(view: MembershipView): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: view }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  }

  const ACTIVE_PANEL: NonNullable<MembershipView["membership"]> = {
    plan: "Full",
    status: "active",
    monthlyPriceCents: 4500,
    trialEnd: null,
    nextChargeAt: "2026-11-01T09:00:00.000Z",
    card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
    waiver: null,
    scheduledChange: null,
    canChangePlan: false,
  };
  const ACTIVE_FULL: MembershipView = {
    paymentsConfigured: true,
    membership: ACTIVE_PANEL,
    payments: [],
  };

  it("lee de la dirección con qué vuelve el socio de Checkout", async () => {
    stubMembership({
      ...ACTIVE_FULL,
      membership: { ...ACTIVE_PANEL, status: "pending", card: null },
    });
    requestLocale.current = "en";

    render(
      await PagosPage({
        searchParams: Promise.resolve({ checkout: "cancelado" }),
      }),
    );

    expect(await screen.findByText(/without adding a card/)).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("lee de la dirección con qué vuelve el socio de cambiar la tarjeta", async () => {
    stubMembership(ACTIVE_FULL);
    requestLocale.current = "en";

    render(
      await PagosPage({
        searchParams: Promise.resolve({ tarjeta: "cancelado" }),
      }),
    );

    expect(
      await screen.findByText(/without changing your card/),
    ).toHaveAttribute("role", "status");
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
