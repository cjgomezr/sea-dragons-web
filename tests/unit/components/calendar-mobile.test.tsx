import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type {
  AgendaEvent,
  OrganizerEventDetail,
} from "@/lib/events/event-agenda";

/**
 * El Calendario en el móvil (#656, RF-12 y RF-13 del PRD de E24): por debajo
 * de 768 px la agenda son tarjetas, un evento se abre en su propia pantalla y
 * sus acciones van en una hoja ⋯. El ancho lo dice `matchMedia`, que aquí se
 * simula; cómo se ve a 375 px lo prueba Playwright.
 */

const AGENDA_PATH = "/api/v1/events";
const MANAGE_PATH = "/api/v1/events/manage";
const PHONE_QUERY = "(width < 768px)";
const SERIES_ID = "cccccccc-0000-4000-8000-00000000000c";

const OPEN_TRAINING: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-10-06",
  startTime: "18:00",
  endTime: "19:30",
  endsOn: null,
  title: "Tuesday open training",
  eventType: "training",
  location: "Princes Park, Oval 2",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: SERIES_ID,
  goingCount: 3,
  maybeCount: 1,
  myResponse: "yes",
  inAudience: true,
  coverThumbUrl: null,
};

const TRIVIA_NIGHT: AgendaEvent = {
  ...OPEN_TRAINING,
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-10-10",
  startTime: "19:00",
  endTime: "22:00",
  title: "Fundraiser trivia night",
  eventType: "social",
  location: "Seadragons Clubhouse",
  seriesId: null,
  myResponse: null,
};

const CANCELLED_MEETING: AgendaEvent = {
  ...TRIVIA_NIGHT,
  id: "dddddddd-0000-4000-8000-00000000000d",
  title: "Committee meeting",
  eventType: "meeting",
  status: "cancelled",
};

function detailOf(event: AgendaEvent): OrganizerEventDetail {
  return {
    ...event,
    coverUrl: null,
    series:
      event.seriesId === null
        ? null
        : { weekdays: [2], endsOn: "2026-12-15", sessionsLeft: 10 },
    notes: "Bring fins and a snorkel.",
    going: ["Lucía Fernández", "Tom Baker", "Mia Rossi"],
    maybe: ["Noah Park"],
    audience: { kind: "club" },
  };
}

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
};

const calls: Call[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cancelledEvent(event: AgendaEvent): Response {
  return jsonResponse(200, {
    data: {
      id: event.id,
      seriesId: event.seriesId,
      startsOn: event.startsOn,
      title: event.title,
      eventType: event.eventType,
      startTime: event.startTime,
      location: event.location,
      notes: null,
      audience: { kind: "club" },
      status: "cancelled",
    },
  });
}

/** La agenda, el detalle de cada evento, los equipos (nunca publicados), el
 * RSVP (que guarda siempre Quizás) y las acciones de quien organiza. */
function stubApi(events: readonly AgendaEvent[]): void {
  const answeredMaybe = new Set<string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      calls.push({ method, pathname: url.pathname, search: url.search });
      if (url.pathname === AGENDA_PATH) {
        return jsonResponse(200, { data: { events, nextCursor: null } });
      }
      if (url.pathname.endsWith("/team")) {
        return jsonResponse(200, { data: { status: "not_published" } });
      }
      if (url.pathname.startsWith(MANAGE_PATH)) {
        const target = events.find((event) => url.pathname.includes(event.id));
        if (target === undefined) {
          throw new Error(`Petición inesperada: ${method} ${url.pathname}`);
        }
        return cancelledEvent(target);
      }
      if (url.pathname.endsWith("/rsvp") && method === "PUT") {
        const eventId = url.pathname.split("/").at(-2);
        answeredMaybe.add(eventId ?? "");
        return jsonResponse(200, {
          data: {
            eventId,
            response: "maybe",
            respondedAt: "2026-10-01T08:00:00.000Z",
          },
        });
      }
      const opened = events.find(
        (event) => url.pathname === `${AGENDA_PATH}/${event.id}`,
      );
      if (opened !== undefined && method === "GET") {
        const detail = detailOf(opened);
        return jsonResponse(200, {
          data: answeredMaybe.has(opened.id)
            ? { ...detail, myResponse: "maybe" }
            : detail,
        });
      }
      throw new Error(`Petición inesperada: ${method} ${url.pathname}`);
    }),
  );
}

function stubScreen(isPhone: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderAgenda(
  options: {
    readonly canManage?: boolean;
    readonly canTakeAttendance?: boolean;
    readonly locale?: "en" | "es";
  } = {},
): void {
  const { canManage = false, canTakeAttendance = false } = options;
  render(
    <AgendaScreen
      locale={options.locale ?? "en"}
      canManageEvents={canManage}
      canTakeAttendance={canTakeAttendance}
      canRespond
    />,
  );
}

async function findCard(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 3, name: title });
  const card = heading.closest("li");
  if (card === null) {
    throw new Error(`La tarjeta de ${title} no es un elemento de la lista.`);
  }
  return card;
}

/** Toca la tarjeta y devuelve la pantalla del evento con su detalle ya
 * llegado: los que van sólo se pintan con el detalle. */
async function openEventScreen(title: string): Promise<HTMLElement> {
  const card = await findCard(title);
  await userEvent.click(within(card).getByRole("button", { name: title }));
  const eventScreen = await screen.findByRole("article", { name: title });
  await within(eventScreen).findByRole("heading", {
    name: /^(Going|Van) · \d+$/,
  });
  return eventScreen;
}

function detailCalls(event: AgendaEvent): Call[] {
  return calls.filter(
    (call) =>
      call.method === "GET" && call.pathname === `${AGENDA_PATH}/${event.id}`,
  );
}

beforeEach(() => {
  stubScreen(true);
});

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la agenda en el móvil", () => {
  it("se titula Calendario y no pinta el panel de al lado", async () => {
    stubApi([OPEN_TRAINING]);

    renderAgenda();

    await findCard(OPEN_TRAINING.title);
    expect(
      screen.getByRole("heading", { level: 1, name: "Calendar" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("no pide el detalle de ningún evento hasta que se toca su tarjeta", async () => {
    stubApi([OPEN_TRAINING, TRIVIA_NIGHT]);

    renderAgenda();

    await findCard(OPEN_TRAINING.title);
    expect(detailCalls(OPEN_TRAINING)).toHaveLength(0);
  });

  it("ofrece el botón + de crear a quien puede crear", async () => {
    stubApi([OPEN_TRAINING]);

    renderAgenda({ canManage: true });

    await findCard(OPEN_TRAINING.title);
    expect(
      screen.getByRole("button", { name: "New event" }),
    ).toBeInTheDocument();
  });

  it("no ofrece el botón + a quien no puede crear", async () => {
    stubApi([OPEN_TRAINING]);

    renderAgenda();

    await findCard(OPEN_TRAINING.title);
    expect(
      screen.queryByRole("button", { name: "New event" }),
    ).not.toBeInTheDocument();
  });

  it("pinta en la tarjeta la hora corta, la repetición, mi respuesta y el lugar", async () => {
    stubApi([OPEN_TRAINING]);

    renderAgenda();

    const card = await findCard(OPEN_TRAINING.title);
    expect(within(card).getByText("6:00–7:30 pm")).toBeInTheDocument();
    expect(within(card).getByText("Repeats")).toBeInTheDocument();
    expect(within(card).getByText("Going")).toBeInTheDocument();
    expect(within(card).getByText(OPEN_TRAINING.location)).toBeInTheDocument();
  });

  it("marca el cancelado con la palabra en la tarjeta", async () => {
    stubApi([CANCELLED_MEETING]);

    renderAgenda();

    const card = await findCard(CANCELLED_MEETING.title);
    expect(within(card).getByText("Cancelled")).toBeInTheDocument();
  });

  it("escribe la cabecera y la tarjeta en español", async () => {
    stubApi([OPEN_TRAINING]);

    renderAgenda({ canManage: true, locale: "es" });

    const card = await findCard(OPEN_TRAINING.title);
    expect(
      screen.getByRole("heading", { level: 1, name: "Calendario" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nuevo evento" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("18:00–19:30")).toBeInTheDocument();
    expect(within(card).getByText("Voy")).toBeInTheDocument();
  });
});

describe("la pantalla del evento", () => {
  it("se abre al tocar la tarjeta y esconde la agenda", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    await openEventScreen(OPEN_TRAINING.title);

    expect(
      screen.queryByRole("list", { name: "Upcoming events" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("lleva arriba volver y la etiqueta del tipo, y lleva el foco al título", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    expect(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    ).toBeInTheDocument();
    expect(within(eventScreen).getByText("Training")).toBeInTheDocument();
    expect(
      within(eventScreen).getByRole("heading", {
        level: 1,
        name: OPEN_TRAINING.title,
      }),
    ).toHaveFocus();
  });

  it("pinta en orden la audiencia, la hora, la repetición, el lugar, ¿Vas?, los que van y las notas", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    const text = eventScreen.textContent ?? "";
    const inOrder = [
      OPEN_TRAINING.title,
      "The whole club",
      "Tuesday, October 6",
      "Every Tuesday",
      OPEN_TRAINING.location,
      "Are you going?",
      "Going · 3",
      "Bring fins and a snorkel.",
    ].map((piece) => text.indexOf(piece));
    expect(inOrder.every((position) => position >= 0)).toBe(true);
    expect([...inOrder].sort((a, b) => a - b)).toEqual(inOrder);
    expect(
      within(eventScreen).getByRole("button", { name: "Add to my calendar" }),
    ).toBeInTheDocument();
    expect(
      within(eventScreen).getByRole("link", { name: /Directions/ }),
    ).toBeInTheDocument();
  });

  it("la fila de los que van abre la lista de nombres", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();
    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: /See all/ }),
    );

    expect(
      within(eventScreen).getByRole("list", { name: "Maybe" }),
    ).toHaveTextContent("Noah Park");
  });

  it("responde desde ¿Vas? y la tarjeta enseña la respuesta al volver", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();
    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Maybe" }),
    );
    await waitFor(() =>
      expect(
        within(eventScreen).getByRole("button", { name: "Maybe" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    );

    const card = await findCard(OPEN_TRAINING.title);
    expect(within(card).getByText("Maybe")).toBeInTheDocument();
  });

  it("ofrece Pasar lista a quien pasa lista en un entrenamiento empezado", async () => {
    const started = { ...OPEN_TRAINING, startsOn: "2026-01-06" };
    stubApi([started]);
    renderAgenda({ canTakeAttendance: true });

    const eventScreen = await openEventScreen(started.title);

    expect(
      within(eventScreen).getByRole("link", { name: "Take attendance" }),
    ).toBeInTheDocument();
  });

  it("dice que el evento está cancelado", async () => {
    stubApi([CANCELLED_MEETING]);
    renderAgenda();

    const eventScreen = await openEventScreen(CANCELLED_MEETING.title);

    expect(within(eventScreen).getByText("Cancelled")).toBeInTheDocument();
    expect(
      within(eventScreen).queryByRole("group", { name: /Are you going/ }),
    ).not.toBeInTheDocument();
  });

  it("escribe la pantalla en español", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda({ locale: "es" });

    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    expect(
      within(eventScreen).getByRole("button", { name: "Volver al calendario" }),
    ).toBeInTheDocument();
    expect(within(eventScreen).getByText("Entrenamiento")).toBeInTheDocument();
  });
});

describe("volver a la agenda", () => {
  it("devuelve la agenda con el foco en la tarjeta del evento", async () => {
    stubApi([OPEN_TRAINING, TRIVIA_NIGHT]);
    renderAgenda();
    const eventScreen = await openEventScreen(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    );

    const card = await findCard(TRIVIA_NIGHT.title);
    expect(
      within(card).getByRole("button", { name: TRIVIA_NIGHT.title }),
    ).toHaveFocus();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("conserva el periodo y el filtro, sin pedir la agenda otra vez", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();
    await findCard(OPEN_TRAINING.title);
    await userEvent.click(screen.getByRole("button", { name: "Social" }));
    await userEvent.click(screen.getByRole("button", { name: "Past" }));
    const agendaRequests = calls.filter(
      (call) => call.pathname === AGENDA_PATH,
    ).length;
    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    );

    await findCard(OPEN_TRAINING.title);
    expect(screen.getByRole("button", { name: "Past" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Social" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(calls.filter((call) => call.pathname === AGENDA_PATH)).toHaveLength(
      agendaRequests,
    );
  });

  it("devuelve el scroll que tenía la agenda", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(640);
    stubApi([OPEN_TRAINING]);
    renderAgenda();
    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Back to calendar" }),
    );

    await findCard(OPEN_TRAINING.title);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640);
  });

  it("abrir el evento deja una entrada en el historial, y volver del navegador lo cierra", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    stubApi([OPEN_TRAINING]);
    renderAgenda();
    await openEventScreen(OPEN_TRAINING.title);
    expect(pushState).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    const card = await findCard(OPEN_TRAINING.title);
    expect(
      within(card).getByRole("button", { name: OPEN_TRAINING.title }),
    ).toHaveFocus();
  });
});

describe("la hoja ⋯", () => {
  async function openSheet(title: string): Promise<HTMLElement> {
    const eventScreen = await openEventScreen(title);
    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Event actions" }),
    );
    return screen.findByRole("dialog", { name: "Event actions" });
  }

  it("en una sesión de una serie ofrece editar sólo esta, esta y las siguientes, cancelar y cerrar", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda({ canManage: true });

    const sheet = await openSheet(OPEN_TRAINING.title);

    expect(within(sheet).getByText("This event repeats")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Edit this session only" }),
    ).toHaveAccessibleDescription("Tuesday, October 6");
    expect(
      within(sheet).getByRole("button", { name: "Edit this and following" }),
    ).toHaveAccessibleDescription("Every session from this one on");
    expect(
      within(sheet).getByRole("button", { name: "Cancel event" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
  });

  it("en un evento suelto ofrece Editar evento, Cancelar evento y Cerrar", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ canManage: true });

    const sheet = await openSheet(TRIVIA_NIGHT.title);

    expect(
      within(sheet).queryByText("This event repeats"),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Edit event" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Cancel event" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
  });

  it("no hay ⋯ para quien no puede editar", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda();

    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    expect(
      within(eventScreen).queryByRole("button", { name: "Event actions" }),
    ).not.toBeInTheDocument();
  });

  it("no hay ⋯ en un evento cancelado", async () => {
    stubApi([CANCELLED_MEETING]);
    renderAgenda({ canManage: true });

    const eventScreen = await openEventScreen(CANCELLED_MEETING.title);

    expect(
      within(eventScreen).queryByRole("button", { name: "Event actions" }),
    ).not.toBeInTheDocument();
  });

  it("con Escape se cierra y el foco vuelve a ⋯", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ canManage: true });
    await openSheet(TRIVIA_NIGHT.title);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Event actions" })).toHaveFocus();
  });

  it("con Cerrar se cierra y el foco vuelve a ⋯", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ canManage: true });
    const sheet = await openSheet(TRIVIA_NIGHT.title);

    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Event actions" })).toHaveFocus();
  });

  it("con Editar sólo esta sesión abre el diálogo del evento", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda({ canManage: true });
    const sheet = await openSheet(OPEN_TRAINING.title);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Edit this session only" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Edit event" }),
    ).toBeInTheDocument();
  });

  it("con Editar esta y las siguientes abre el diálogo de la serie", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda({ canManage: true });
    const sheet = await openSheet(OPEN_TRAINING.title);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Edit this and following" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Edit series" }),
    ).toBeInTheDocument();
  });

  it("al cancelar un evento suelto lo confirma en la hoja y vuelve a la agenda con el aviso", async () => {
    stubApi([TRIVIA_NIGHT]);
    renderAgenda({ canManage: true });
    const sheet = await openSheet(TRIVIA_NIGHT.title);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Cancel event" }),
    );
    expect(
      within(sheet).getByText(/3 people said they're going/),
    ).toBeInTheDocument();
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Cancel event" }),
    );

    expect(
      await screen.findByText("Event cancelled. We let the audience know."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(
      calls.filter((call) => call.pathname.startsWith(MANAGE_PATH)),
    ).toHaveLength(1);
  });

  it("al cancelar una sesión de una serie pregunta antes si es sólo esta", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda({ canManage: true });
    const sheet = await openSheet(OPEN_TRAINING.title);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Cancel event" }),
    );

    expect(
      within(sheet).getByRole("button", { name: "Only this one" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", {
        name: "The whole series from today on",
      }),
    ).toBeInTheDocument();
  });

  it("escribe la hoja de una serie en español", async () => {
    stubApi([OPEN_TRAINING]);
    renderAgenda({ canManage: true, locale: "es" });
    const eventScreen = await openEventScreen(OPEN_TRAINING.title);

    await userEvent.click(
      within(eventScreen).getByRole("button", { name: "Acciones del evento" }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "Acciones del evento",
    });

    expect(
      within(sheet).getByText("Este evento se repite"),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Editar solo esta sesión" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", {
        name: "Editar esta y las siguientes",
      }),
    ).toHaveAccessibleDescription("Todas las sesiones desde esta");
    expect(
      within(sheet).getByRole("button", { name: "Cancelar evento" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Cerrar" }),
    ).toBeInTheDocument();
  });
});

describe("desde 768 px", () => {
  it("elegir un evento lo abre en el panel, sin pantalla propia", async () => {
    stubScreen(false);
    stubApi([OPEN_TRAINING, TRIVIA_NIGHT]);
    renderAgenda({ canManage: true });

    const card = await findCard(TRIVIA_NIGHT.title);
    await userEvent.click(
      within(card).getByRole("button", { name: TRIVIA_NIGHT.title }),
    );

    expect(
      await screen.findByRole("complementary", { name: TRIVIA_NIGHT.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back to calendar" }),
    ).not.toBeInTheDocument();
  });
});
