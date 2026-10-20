import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import type { OpenableSections } from "@/components/dashboard/ManagementColumn";
import type {
  Dashboard,
  DashboardNextUpEvent,
  MemberDashboard,
  NextTraining,
  NextUp,
  NextUpTeam,
  RestrictedDashboard,
} from "@/lib/dashboard/dashboard";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { ContactReminder } from "@/lib/members/contact-reminder";

/**
 * La pantalla de inicio (#426, RF-1 a RF-4 del PRD de E14). Qué se cuenta y
 * para quién lo decide `GET /api/v1/dashboard` (#424): aquí se prueba que la
 * pantalla pinta lo que responde, en el idioma y con la hora del club, y que
 * el RSVP de la tarjeta guarda como en el calendario.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

// 30 de septiembre de 2026 a las 18:00 en Melbourne (AEST, UTC+10).
const NOW = new Date("2026-09-30T08:00:00.000Z");
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const ALL_SECTIONS: OpenableSections = {
  attendance: true,
  directory: true,
  news: true,
};

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
    endTime: null,
    endsOn: null,
    eventType: "training",
    location: "MSAC Dive Pool",
    place: null,
    placeDetail: null,
    status: "scheduled",
    seriesId: null,
    goingCount: 0,
    maybeCount: 0,
    myResponse: null,
    inAudience: true,
    coverThumbUrl: null,
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
    coverUrl: null,
    excerpt: "",
    isPinned: false,
    isUnread: false,
  },
  {
    id: "eeeeeeee-0000-4000-8000-00000000000e",
    category: "news",
    title: "Winter training schedule is live",
    publishedAt: daysAgo(4),
    coverUrl: null,
    excerpt: "",
    isPinned: false,
    isUnread: false,
  },
  {
    id: "ffffffff-0000-4000-8000-00000000000f",
    category: "document",
    title: "Updated pool safety & dive policy",
    publishedAt: daysAgo(8),
    coverUrl: null,
    excerpt: "",
    isPinned: false,
    isUnread: false,
  },
] as const;

const NEXT_UP: DashboardNextUpEvent = {
  kind: "event",
  id: POOL_TRAINING.id,
  title: "Saturday scrimmage",
  eventType: "training",
  startsOn: "2026-10-02",
  endsOn: null,
  startTime: "09:00",
  endTime: "11:00",
  location: "Princes Park · Field 2",
  place: {
    name: "Princes Park",
    address: "Princes Park Dr, Carlton North VIC 3054",
    lat: -37.7826,
    lng: 144.9611,
  },
  coverUrl: null,
  audience: { kind: "club" },
  goingCount: 14,
  maybeCount: 3,
  myResponse: "yes",
  myTeam: null,
};

const KELP_TEAM: NextUpTeam = {
  name: "Team Kelp",
  color: "#1C6EA4",
  position: {
    id: "12121212-0000-4000-8000-000000000012",
    names: { en: "Full back", es: "Defensa" },
  },
};

const ADMIN_DASHBOARD: MemberDashboard = {
  kind: "member",
  column: "management",
  todos: [],
  club: {
    attendance: { percent: 86, previousPercent: 80 },
    members: { active: 48, joinedThisMonth: 3 },
    unreadNews: { count: 3, announcements: 1 },
  },
  viewer: { firstName: "Alba" },
  me: { attendance: null },
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
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: { ...NEXT_UP, teamsStatus: "none" },
  week: { kind: "week", events: [] },
  membership: { status: "active", plan: "Full", renewsOn: null },
};

const PLAYER_DASHBOARD: MemberDashboard = {
  ...ADMIN_DASHBOARD,
  column: "player",
  tiles: {
    ...ADMIN_DASHBOARD.tiles,
    attendance: {
      kind: "own_attendance",
      attendance: { kind: "rate", percent: 75, sessions: 6 },
    },
  },
  nextUp: NEXT_UP,
};

const EMPTY_DASHBOARD: MemberDashboard = {
  kind: "member",
  column: "player",
  viewer: { firstName: "Alba" },
  me: { attendance: null },
  tiles: {
    attendance: { kind: "club_rate", rate: { kind: "no_data" } },
    members: { kind: "members", active: 1, joinedRecently: 0 },
    nextTraining: { kind: "none" },
    unreadNews: { kind: "unread", count: 0, announcements: 0 },
  },
  upcomingEvents: { kind: "events", events: [] },
  latestNews: { kind: "news", posts: [] },
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: { kind: "none" },
  week: { kind: "week", events: [] },
  membership: { status: "active", plan: "Full", renewsOn: null },
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

function setClubTime(instant: string): void {
  vi.setSystemTime(new Date(instant));
}

async function renderScreen(
  options: {
    readonly locale?: "en" | "es";
    readonly canCreateEvents?: boolean;
    readonly openableSections?: OpenableSections;
  } = {},
): Promise<ReturnType<typeof render>> {
  const view = render(
    <DashboardScreen
      locale={options.locale ?? "en"}
      userId={USER_ID}
      canCreateEvents={options.canCreateEvents ?? false}
      openableSections={options.openableSections ?? ALL_SECTIONS}
    />,
  );
  await screen.findByRole("heading", { level: 1, name: /Alba/ });
  return view;
}

function nextUpCard(): HTMLElement {
  return screen.getByRole("region", { name: "Next up" });
}

/** La fila `index` de una lista, o un fallo que dice cuántas había. */
function rowAt(rows: readonly HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`No hay fila ${index}: la lista tiene ${rows.length}.`);
  }
  return row;
}

function rsvpButton(name: "Going" | "Maybe" | "Can't go"): HTMLElement {
  const group = within(nextUpCard()).getByRole("group", {
    name: `RSVP: ${NEXT_UP.title}`,
  });
  return within(group).getByRole("button", { name });
}

function withNextUp(
  nextUp: NextUp,
  dashboard: Dashboard = PLAYER_DASHBOARD,
): Dashboard {
  return { ...dashboard, nextUp };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setClubTime(NOW.toISOString());
  requests.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
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

    view.rerender(
      <DashboardScreen
        locale="es"
        userId={USER_ID}
        canCreateEvents={false}
        openableSections={ALL_SECTIONS}
      />,
    );

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

describe("la cabecera (#747)", () => {
  it("lleva el día del club y la sección encima del saludo", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    expect(screen.getByText("Wed 30 Sep · Dashboard")).toBeInTheDocument();
  });

  it("dice el día en español", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen({ locale: "es" });

    expect(screen.getByText("mié 30 sep · Inicio")).toBeInTheDocument();
  });

  it("ofrece + Evento a quien puede crear eventos y abre el calendario con el formulario", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen({ canCreateEvents: true });

    const newEvent = screen.getByRole("link", { name: "New event" });
    expect(newEvent).toHaveAttribute("href", "/calendario?nuevo=training");
    expect(newEvent).toHaveTextContent("Event");
  });

  it("no ofrece + Evento a quien no puede", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen({ canCreateEvents: false });

    expect(
      screen.queryByRole("link", { name: "New event" }),
    ).not.toBeInTheDocument();
  });

  it("ya no pinta las teselas ni la tarjeta del entrenamiento", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen();

    expect(
      screen.queryByRole("region", { name: "Club at a glance" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Next training" }),
    ).not.toBeInTheDocument();
  });
});

describe("la columna de gestión (#750)", () => {
  it("pinta Pendientes y los números del club a Admin, Coach y Committee", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      todos: [{ kind: "role_requests", count: 2 }],
    });

    await renderScreen();

    const todos = screen.getByRole("region", { name: "To do" });
    expect(within(todos).getByText("2 role requests")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Club numbers" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Membership" }),
    ).not.toBeInTheDocument();
  });

  it("enlaza los números sólo a las secciones que el rol puede abrir", async () => {
    stubDashboard(ADMIN_DASHBOARD);

    await renderScreen({
      openableSections: { attendance: false, directory: false, news: true },
    });

    const club = screen.getByRole("region", { name: "Club numbers" });
    expect(within(club).getAllByRole("link")).toHaveLength(1);
    expect(
      within(club).getByRole("link", { name: /Unread news/ }),
    ).toHaveAttribute("href", "/noticias");
  });

  it("no la pinta a un Player", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    expect(
      screen.queryByRole("region", { name: "To do" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Club numbers" }),
    ).not.toBeInTheDocument();
  });

  it("vuelve a pedir el inicio desde Reintentar de Pendientes", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      const todos = attempts === 1 ? { kind: "unavailable" } : [];
      return jsonResponse(200, { data: { ...ADMIN_DASHBOARD, todos } });
    });
    await renderScreen();

    await userEvent.click(
      within(screen.getByRole("region", { name: "To do" })).getByRole(
        "button",
        { name: "Try again" },
      ),
    );

    expect(await screen.findByText("✓ All caught up.")).toBeInTheDocument();
  });
});

describe("la tarjeta Próximo (#747)", () => {
  it("sin portada pinta el fondo del tipo y la píldora de los días que faltan", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    const view = await renderScreen();

    const card = nextUpCard();
    expect(within(card).getByText("Next up · In 2 days")).toBeInTheDocument();
    expect(
      view.container.querySelector(".event-cover-fallback-training"),
    ).not.toBeNull();
    expect(within(card).queryByRole("img")).not.toBeInTheDocument();
  });

  it("con portada la pinta como imagen decorativa", async () => {
    const coverUrl = "https://example.com/cover.jpg";
    stubDashboard(withNextUp({ ...NEXT_UP, coverUrl }));

    const view = await renderScreen();

    const cover = view.container.querySelector(".dashboard-next-up img");
    expect(cover).toHaveAttribute("src", coverUrl);
    expect(cover).toHaveAttribute("alt", "");
  });

  it.each([
    ["2026-09-30", "Next up · Today"],
    ["2026-10-01", "Next up · Tomorrow"],
  ])("un evento del %s dice %s", async (startsOn, pill) => {
    stubDashboard(withNextUp({ ...NEXT_UP, startsOn }));

    await renderScreen();

    expect(within(nextUpCard()).getByText(pill)).toBeInTheDocument();
  });

  it("dice la píldora en español", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen({ locale: "es" });

    const card = screen.getByRole("region", { name: "Próximo" });
    expect(within(card).getByText("Próximo · En 2 días")).toBeInTheDocument();
  });

  it("pinta el tipo, la audiencia, el título, cuándo con lo que dura y el lugar", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    const card = nextUpCard();
    expect(within(card).getByText("Training")).toBeInTheDocument();
    expect(within(card).getByText("The whole club")).toBeInTheDocument();
    expect(
      within(card).getByRole("heading", { level: 2, name: NEXT_UP.title }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Fri 2 Oct · 9:00 am – 11:00 am · 2 h"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Princes Park · Field 2"),
    ).toBeInTheDocument();
  });

  it("sin hora de fin dice sólo el día y el inicio", async () => {
    stubDashboard(withNextUp({ ...NEXT_UP, endTime: null }));

    await renderScreen();

    expect(
      within(nextUpCard()).getByText("Fri 2 Oct · 9:00 am"),
    ).toBeInTheDocument();
  });

  it("Cómo llegar abre el mapa del calendario en otra pestaña", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    const directions = within(nextUpCard()).getByRole("link", {
      name: /^Directions/,
    });
    expect(directions).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-37.7826,144.9611",
    );
    expect(directions).toHaveAttribute("target", "_blank");
  });

  it("con la dirección pero sin coordenadas también ofrece Cómo llegar", async () => {
    stubDashboard(
      withNextUp({
        ...NEXT_UP,
        place: {
          name: "Princes Park",
          address: "Princes Park Dr",
          lat: null,
          lng: null,
        },
      }),
    );

    await renderScreen();

    expect(
      within(nextUpCard()).getByRole("link", { name: /^Directions/ }),
    ).toBeInTheDocument();
  });

  it("con el lugar en texto libre no ofrece Cómo llegar", async () => {
    stubDashboard(withNextUp({ ...NEXT_UP, place: null }));

    await renderScreen();

    const card = nextUpCard();
    expect(within(card).getByText(NEXT_UP.location)).toBeInTheDocument();
    expect(
      within(card).queryByRole("link", { name: /^Directions/ }),
    ).not.toBeInTheDocument();
  });

  it("sin nada próximo lo dice y ofrece + Evento a quien puede crearlo", async () => {
    stubDashboard(withNextUp({ kind: "none" }, ADMIN_DASHBOARD));

    await renderScreen({ canCreateEvents: true });

    const card = nextUpCard();
    expect(within(card).getByText("Nothing coming up.")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "New event" }),
    ).toHaveAttribute("href", "/calendario?nuevo=training");
  });

  it("sin nada próximo no ofrece + Evento a quien no puede crearlo", async () => {
    stubDashboard(withNextUp({ kind: "none" }));

    await renderScreen();

    expect(
      within(nextUpCard()).queryByRole("link", { name: "New event" }),
    ).not.toBeInTheDocument();
  });

  it("si no se pudo leer lo dice con Reintentar y pinta el resto", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      return jsonResponse(200, {
        data:
          attempts === 1
            ? withNextUp({ kind: "unavailable" })
            : PLAYER_DASHBOARD,
      });
    });
    await renderScreen();

    const card = nextUpCard();
    expect(
      within(card).getByText("We couldn't load the next event."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Latest news" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(card).getByRole("button", { name: "Try again" }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: NEXT_UP.title }),
    ).toBeInTheDocument();
  });
});

describe("el RSVP de la tarjeta Próximo (#747)", () => {
  it("marca la respuesta guardada y cuenta los que van", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    expect(rsvpButton("Going")).toHaveAttribute("aria-pressed", "true");
    expect(rsvpButton("Maybe")).toHaveAttribute("aria-pressed", "false");
    expect(rsvpButton("Can't go")).toHaveAttribute("aria-pressed", "false");
    expect(
      within(nextUpCard()).getByText("14 going · 3 maybe"),
    ).toBeInTheDocument();
  });

  it("guarda como en el calendario y pone al día la marca y los conteos al confirmar", async () => {
    stubApi(({ method, url, body }) => {
      if (method === "PUT") {
        expect(url.pathname).toBe(rsvpPath(NEXT_UP.id));
        expect(body).toEqual({ response: "maybe" });
        return savedResponse(NEXT_UP.id, "maybe");
      }
      if (url.pathname === `/api/v1/events/${NEXT_UP.id}`) {
        return jsonResponse(500, {
          error: { code: "internal_error", message: "Falló." },
        });
      }
      return jsonResponse(200, { data: PLAYER_DASHBOARD });
    });
    await renderScreen();

    await userEvent.click(rsvpButton("Maybe"));

    await waitFor(() =>
      expect(rsvpButton("Maybe")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(rsvpButton("Going")).toHaveAttribute("aria-pressed", "false");
    expect(
      within(nextUpCard()).getByText("13 going · 4 maybe"),
    ).toBeInTheDocument();
  });

  it("si guardar falla lo dice bajo los botones y deja la respuesta de antes", async () => {
    stubApi(({ method }) => {
      if (method === "PUT") {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { data: PLAYER_DASHBOARD });
    });
    await renderScreen();

    await userEvent.click(rsvpButton("Can't go"));

    expect(await within(nextUpCard()).findByRole("alert")).toHaveTextContent(
      "We couldn't save your answer. Check your connection and try again.",
    );
    expect(rsvpButton("Going")).toHaveAttribute("aria-pressed", "true");
    expect(rsvpButton("Can't go")).toHaveAttribute("aria-pressed", "false");
    expect(
      within(nextUpCard()).getByText("14 going · 3 maybe"),
    ).toBeInTheDocument();
  });

  it("un segundo toque mientras guarda no manda otra respuesta", async () => {
    let releaseSave: () => void = () => undefined;
    stubApi(async ({ method, url }) => {
      if (method === "PUT") {
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        return savedResponse(NEXT_UP.id, "no");
      }
      if (url.pathname === `/api/v1/events/${NEXT_UP.id}`) {
        return jsonResponse(500, {
          error: { code: "internal_error", message: "Falló." },
        });
      }
      return jsonResponse(200, { data: PLAYER_DASHBOARD });
    });
    await renderScreen();

    await userEvent.click(rsvpButton("Can't go"));
    await userEvent.click(rsvpButton("Maybe"));
    releaseSave();

    await waitFor(() =>
      expect(rsvpButton("Can't go")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(requests.filter((request) => request.method === "PUT")).toEqual([
      { method: "PUT", path: rsvpPath(NEXT_UP.id) },
    ]);
  });
});

describe("el equipo en la tarjeta Próximo (#747)", () => {
  it("con el reparto publicado dice en qué equipo juega, su peto y su posición", async () => {
    stubDashboard(withNextUp({ ...NEXT_UP, myTeam: KELP_TEAM }));

    await renderScreen();

    const card = nextUpCard();
    expect(within(card).getByText("You're playing in")).toBeInTheDocument();
    const strip = within(card).getByText("Team Kelp").closest("p");
    expect(strip).toHaveTextContent("Team Kelp · blue bib · Full back");
    expect(within(card).getByRole("link", { name: "Lineups" })).toHaveAttribute(
      "href",
      `/calendario?evento=${NEXT_UP.id}`,
    );
  });

  it("sin posición no la dice", async () => {
    stubDashboard(
      withNextUp({ ...NEXT_UP, myTeam: { ...KELP_TEAM, position: null } }),
    );

    await renderScreen();

    const strip = within(nextUpCard()).getByText("Team Kelp").closest("p");
    expect(strip).toHaveTextContent(/^Team Kelp · blue bib$/);
  });

  it("dice el peto y la posición en español", async () => {
    stubDashboard(withNextUp({ ...NEXT_UP, myTeam: KELP_TEAM }));

    await renderScreen({ locale: "es" });

    const card = screen.getByRole("region", { name: "Próximo" });
    expect(within(card).getByText("Juegas en")).toBeInTheDocument();
    const strip = within(card).getByText("Team Kelp").closest("p");
    expect(strip).toHaveTextContent("Team Kelp · peto azul · Defensa");
  });

  it("sin equipo no hay franja", async () => {
    stubDashboard(PLAYER_DASHBOARD);

    await renderScreen();

    expect(
      within(nextUpCard()).queryByText("You're playing in"),
    ).not.toBeInTheDocument();
  });

  it("a Admin y Coach les avisa del reparto sin publicar y abre ese evento en Equipos", async () => {
    stubDashboard(
      withNextUp({ ...NEXT_UP, teamsStatus: "draft" }, ADMIN_DASHBOARD),
    );

    await renderScreen();

    const card = nextUpCard();
    expect(
      within(card)
        .getByText(/^Teams are saved but/)
        .closest("p"),
    ).toHaveTextContent("Teams are saved but not published yet.");
    expect(within(card).getByText("not published").tagName).toBe("STRONG");
    expect(
      within(card).getByRole("link", { name: "Open teams" }),
    ).toHaveAttribute("href", `/equipos?evento=${NEXT_UP.id}`);
  });

  it("con el reparto publicado o sin reparto no avisa", async () => {
    stubDashboard(
      withNextUp({ ...NEXT_UP, teamsStatus: "published" }, ADMIN_DASHBOARD),
    );

    await renderScreen();

    expect(
      within(nextUpCard()).queryByRole("link", { name: "Open teams" }),
    ).not.toBeInTheDocument();
  });
});

const WEEK_TRAINING = {
  id: POOL_TRAINING.id,
  title: "Saturday scrimmage",
  eventType: "training",
  startsOn: "2026-10-02",
  endsOn: null,
  startTime: "09:00",
  endTime: "11:00",
  location: "Princes Park · Field 2",
  myResponse: null,
} as const;

function weekSection(): HTMLElement {
  return screen.getByRole("region", { name: "This week" });
}

describe("Esta semana en el inicio (#748)", () => {
  it("marca el día del Próximo y pinta sus eventos con Responder", async () => {
    stubDashboard({
      ...PLAYER_DASHBOARD,
      week: { kind: "week", events: [WEEK_TRAINING] },
    });

    await renderScreen();

    const week = weekSection();
    expect(
      within(week).getByRole("button", { name: /October 2/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const row = within(week).getByRole("link", { name: /Saturday scrimmage/ });
    expect(row).toHaveTextContent("RSVP");
  });

  it("a un socio restringido le pinta la semana sin Responder", async () => {
    stubDashboard({
      ...RESTRICTED_DASHBOARD,
      week: { kind: "week", events: [WEEK_TRAINING] },
    });

    await renderScreen();

    const row = within(weekSection()).getByRole("link", {
      name: /Saturday scrimmage/,
    });
    expect(row).not.toHaveTextContent("RSVP");
  });

  it("si no se pudo leer lo dice y Reintentar vuelve a pedir el inicio", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      return jsonResponse(200, {
        data:
          attempts === 1
            ? { ...PLAYER_DASHBOARD, week: { kind: "unavailable" } }
            : PLAYER_DASHBOARD,
      });
    });
    await renderScreen();

    await userEvent.click(
      within(weekSection()).getByRole("button", { name: "Try again" }),
    );

    expect(
      await within(weekSection()).findByRole("group", { name: "Days" }),
    ).toBeInTheDocument();
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
    render(
      <DashboardScreen
        locale="en"
        userId={USER_ID}
        canCreateEvents={false}
        openableSections={ALL_SECTIONS}
      />,
    );

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
    render(
      <DashboardScreen
        locale="en"
        userId={USER_ID}
        canCreateEvents={false}
        openableSections={ALL_SECTIONS}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the dashboard. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

const RESTRICTED_DASHBOARD: RestrictedDashboard = {
  kind: "restricted",
  viewer: { firstName: "Alba" },
  me: { attendance: null },
  block: "pending",
  nextTraining: { kind: "training", training: POOL_TRAINING },
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: NEXT_UP,
  week: { kind: "week", events: [] },
  membership: { status: "restricted", block: "pending", endedOn: null },
  latestNews: { kind: "news", posts: [] },
};

function restrictedBy(
  block: RestrictedDashboard["block"],
  endedOn: string | null = null,
): RestrictedDashboard {
  return {
    ...RESTRICTED_DASHBOARD,
    block,
    membership: { status: "restricted", block, endedOn },
  };
}

describe("el inicio de quien no tiene la membresía al día (#453, #747)", () => {
  it.each([
    ["pending", "Your membership is pending: you haven't added a card yet."],
    ["past_due", "Your last payment didn't go through."],
  ] as const)(
    "con %s avisa con el texto de hoy y Renovar membresía a Pagos",
    async (block, title) => {
      stubDashboard(restrictedBy(block));

      await renderScreen();

      const notice = screen.getByRole("note", { name: title });
      expect(
        within(notice).getByRole("link", { name: "Renew membership" }),
      ).toHaveAttribute("href", "/pagos");
    },
  );

  it("vencida dice la fecha en que venció", async () => {
    stubDashboard(restrictedBy("cancelled", "2026-09-30"));

    await renderScreen();

    expect(
      screen.getByRole("note", {
        name: "Your membership expired on 30 September 2026",
      }),
    ).toBeInTheDocument();
  });

  it("vencida sin fecha no la dice", async () => {
    stubDashboard(restrictedBy("cancelled"));

    await renderScreen();

    expect(
      screen.getByRole("note", { name: "Your membership expired" }),
    ).toBeInTheDocument();
  });

  it("vencida lo dice en español", async () => {
    stubDashboard(restrictedBy("cancelled", "2026-09-30"));

    await renderScreen({ locale: "es" });

    const notice = screen.getByRole("note", {
      name: /^Tu membresía venció el /,
    });
    expect(
      within(notice).getByRole("link", { name: "Renovar membresía" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("en la tarjeta cambia los botones por la fila con candado y Renovar", async () => {
    stubDashboard(RESTRICTED_DASHBOARD);

    await renderScreen();

    const card = nextUpCard();
    expect(
      within(card).getByRole("heading", { level: 2, name: NEXT_UP.title }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("RSVP is for current members."),
    ).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Renew" })).toHaveAttribute(
      "href",
      "/pagos",
    );
    expect(within(card).queryByRole("group")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("no avisa del contacto, para no competir con el de la membresía", async () => {
    stubDashboard({
      ...RESTRICTED_DASHBOARD,
      contactReminder: { kind: "reminder", reminder: "emergency_contact" },
    });

    await renderScreen();

    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(
      screen.queryByRole("note", { name: "Add your emergency contact" }),
    ).not.toBeInTheDocument();
  });

  it("no pinta noticias", async () => {
    stubDashboard(RESTRICTED_DASHBOARD);

    await renderScreen();

    expect(screen.queryByText(/Latest news/i)).not.toBeInTheDocument();
  });
});

function withReminder(
  reminder: ContactReminder,
  dashboard: Dashboard = ADMIN_DASHBOARD,
): Dashboard {
  return { ...dashboard, contactReminder: { kind: "reminder", reminder } };
}

const EMERGENCY_NOTE = "Add your emergency contact";
const PHONE_NOTE = "Add your phone number";
const BOTH_NOTE = "Add your phone number and emergency contact";
const CONTACT_LINK = "Add contact";

describe("el aviso del contacto (#498)", () => {
  it("sin contacto de emergencia explica para qué es, enlaza a Contacto y no se puede cerrar", async () => {
    stubDashboard(withReminder("emergency_contact"));

    await renderScreen();

    const note = screen.getByRole("note", { name: EMERGENCY_NOTE });
    expect(
      within(note).getByText(
        "So the club knows who to call if something happens to you at the pool.",
      ),
    ).toBeInTheDocument();
    expect(
      within(note).getByRole("link", { name: CONTACT_LINK }),
    ).toHaveAttribute("href", "/cuenta#perfil-contacto");
    expect(within(note).queryByRole("button")).not.toBeInTheDocument();
  });

  it("sin teléfono avisa con un aviso que se puede cerrar", async () => {
    stubDashboard(withReminder("phone"));

    await renderScreen();

    const note = screen.getByRole("note", { name: PHONE_NOTE });
    expect(
      within(note).getByRole("link", { name: CONTACT_LINK }),
    ).toHaveAttribute("href", "/cuenta#perfil-contacto");
    expect(
      within(note).getByRole("button", { name: "Dismiss phone reminder" }),
    ).toBeInTheDocument();
  });

  it("cerrado, el aviso del teléfono no vuelve en ese navegador", async () => {
    stubDashboard(withReminder("phone"));
    const user = userEvent.setup();
    const view = await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Dismiss phone reminder" }),
    );

    expect(
      screen.queryByRole("note", { name: PHONE_NOTE }),
    ).not.toBeInTheDocument();
    view.unmount();
    await renderScreen();
    expect(
      screen.queryByRole("note", { name: PHONE_NOTE }),
    ).not.toBeInTheDocument();
  });

  it("cerrar el del teléfono no lo cierra para otra cuenta del mismo navegador", async () => {
    stubDashboard(withReminder("phone"));
    const user = userEvent.setup();
    const view = await renderScreen();
    await user.click(
      screen.getByRole("button", { name: "Dismiss phone reminder" }),
    );
    view.unmount();

    render(
      <DashboardScreen
        locale="en"
        userId="00000000-0000-4000-8000-0000000000aa"
        canCreateEvents={false}
        openableSections={ALL_SECTIONS}
      />,
    );

    expect(
      await screen.findByRole("note", { name: PHONE_NOTE }),
    ).toBeInTheDocument();
  });

  it("sin almacenamiento en el navegador el del teléfono sale y se cierra igual", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    stubDashboard(withReminder("phone"));
    const user = userEvent.setup();
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Dismiss phone reminder" }),
    );

    expect(
      screen.queryByRole("note", { name: PHONE_NOTE }),
    ).not.toBeInTheDocument();
  });

  it("cuando faltan los dos pinta un solo aviso que pide los dos", async () => {
    stubDashboard(withReminder("both"));

    await renderScreen();

    expect(screen.getAllByRole("note")).toHaveLength(1);
    const note = screen.getByRole("note", { name: BOTH_NOTE });
    expect(within(note).queryByRole("button")).not.toBeInTheDocument();
  });

  it("con los dos datos no pinta ningún aviso", async () => {
    stubDashboard(withReminder("none"));

    await renderScreen();

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("si no se pudo leer el contacto no pinta ningún aviso", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      contactReminder: { kind: "unavailable" },
    });

    await renderScreen();

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("no bloquea el RSVP ni el resto del inicio", async () => {
    stubDashboard(withReminder("both", PLAYER_DASHBOARD));

    await renderScreen();

    expect(rsvpButton("Going")).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Latest news" }),
    ).toBeInTheDocument();
  });

  it("al volver al inicio con el contacto ya guardado el aviso no está", async () => {
    stubDashboard(withReminder("emergency_contact"));
    const view = await renderScreen();
    expect(
      screen.getByRole("note", { name: EMERGENCY_NOTE }),
    ).toBeInTheDocument();
    view.unmount();

    stubDashboard(withReminder("none"));
    await renderScreen();

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("cambia con el idioma sin volver a pedir", async () => {
    stubDashboard(withReminder("emergency_contact"));
    const view = await renderScreen();
    const requestsBefore = requests.length;

    view.rerender(
      <DashboardScreen
        locale="es"
        userId={USER_ID}
        canCreateEvents={false}
        openableSections={ALL_SECTIONS}
      />,
    );

    const note = screen.getByRole("note", {
      name: "Añade tu contacto de emergencia",
    });
    expect(
      within(note).getByText(
        "Para que el club sepa a quién llamar si te pasa algo en la piscina.",
      ),
    ).toBeInTheDocument();
    expect(
      within(note).getByRole("link", {
        name: "Añadir contacto",
      }),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(requestsBefore);
  });
});

describe("la columna del Player (#749)", () => {
  const SEASON_ATTENDANCE = {
    percent: 82,
    attended: 18,
    sessions: 22,
    last10: [
      { eventId: POOL_TRAINING.id, startsOn: "2026-09-26", status: "late" },
    ],
  } as const;

  it("a un Player le pinta Mi asistencia y la membresía", async () => {
    stubDashboard({
      ...PLAYER_DASHBOARD,
      me: { attendance: SEASON_ATTENDANCE },
    });

    await renderScreen();

    const attendance = screen.getByRole("region", { name: "My attendance" });
    expect(within(attendance).getByText("82%")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Membership" })).getByText(
        "Membership active",
      ),
    ).toBeInTheDocument();
  });

  it("a Admin, Coach o Committee no se la pinta", async () => {
    stubDashboard({
      ...ADMIN_DASHBOARD,
      me: { attendance: SEASON_ATTENDANCE },
    });

    await renderScreen();

    expect(
      screen.queryByRole("region", { name: "My attendance" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Membership" }),
    ).not.toBeInTheDocument();
  });

  it("a quien no tiene la membresía al día le dice su estado", async () => {
    stubDashboard(restrictedBy("cancelled", "2026-09-30"));

    await renderScreen();

    const membership = screen.getByRole("region", { name: "Membership" });
    expect(
      within(membership).getByText("Membership expired"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "My attendance" })).getByText(
        "No sessions yet this season.",
      ),
    ).toBeInTheDocument();
  });

  it("si no se pudo leer la asistencia, Reintentar vuelve a pedir el inicio", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      return jsonResponse(200, {
        data: {
          ...PLAYER_DASHBOARD,
          me: {
            attendance:
              attempts === 1 ? { kind: "unavailable" } : SEASON_ATTENDANCE,
          },
        },
      });
    });
    await renderScreen();

    await userEvent.click(
      within(screen.getByRole("region", { name: "My attendance" })).getByRole(
        "button",
        { name: "Try again" },
      ),
    );

    expect(await screen.findByText("82%")).toBeInTheDocument();
  });
});
