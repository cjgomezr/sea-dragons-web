import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import type { Dashboard, NextTraining } from "@/lib/dashboard/dashboard";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import { formatClockTime, formatPercent } from "@/lib/i18n/format";

/**
 * La pantalla de inicio (#426, RF-1 a RF-4 del PRD de E14). Qué se cuenta y
 * para quién lo decide `GET /api/v1/dashboard` (#424): aquí se prueba que la
 * pantalla pinta lo que responde, en el idioma y con la hora del club, y que
 * el RSVP de la tarjeta guarda como en el calendario.
 */

// 30 de septiembre de 2026 a las 18:00 en Melbourne (AEST, UTC+10).
const NOW = new Date("2026-09-30T08:00:00.000Z");
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const POOL_TRAINING: NextTraining = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Pool Training",
  startsOn: "2026-10-02",
  startTime: "19:00",
  location: "MSAC",
  goingCount: 14,
  maybeCount: 2,
  myResponse: "yes",
};

function agendaEvent(
  overrides: Partial<AgendaEvent> & Pick<AgendaEvent, "id" | "title">,
): AgendaEvent {
  return {
    startsOn: "2026-10-02",
    startTime: "19:00",
    eventType: "training",
    location: "MSAC Dive Pool",
    status: "scheduled",
    seriesId: null,
    goingCount: 0,
    maybeCount: 0,
    myResponse: null,
    inAudience: true,
    ...overrides,
  };
}

const UPCOMING: readonly AgendaEvent[] = [
  agendaEvent({ id: POOL_TRAINING.id, title: "Pool Training" }),
  agendaEvent({
    id: "bbbbbbbb-0000-4000-8000-00000000000b",
    title: "Skills & Conditioning",
    startsOn: "2026-10-04",
    location: "Fitzroy Pool",
  }),
  agendaEvent({
    id: "cccccccc-0000-4000-8000-00000000000c",
    title: "Scrimmage vs Geelong Krakens",
    startsOn: "2026-10-06",
    startTime: "10:00",
    eventType: "competition",
    location: "Geelong Aquatic Centre",
  }),
];

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_IN_MS).toISOString();
}

const LATEST_NEWS = [
  {
    id: "dddddddd-0000-4000-8000-00000000000d",
    category: "announcement",
    title: "Nationals squad shortlist announced",
    publishedAt: daysAgo(2),
  },
  {
    id: "eeeeeeee-0000-4000-8000-00000000000e",
    category: "news",
    title: "Winter training schedule is live",
    publishedAt: daysAgo(4),
  },
  {
    id: "ffffffff-0000-4000-8000-00000000000f",
    category: "document",
    title: "Updated pool safety & dive policy",
    publishedAt: daysAgo(8),
  },
] as const;

const ADMIN_DASHBOARD: Dashboard = {
  viewer: { firstName: "Alba" },
  tiles: {
    attendance: {
      kind: "club_rate",
      rate: { kind: "rate", percent: 86, records: 42 },
    },
    members: { kind: "members", active: 48, joinedRecently: 3 },
    nextTraining: { kind: "training", training: POOL_TRAINING },
    unreadNews: { kind: "unread", count: 3, announcements: 1 },
  },
  upcomingEvents: { kind: "events", events: UPCOMING },
  latestNews: { kind: "news", posts: LATEST_NEWS },
};

const PLAYER_DASHBOARD: Dashboard = {
  ...ADMIN_DASHBOARD,
  tiles: {
    ...ADMIN_DASHBOARD.tiles,
    attendance: {
      kind: "own_attendance",
      attendance: { kind: "rate", percent: 75, sessions: 6 },
    },
  },
};

const EMPTY_DASHBOARD: Dashboard = {
  viewer: { firstName: "Alba" },
  tiles: {
    attendance: { kind: "club_rate", rate: { kind: "no_data" } },
    members: { kind: "members", active: 1, joinedRecently: 0 },
    nextTraining: { kind: "none" },
    unreadNews: { kind: "unread", count: 0, announcements: 0 },
  },
  upcomingEvents: { kind: "events", events: [] },
  latestNews: { kind: "news", posts: [] },
};

type RecordedRequest = { readonly method: string; readonly path: string };

type Respond = (request: {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}) => Response | Promise<Response>;

const requests: RecordedRequest[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(respond: Respond): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      requests.push({ method, path: url.pathname });
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return respond({ method, url, body });
    }),
  );
}

function stubDashboard(dashboard: Dashboard): void {
  stubApi(() => jsonResponse(200, { data: dashboard }));
}

function rsvpPath(eventId: string): string {
  return `/api/v1/events/${eventId}/rsvp`;
}

function savedResponse(eventId: string, response: RsvpResponse): Response {
  return jsonResponse(200, {
    data: { eventId, response, respondedAt: NOW.toISOString() },
  });
}

function detailResponse(myResponse: RsvpResponse): Response {
  return jsonResponse(200, {
    data: {
      goingCount: 14,
      maybeCount: 3,
      myResponse,
      notes: null,
      going: [],
      maybe: [],
    },
  });
}

function setClubTime(instant: string): void {
  vi.setSystemTime(new Date(instant));
}

async function renderScreen(
  options: {
    readonly locale?: "en" | "es";
    readonly canCreateTrainings?: boolean;
  } = {},
): Promise<ReturnType<typeof render>> {
  const view = render(
    <DashboardScreen
      locale={options.locale ?? "en"}
      canCreateTrainings={options.canCreateTrainings ?? false}
    />,
  );
  await screen.findByRole("heading", { level: 1, name: /Alba/ });
  return view;
}

function tiles(): HTMLElement {
  return screen.getByRole("region", { name: "Club at a glance" });
}

function trainingCard(): HTMLElement {
  return screen.getByRole("region", { name: "Next training" });
}

/** La fila `index` de una lista, o un fallo que dice cuántas había. */
function rowAt(rows: readonly HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`No hay fila ${index}: la lista tiene ${rows.length}.`);
  }
  return row;
}

function rsvpButton(name: "Yes" | "Maybe" | "No"): HTMLElement {
  const group = within(trainingCard()).getByRole("group", {
    name: "RSVP: Pool Training",
  });
  return within(group).getByRole("button", { name });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setClubTime(NOW.toISOString());
  requests.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("el saludo", () => {
  it.each([
    ["2026-09-29T22:00:00.000Z", "Good morning, Alba"],
    ["2026-09-30T08:00:00.000Z", "Good afternoon, Alba"],
    ["2026-09-30T11:00:00.000Z", "Good evening, Alba"],
  ])("a las %s en UTC dice %s en la hora del club", async (instant, text) => {
    setClubTime(instant);
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: text }),
    ).toBeInTheDocument();
  });

  it.each([
    ["2026-09-29T22:00:00.000Z", "Buenos días, Alba"],
    ["2026-09-30T08:00:00.000Z", "Buenas tardes, Alba"],
    ["2026-09-30T11:00:00.000Z", "Buenas noches, Alba"],
  ])("a las %s en UTC dice %s en español", async (instant, text) => {
    setClubTime(instant);
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen({ locale: "es" });

    expect(
      screen.getByRole("heading", { level: 1, name: text }),
    ).toBeInTheDocument();
  });
});

describe("las teselas", () => {
  it("pinta a un Admin las cuatro en el orden del mockup, cada una enlazando a su sección", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    const links = within(tiles()).getAllByRole("link");
    expect(
      links.map((link) => [
        link.getAttribute("aria-label"),
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["Attendance rate: 86%", "/asistencia"],
      ["Active members: 48", "/directorio"],
      ["Next training: 2 d", "/calendario"],
      ["Unread news: 3", "/noticias"],
    ]);
  });

  it("pone debajo de cada valor su detalle", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    const region = tiles();
    expect(within(region).getByText("last 30 days")).toBeInTheDocument();
    expect(within(region).getByText("+3 this month")).toBeInTheDocument();
    expect(within(region).getByText("Fri · MSAC")).toBeInTheDocument();
    expect(within(region).getByText("1 announcement")).toBeInTheDocument();
  });

  it("enseña a un Player su asistencia, sin enlace a Asistencia", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    const region = tiles();
    expect(
      within(region).getByRole("group", { name: "Your attendance: 75%" }),
    ).toBeInTheDocument();
    expect(within(region).getByText("6 sessions")).toBeInTheDocument();
    expect(
      within(region).queryByRole("link", { name: /attendance/i }),
    ).not.toBeInTheDocument();
  });

  it("dice sin datos, sin entrenamiento y al día cuando no hay nada que contar", async () => {
    stubDashboard(EMPTY_DASHBOARD);

    await renderScreen();

    const region = tiles();
    expect(
      within(region).getByRole("link", { name: "Attendance rate: No data" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", {
        name: "Next training: No training scheduled",
      }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: "Unread news: All caught up" }),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/this month/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/announcement/)).not.toBeInTheDocument();
  });

  it("dice no disponible en la tesela que cayó y pinta las demás", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      tiles: { ...ADMIN_DASHBOARD.tiles, attendance: { kind: "unavailable" } },
    });

    await renderScreen();

    const region = tiles();
    expect(
      within(region).getByRole("group", { name: "Attendance: Unavailable" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: "Active members: 48" }),
    ).toBeInTheDocument();
  });

  it("dice hoy y la hora cuando el entrenamiento es hoy", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      tiles: {
        ...ADMIN_DASHBOARD.tiles,
        nextTraining: {
          kind: "training",
          training: { ...POOL_TRAINING, startsOn: "2026-09-30" },
        },
      },
    });

    await renderScreen();

    expect(
      within(tiles()).getByRole("link", {
        name: `Next training: today ${formatClockTime("en", "19:00")}`,
      }),
    ).toBeInTheDocument();
  });

  it("cuenta horas cuando faltan menos de 24", async () => {
    // 22:00 del 1 de octubre en Melbourne: el entrenamiento es mañana a las 19.
    setClubTime("2026-10-01T12:00:00.000Z");
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    expect(
      within(tiles()).getByRole("link", { name: "Next training: 21 h" }),
    ).toBeInTheDocument();
  });

  it("se oye en español con el porcentaje del idioma", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen({ locale: "es" });

    const region = screen.getByRole("region", {
      name: "El club de un vistazo",
    });
    expect(
      within(region).getByRole("link", {
        name: `Tasa de asistencia: ${formatPercent("es", 86)}`,
      }),
    ).toBeInTheDocument();
    expect(within(region).getByText("+3 este mes")).toBeInTheDocument();
    expect(within(region).getByText("1 anuncio")).toBeInTheDocument();
  });
});

describe("próximos y noticias", () => {
  it("pinta los tres próximos, cada uno enlazando al calendario, con su chip", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    const rows = within(upcoming).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const scrimmage = within(rowAt(rows, 2)).getByRole("link");
    expect(scrimmage).toHaveAttribute("href", "/calendario");
    expect(scrimmage).toHaveTextContent("Scrimmage vs Geelong Krakens");
    expect(scrimmage).toHaveTextContent("Geelong Aquatic Centre");
    expect(within(rowAt(rows, 2)).getByText("Competition")).toBeInTheDocument();
    expect(
      within(upcoming).getByRole("link", { name: "Calendar" }),
    ).toHaveAttribute("href", "/calendario");
  });

  it("pinta los que haya cuando son menos de tres", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      upcomingEvents: { kind: "events", events: UPCOMING.slice(0, 1) },
      latestNews: { kind: "news", posts: LATEST_NEWS.slice(0, 2) },
    });

    await renderScreen();

    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    const news = screen.getByRole("region", { name: "Latest news" });
    expect(within(upcoming).getAllByRole("listitem")).toHaveLength(1);
    expect(within(news).getAllByRole("listitem")).toHaveLength(2);
  });

  it("pinta las tres últimas noticias con su chip, su enlace y hace cuánto", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    const news = screen.getByRole("region", { name: "Latest news" });
    const rows = within(news).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(
      within(rowAt(rows, 0)).getByRole("link", {
        name: "Nationals squad shortlist announced",
      }),
    ).toHaveAttribute("href", `/noticias/${LATEST_NEWS[0].id}`);
    expect(
      within(rowAt(rows, 0)).getByText("Announcement"),
    ).toBeInTheDocument();
    expect(within(rowAt(rows, 0)).getByText("2 days ago")).toBeInTheDocument();
    expect(within(news).getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/noticias",
    );
  });

  it("sin eventos ni noticias dice una frase y deja el enlace", async () => {
    stubDashboard(EMPTY_DASHBOARD);

    await renderScreen();

    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    const news = screen.getByRole("region", { name: "Latest news" });
    expect(
      within(upcoming).getByText("No upcoming events."),
    ).toBeInTheDocument();
    expect(
      within(upcoming).getByRole("link", { name: "Calendar" }),
    ).toBeInTheDocument();
    expect(within(news).getByText("No news yet.")).toBeInTheDocument();
    expect(within(news).getByRole("link", { name: "All" })).toBeInTheDocument();
  });

  it("dice no disponible en la lista que cayó", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      latestNews: { kind: "unavailable" },
    });

    await renderScreen();

    const news = screen.getByRole("region", { name: "Latest news" });
    expect(within(news).getByText("Unavailable")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Upcoming" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(3);
  });

  it("cambia cabeceras y hace cuánto con el idioma sin volver a pedir", async () => {
    stubDashboard(ADMIN_DASHBOARD);
    const view = await renderScreen();

    view.rerender(<DashboardScreen locale="es" canCreateTrainings={false} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Buenas tardes, Alba" }),
    ).toBeInTheDocument();
    const news = screen.getByRole("region", { name: "Últimas noticias" });
    expect(within(news).getByText("hace 4 días")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Próximos" }),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });
});

describe("el RSVP del móvil", () => {
  it("marca la respuesta actual", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    expect(rsvpButton("Yes")).toHaveAttribute("aria-pressed", "true");
    expect(rsvpButton("Maybe")).toHaveAttribute("aria-pressed", "false");
    expect(rsvpButton("No")).toHaveAttribute("aria-pressed", "false");
  });

  it("guarda la respuesta como en el calendario y la marca", async () => {
    stubApi(({ method, url, body }) => {
      if (method === "PUT") {
        expect(url.pathname).toBe(rsvpPath(POOL_TRAINING.id));
        expect(body).toEqual({ response: "maybe" });
        return savedResponse(POOL_TRAINING.id, "maybe");
      }
      if (url.pathname === `/api/v1/events/${POOL_TRAINING.id}`) {
        return detailResponse("maybe");
      }
      return jsonResponse(200, { data: ADMIN_DASHBOARD });
    });
    await renderScreen();

    await userEvent.click(rsvpButton("Maybe"));

    await waitFor(() =>
      expect(rsvpButton("Maybe")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(rsvpButton("Yes")).toHaveAttribute("aria-pressed", "false");
  });

  it("un doble toque manda una sola respuesta", async () => {
    let releaseSave: () => void = () => undefined;
    stubApi(async ({ method, url }) => {
      if (method === "PUT") {
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        return savedResponse(POOL_TRAINING.id, "no");
      }
      if (url.pathname === `/api/v1/events/${POOL_TRAINING.id}`) {
        return detailResponse("no");
      }
      return jsonResponse(200, { data: ADMIN_DASHBOARD });
    });
    await renderScreen();

    await userEvent.click(rsvpButton("No"));
    await userEvent.click(rsvpButton("Maybe"));
    releaseSave();

    await waitFor(() =>
      expect(rsvpButton("No")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(requests.filter((request) => request.method === "PUT")).toEqual([
      { method: "PUT", path: rsvpPath(POOL_TRAINING.id) },
    ]);
  });

  it("no hay tarjeta sin entrenamiento a la vista", async () => {
    stubDashboard(EMPTY_DASHBOARD);

    await renderScreen();

    expect(
      screen.queryByRole("region", { name: "Next training" }),
    ).not.toBeInTheDocument();
  });
});

describe("nuevo entrenamiento", () => {
  it("lo ve quien puede crear entrenamientos y abre el calendario con el formulario", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen({ canCreateTrainings: true });

    expect(screen.getByRole("link", { name: "New training" })).toHaveAttribute(
      "href",
      "/calendario?nuevo=training",
    );
  });

  it("no lo ve quien no puede", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen({ canCreateTrainings: false });

    expect(
      screen.queryByRole("link", { name: "New training" }),
    ).not.toBeInTheDocument();
  });
});

describe("errores", () => {
  it("dice que falló la red y vuelve a pedir al reintentar", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { data: ADMIN_DASHBOARD });
    });
    render(<DashboardScreen locale="en" canCreateTrainings={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Good afternoon, Alba",
      }),
    ).toBeInTheDocument();
  });

  it("dice que no se pudo cargar cuando la API responde con error", async () => {
    stubApi(() =>
      jsonResponse(500, {
        error: { code: "internal_error", message: "Falló." },
      }),
    );
    render(<DashboardScreen locale="en" canCreateTrainings={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the dashboard. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
