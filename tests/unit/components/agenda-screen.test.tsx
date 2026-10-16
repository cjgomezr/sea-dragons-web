import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type {
  AgendaEvent,
  AgendaPage,
  MemberEventDetail,
  OrganizerEventDetail,
} from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";

/**
 * La agenda del Calendario (#311, RF-5 a RF-7 del PRD de E7). Qué eventos ve
 * cada uno y cómo se cuentan lo decide el servidor (#308, #309): lo que se
 * prueba aquí es que la pantalla pinta lo que responde la API, responde en
 * un toque desde la fila y no da por guardado lo que no se guardó.
 */

const AGENDA_PATH = "/api/v1/events";
const RSVP_CHOICE = /^(Going|Maybe|Can't go)$/;

const POOL_TRAINING: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-06-23",
  startTime: "19:00",
  endTime: null,
  endsOn: null,
  title: "Pool Training",
  eventType: "training",
  location: "MSAC Dive Pool",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: null,
  goingCount: 14,
  maybeCount: 2,
  myResponse: "yes",
  inAudience: true,
  coverThumbUrl: null,
};

const SCRIMMAGE: AgendaEvent = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-06-27",
  startTime: "10:00",
  endTime: null,
  endsOn: null,
  title: "Scrimmage vs Geelong Krakens",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: null,
  goingCount: 18,
  maybeCount: 1,
  myResponse: null,
  inAudience: true,
  coverThumbUrl: null,
};

const CANCELLED_SOCIAL: AgendaEvent = {
  ...SCRIMMAGE,
  id: "cccccccc-0000-4000-8000-00000000000c",
  startsOn: "2026-07-03",
  title: "End-of-Season Social",
  eventType: "social",
  status: "cancelled",
};

const COMMITTEE_ONLY: AgendaEvent = {
  ...SCRIMMAGE,
  id: "dddddddd-0000-4000-8000-00000000000d",
  title: "Coaches Meeting",
  eventType: "meeting",
  inAudience: false,
  coverThumbUrl: null,
};

type Respond = (request: {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}) => Response | Promise<Response>;

type RecordedRequest = { readonly method: string; readonly path: string };

const requests: RecordedRequest[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pageResponse(page: AgendaPage): Response {
  return jsonResponse(200, { data: page });
}

function detailResponse(
  event: AgendaEvent,
  changes: Partial<AgendaEvent>,
): Response {
  const detail: MemberEventDetail = {
    ...event,
    ...changes,
    coverUrl: null,
    series: null,
    notes: null,
    going: [],
    maybe: [],
  };
  return jsonResponse(200, { data: detail });
}

function savedResponse(eventId: string, response: RsvpResponse): Response {
  return jsonResponse(200, {
    data: { eventId, response, respondedAt: "2026-06-20T08:00:00.000Z" },
  });
}

function startedResponse(): Response {
  return jsonResponse(422, {
    error: {
      code: "business_rule",
      message: "El evento ya empezó: ya no se puede responder.",
      reason: "rsvp_event_started",
    },
  });
}

function stubApi(respond: Respond): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      requests.push({ method, path: `${url.pathname}${url.search}` });
      // Los equipos del panel (#403) tienen su propio test: aquí
      // nunca hay reparto publicado.
      if (url.pathname.endsWith("/team")) {
        return jsonResponse(200, { data: { status: "not_published" } });
      }
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return respond({ method, url, body });
    }),
  );
}

/** La agenda de una sola página y el detalle de sus eventos al desplegarlos,
 * y nada más: responder no está servido. */
function stubAgenda(events: readonly AgendaEvent[]): void {
  stubApi(({ url }) => {
    const isServed =
      url.pathname === AGENDA_PATH ||
      events.some((event) => url.pathname === eventPath(event));
    if (!isServed) {
      throw new Error(`Petición inesperada: ${url.pathname}`);
    }
    return agendaOrDetail(url, events);
  });
}

/** La agenda de una página o, al desplegar una fila, el detalle del evento
 * tal como lo trae la agenda. */
function agendaOrDetail(url: URL, events: readonly AgendaEvent[]): Response {
  const opened = events.find((event) => url.pathname === eventPath(event));
  return opened === undefined
    ? pageResponse({ events, nextCursor: null })
    : detailResponse(opened, {});
}

/** Las páginas de la agenda, sin el detalle ni los equipos que pide el
 * evento elegido (#648). */
function agendaPageRequests(): RecordedRequest[] {
  return requests.filter(
    (request) => request.path.split("?")[0] === AGENDA_PATH,
  );
}

function rsvpPath(event: AgendaEvent): string {
  return `${AGENDA_PATH}/${event.id}/rsvp`;
}

function rsvpRequests(event: AgendaEvent): RecordedRequest[] {
  return requests.filter(
    (request) => request.method === "PUT" && request.path === rsvpPath(event),
  );
}

async function findRow(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", {
    level: 3,
    name: title,
  });
  const row = heading.closest("li");
  if (row === null) {
    throw new Error(`La fila de ${title} no es un elemento de la lista.`);
  }
  return row;
}

function rsvpButton(row: HTMLElement, name: string): HTMLElement {
  return within(row).getByRole("button", { name });
}

afterEach(() => {
  requests.length = 0;
  vi.unstubAllGlobals();
});

describe("agenda", () => {
  it("pinta cada evento bajo su día, con título, tipo, hora, lugar y quienes van", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(POOL_TRAINING.title);
    expect(screen.getByText("TUE · JUN 23")).toBeInTheDocument();
    expect(within(row).getByText("Training")).toBeInTheDocument();
    expect(within(row).getByText("7:00 pm")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: /MSAC Dive Pool/ }),
    ).toBeInTheDocument();
    expect(within(row).getByText("14 going")).toBeInTheDocument();
  });

  it("titula la sección Próximos eventos y deja los eventos en el orden del servidor", async () => {
    stubAgenda([POOL_TRAINING, SCRIMMAGE]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const list = await screen.findByRole("list", { name: "Upcoming events" });
    const titles = within(list)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([POOL_TRAINING.title, SCRIMMAGE.title]);
  });

  it("pide la agenda de los próximos a la API v1", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(agendaPageRequests()).toEqual([
      { method: "GET", path: AGENDA_PATH },
    ]);
  });

  it("marca el evento cancelado y no le pone botones de RSVP", async () => {
    stubAgenda([CANCELLED_SOCIAL]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(CANCELLED_SOCIAL.title);
    expect(within(panel).getByText("Cancelled")).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: RSVP_CHOICE }),
    ).toBeNull();
  });

  it("no le pone botones de RSVP a un evento fuera de la audiencia de quien organiza", async () => {
    stubAgenda([COMMITTEE_ONLY]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(COMMITTEE_ONLY.title);
    expect(
      within(panel).queryByRole("button", { name: RSVP_CHOICE }),
    ).toBeNull();
    expectCounts(panel, { going: "Going · 18", maybe: "1 maybe" });
  });

  it("dice con una frase que no hay eventos", async () => {
    stubAgenda([]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    expect(
      await screen.findByText("There are no upcoming events."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("trae los siguientes con Ver más usando el cursor de la página anterior", async () => {
    stubApi(({ url }) =>
      url.searchParams.get("cursor") === "pagina-2"
        ? pageResponse({ events: [SCRIMMAGE], nextCursor: null })
        : pageResponse({ events: [POOL_TRAINING], nextCursor: "pagina-2" }),
    );
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(screen.getByRole("button", { name: "See more" }));

    await findRow(SCRIMMAGE.title);
    expect(await findRow(POOL_TRAINING.title)).toBeInTheDocument();
    expect(agendaPageRequests().at(-1)).toEqual({
      method: "GET",
      path: `${AGENDA_PATH}?cursor=pagina-2`,
    });
    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
  });

  it("tras Ver más lleva el foco al primer evento nuevo, y al abrir no lo mueve", async () => {
    stubApi(({ url }) =>
      url.searchParams.get("cursor") === "pagina-2"
        ? pageResponse({ events: [SCRIMMAGE], nextCursor: null })
        : pageResponse({ events: [POOL_TRAINING], nextCursor: "pagina-2" }),
    );
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);
    expect(
      screen.getByRole("heading", { level: 3, name: POOL_TRAINING.title }),
    ).not.toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "See more" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 3, name: SCRIMMAGE.title }),
      ).toHaveFocus(),
    );
  });

  it("no ofrece Ver más en la última página", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
  });

  it("si la agenda no carga lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return pageResponse({ events: [POOL_TRAINING], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await findRow(POOL_TRAINING.title)).toBeInTheDocument();
  });

  it("escribe textos, fechas y horas en español", async () => {
    stubAgenda([POOL_TRAINING, CANCELLED_SOCIAL]);

    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);
    const row = await findRow(POOL_TRAINING.title);
    expect(
      screen.getByRole("heading", { level: 1, name: "Próximos eventos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("MAR · 23 JUN")).toBeInTheDocument();
    expect(within(row).getByText("Entrenamiento")).toBeInTheDocument();
    expect(within(row).getByText("19:00")).toBeInTheDocument();
    expect(within(row).getByText("14 van")).toBeInTheDocument();
    expectCounts(panel, { going: "Van · 14", maybe: "2 quizás" });
    expect(rsvpButton(panel, "Voy")).toBeInTheDocument();
    expect(rsvpButton(panel, "Quizás")).toBeInTheDocument();
    const cancelled = await findRow(CANCELLED_SOCIAL.title);
    expect(within(cancelled).getByText("Cancelado")).toBeInTheDocument();
  });

  it("escribe en singular una sola persona que va en español", async () => {
    stubAgenda([{ ...SCRIMMAGE, goingCount: 1, maybeCount: 0 }]);

    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(SCRIMMAGE.title);
    expect(within(row).getByText("1 va")).toBeInTheDocument();
  });

  it("dice que no hay eventos en español", async () => {
    stubAgenda([]);

    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    expect(
      await screen.findByText("No hay eventos próximos."),
    ).toBeInTheDocument();
  });
});

describe("RSVP en el panel", () => {
  it("anuncia qué respuesta está elegida", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);
    const group = within(panel).getByRole("group", {
      name: `RSVP: ${POOL_TRAINING.title}`,
    });
    expect(
      within(group).getByRole("button", { name: "Going" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(group).getByRole("button", { name: "Maybe" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(group).getByRole("button", { name: "Can't go" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("guarda la respuesta con un toque, la marca y pone los conteos que devuelve la API", async () => {
    stubApi(({ method, url, body }) => {
      if (method === "PUT") {
        expect(url.pathname).toBe(rsvpPath(SCRIMMAGE));
        expect(body).toEqual({ response: "maybe" });
        return savedResponse(SCRIMMAGE.id, "maybe");
      }
      if (url.pathname === `${AGENDA_PATH}/${SCRIMMAGE.id}`) {
        return detailResponse(SCRIMMAGE, {
          myResponse: "maybe",
          goingCount: 20,
          maybeCount: 4,
        });
      }
      return pageResponse({ events: [SCRIMMAGE], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(panel, "Maybe"));

    await waitFor(() =>
      expect(rsvpButton(panel, "Maybe")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expectCounts(panel, { going: "Going · 20", maybe: "4 maybe" });
    expect(rsvpButton(panel, "Going")).toHaveAttribute("aria-pressed", "false");
  });

  it("si la respuesta se guardó pero los conteos no llegan, los recuenta con la respuesta anterior", async () => {
    stubApi(({ method, url }) => {
      if (method === "PUT") {
        return savedResponse(POOL_TRAINING.id, "maybe");
      }
      // Al desplegar, el detalle llega; tras guardar, ya no.
      if (url.pathname === `${AGENDA_PATH}/${POOL_TRAINING.id}`) {
        if (rsvpRequests(POOL_TRAINING).length > 0) {
          throw new TypeError("Failed to fetch");
        }
        return detailResponse(POOL_TRAINING, {});
      }
      return pageResponse({ events: [POOL_TRAINING], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(panel, "Maybe"));

    await waitFor(() =>
      expect(rsvpButton(panel, "Maybe")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expectCounts(panel, { going: "Going · 13", maybe: "3 maybe" });
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("no manda una segunda petición si se toca otra vez mientras guarda", async () => {
    let finishSaving: (response: Response) => void = () => undefined;
    stubApi(({ method, url }) => {
      if (method === "PUT") {
        return new Promise<Response>((resolve) => {
          finishSaving = resolve;
        });
      }
      if (url.pathname === `${AGENDA_PATH}/${SCRIMMAGE.id}`) {
        return detailResponse(SCRIMMAGE, { myResponse: "yes", goingCount: 19 });
      }
      return pageResponse({ events: [SCRIMMAGE], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(panel, "Going"));
    await userEvent.click(rsvpButton(panel, "Going"));
    await userEvent.click(rsvpButton(panel, "Can't go"));

    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
    finishSaving(savedResponse(SCRIMMAGE.id, "yes"));
    await waitFor(() =>
      expect(rsvpButton(panel, "Going")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
  });

  it("con un fallo de red lo dice en el panel, no marca el botón y deja reintentar", async () => {
    let attempts = 0;
    stubApi(({ method, url }) => {
      if (method === "PUT") {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return savedResponse(SCRIMMAGE.id, "yes");
      }
      if (url.pathname === `${AGENDA_PATH}/${SCRIMMAGE.id}`) {
        return detailResponse(SCRIMMAGE, { myResponse: "yes", goingCount: 19 });
      }
      return pageResponse({ events: [SCRIMMAGE], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(panel, "Going"));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "We couldn't save your answer. Check your connection and try again.",
    );
    expect(rsvpButton(panel, "Going")).toHaveAttribute("aria-pressed", "false");
    expectCounts(panel, { going: "Going · 18", maybe: "1 maybe" });

    await userEvent.click(rsvpButton(panel, "Going"));

    await waitFor(() =>
      expect(rsvpButton(panel, "Going")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
    expectCounts(panel, { going: "Going · 19", maybe: "1 maybe" });
  });

  it("con un 422 de evento empezado lo dice en el panel y deja la respuesta que había", async () => {
    stubApi(({ method, url }) =>
      method === "PUT"
        ? startedResponse()
        : agendaOrDetail(url, [POOL_TRAINING]),
    );
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(panel, "Can't go"));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "This event has already started, so you can't answer anymore.",
    );
    expect(rsvpButton(panel, "Can't go")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(rsvpButton(panel, "Going")).toHaveAttribute("aria-pressed", "true");
    expectCounts(panel, { going: "Going · 14", maybe: "2 maybe" });
  });

  it("tras un 422 se puede volver a intentar y manda otra petición", async () => {
    stubApi(({ method, url }) =>
      method === "PUT"
        ? startedResponse()
        : agendaOrDetail(url, [POOL_TRAINING]),
    );
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);
    await userEvent.click(rsvpButton(panel, "Can't go"));
    await within(panel).findByRole("alert");

    await userEvent.click(rsvpButton(panel, "Can't go"));

    await waitFor(() => expect(rsvpRequests(POOL_TRAINING)).toHaveLength(2));
  });

  it("con un 422 de evento cancelado dice que se canceló", async () => {
    stubApi(({ method, url }) =>
      method === "PUT"
        ? jsonResponse(422, {
            error: {
              code: "business_rule",
              message: "El evento está cancelado: ya no se puede responder.",
              reason: "rsvp_event_cancelled",
            },
          })
        : agendaOrDetail(url, [SCRIMMAGE]),
    );
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(panel, "Going"));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "This event was cancelled, so you can't answer anymore.",
    );
    expect(rsvpButton(panel, "Going")).toHaveAttribute("aria-pressed", "false");
  });

  it("dice el error de RSVP en español", async () => {
    stubApi(({ method, url }) =>
      method === "PUT"
        ? startedResponse()
        : agendaOrDetail(url, [POOL_TRAINING]),
    );
    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(panel, "No puedo"));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Este evento ya empezó: ya no se puede responder.",
    );
  });
});
type DetailExtras = Pick<MemberEventDetail, "notes" | "going" | "maybe"> & {
  readonly audience?: OrganizerEventDetail["audience"];
};

const TRAINING_NOTES = "Bring fins and a spare snorkel.";

const WITH_RESPONSES: DetailExtras = {
  notes: TRAINING_NOTES,
  going: ["Ana Ruiz", "Liam O'Connor"],
  maybe: ["Mia Chen"],
};

function eventPath(event: AgendaEvent): string {
  return `${AGENDA_PATH}/${event.id}`;
}

function openedResponse(event: AgendaEvent, extras: DetailExtras): Response {
  return jsonResponse(200, {
    data: { ...event, coverUrl: null, series: null, ...extras },
  });
}

/** La agenda de una página y el detalle de sus eventos con lo que se pase. */
function stubAgendaWithDetail(
  events: readonly AgendaEvent[],
  extras: DetailExtras,
): void {
  stubApi(({ url }) => {
    const opened = events.find((event) => url.pathname === eventPath(event));
    return opened === undefined
      ? pageResponse({ events, nextCursor: null })
      : openedResponse(opened, extras);
  });
}

function detailRequests(event: AgendaEvent): RecordedRequest[] {
  return requests.filter(
    (request) => request.method === "GET" && request.path === eventPath(event),
  );
}

function rowToggle(row: HTMLElement, title: string): HTMLElement {
  return within(row).getByRole("button", { name: title });
}

const LOADING_DETAIL = /Loading the details|Cargando el detalle/;

/** Elige la fila si no lo estaba (la primera ya llega elegida) y devuelve el
 * panel del evento (#648) cuando su detalle ya llegó o falló. */
async function openPanel(title: string): Promise<HTMLElement> {
  const row = await findRow(title);
  const toggle = rowToggle(row, title);
  if (toggle.getAttribute("aria-current") !== "true") {
    await userEvent.click(toggle);
  }
  const panel = await screen.findByRole("complementary", { name: title });
  await waitFor(() =>
    expect(within(panel).queryByText(LOADING_DETAIL)).toBeNull(),
  );
  return panel;
}

/** Los conteos del panel: "Going · 18" y "1 maybe". */
function expectCounts(
  panel: HTMLElement,
  counts: { readonly going: string; readonly maybe: string },
): void {
  expect(within(panel).getByText(counts.going)).toBeInTheDocument();
  expect(within(panel).getByText(counts.maybe)).toBeInTheDocument();
}

// #648: lo que enseñaba el acordeón de la fila (#312) lo enseña ahora el panel
// del evento elegido.
describe("detalle en el panel", () => {
  it("al abrir pide sólo el detalle del primer evento, que llega elegido", async () => {
    stubAgendaWithDetail([POOL_TRAINING, SCRIMMAGE], WITH_RESPONSES);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await openPanel(POOL_TRAINING.title);
    expect(detailRequests(POOL_TRAINING)).toHaveLength(1);
    expect(detailRequests(SCRIMMAGE)).toEqual([]);
  });

  it("enseña las notas y, con Ver todos, los nombres de quienes van y quizás", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "See all" }),
    );

    expect(within(panel).getByText(TRAINING_NOTES)).toBeInTheDocument();
    const going = within(panel).getByRole("list", { name: "Going" });
    expect(
      within(going)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ana Ruiz", "Liam O'Connor"]);
    const maybe = within(panel).getByRole("list", { name: "Maybe" });
    expect(within(maybe).getByText("Mia Chen")).toBeInTheDocument();
  });

  it("pide el detalle del evento que se elige", async () => {
    stubAgendaWithDetail([POOL_TRAINING, SCRIMMAGE], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(SCRIMMAGE.title);

    expect(within(panel).getByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(detailRequests(SCRIMMAGE)).toHaveLength(1);
  });

  it("al volver a elegir un evento no pide su detalle otra vez", async () => {
    stubAgendaWithDetail([POOL_TRAINING, SCRIMMAGE], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await openPanel(POOL_TRAINING.title);
    await openPanel(SCRIMMAGE.title);

    const panel = await openPanel(POOL_TRAINING.title);

    expect(within(panel).getByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(detailRequests(POOL_TRAINING)).toHaveLength(1);
  });

  // El diseño de E24 sólo pinta NOTES cuando las hay (#648): la frase de
  // "no tiene notas" del acordeón ya no sale.
  it("sin notas no pinta el apartado de notas", async () => {
    stubAgendaWithDetail([POOL_TRAINING], { ...WITH_RESPONSES, notes: null });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(within(panel).queryByRole("heading", { name: "Notes" })).toBeNull();
    expect(within(panel).queryByText("This event has no notes.")).toBeNull();
  });

  it("dice con una frase que nadie ha respondido todavía", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      notes: TRAINING_NOTES,
      going: [],
      maybe: [],
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(
      within(panel).getByText("Nobody has answered yet."),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("list")).not.toBeInTheDocument();
  });

  it("dice que nadie va todavía si sólo hay quizás", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      notes: TRAINING_NOTES,
      going: [],
      maybe: ["Mia Chen"],
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "See all" }),
    );

    expect(within(panel).getByText("Nobody yet.")).toBeInTheDocument();
    expect(within(panel).getByText("Mia Chen")).toBeInTheDocument();
  });

  it("a quien organiza le enseña que el evento va a todo el club", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      ...WITH_RESPONSES,
      audience: { kind: "club" },
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(within(panel).getByText("The whole club")).toBeInTheDocument();
  });

  it("a quien organiza le enseña los nombres de los grupos de la audiencia", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      ...WITH_RESPONSES,
      audience: {
        kind: "groups",
        groups: [
          { id: "11111111-0000-4000-8000-000000000001", name: "Juniors" },
          { id: "22222222-0000-4000-8000-000000000002", name: "Masters" },
        ],
      },
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(within(panel).getByText("Juniors · Masters")).toBeInTheDocument();
  });

  it("dice que la audiencia se quedó sin grupos", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      ...WITH_RESPONSES,
      audience: { kind: "groups", groups: [] },
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(
      within(panel).getByText(
        "No groups: only Admins and the Committee see it.",
      ),
    ).toBeInTheDocument();
  });

  it("a un Player o un Coach no le enseña la audiencia", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(within(panel).getByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(within(panel).queryByText("The whole club")).not.toBeInTheDocument();
  });

  it("si el detalle no carga lo dice en el panel y deja reintentar", async () => {
    let attempts = 0;
    stubApi(({ url }) => {
      if (url.pathname === eventPath(POOL_TRAINING)) {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return openedResponse(POOL_TRAINING, WITH_RESPONSES);
      }
      return pageResponse({ events: [POOL_TRAINING], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: "Try again" }),
    );

    expect(await within(panel).findByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("elige una fila con Enter y otra con Espacio", async () => {
    stubAgendaWithDetail([POOL_TRAINING, SCRIMMAGE], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await openPanel(POOL_TRAINING.title);
    const scrimmage = rowToggle(
      await findRow(SCRIMMAGE.title),
      SCRIMMAGE.title,
    );
    const training = rowToggle(
      await findRow(POOL_TRAINING.title),
      POOL_TRAINING.title,
    );

    scrimmage.focus();
    await userEvent.keyboard("{Enter}");
    expect(
      await screen.findByRole("complementary", { name: SCRIMMAGE.title }),
    ).toBeInTheDocument();
    expect(scrimmage).toHaveAttribute("aria-current", "true");

    training.focus();
    await userEvent.keyboard(" ");
    expect(
      await screen.findByRole("complementary", { name: POOL_TRAINING.title }),
    ).toBeInTheDocument();
    expect(scrimmage).not.toHaveAttribute("aria-current");
  });

  it("el botón de la fila apunta al panel que llena", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);
    const row = await findRow(POOL_TRAINING.title);

    const controlled = rowToggle(row, POOL_TRAINING.title).getAttribute(
      "aria-controls",
    );

    expect(controlled).not.toBeNull();
    expect(document.getElementById(controlled ?? "")).toBe(panel);
    expect(panel).toHaveTextContent(TRAINING_NOTES);
  });

  it("al responder en el panel pone los nombres que devuelve la API", async () => {
    stubApi(({ method, url }) => {
      if (method === "PUT") {
        return savedResponse(SCRIMMAGE.id, "yes");
      }
      if (url.pathname === eventPath(SCRIMMAGE)) {
        const hasAnswered = requests.some(
          (request) => request.method === "PUT",
        );
        return openedResponse(
          { ...SCRIMMAGE, myResponse: hasAnswered ? "yes" : null },
          hasAnswered
            ? { ...WITH_RESPONSES, going: ["Ana Ruiz", "Zoe Park"] }
            : WITH_RESPONSES,
        );
      }
      return pageResponse({ events: [SCRIMMAGE], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(SCRIMMAGE.title);
    await within(panel).findByText("Liam O'Connor");

    await userEvent.click(rsvpButton(panel, "Going"));

    expect(await within(panel).findByText("Zoe Park")).toBeInTheDocument();
    expect(within(panel).queryByText("Liam O'Connor")).not.toBeInTheDocument();
  });

  it("un detalle que llega tarde no pisa los nombres que trajo una respuesta", async () => {
    let finishFirstOpening: (response: Response) => void = () => undefined;
    let openings = 0;
    stubApi(({ method, url }) => {
      if (method === "PUT") {
        return savedResponse(SCRIMMAGE.id, "yes");
      }
      if (url.pathname === eventPath(SCRIMMAGE)) {
        openings += 1;
        if (openings === 1) {
          return new Promise<Response>((resolve) => {
            finishFirstOpening = resolve;
          });
        }
        return openedResponse(
          { ...SCRIMMAGE, myResponse: "yes" },
          { ...WITH_RESPONSES, going: ["Zoe Park"] },
        );
      }
      return pageResponse({ events: [SCRIMMAGE], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    // El primer detalle no llega: el panel sigue cargando mientras responde.
    const panel = await screen.findByRole("complementary", {
      name: SCRIMMAGE.title,
    });
    await userEvent.click(rsvpButton(panel, "Going"));
    await within(panel).findByText("Zoe Park");

    finishFirstOpening(openedResponse(SCRIMMAGE, WITH_RESPONSES));

    await waitFor(() => expect(openings).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(panel).getByText("Zoe Park")).toBeInTheDocument();
    expect(within(panel).queryByText("Liam O'Connor")).not.toBeInTheDocument();
  });

  it("escribe el detalle en español", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      notes: null,
      going: [],
      maybe: [],
      audience: { kind: "club" },
    });
    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);

    expect(
      within(panel).getByText("Todavía no ha respondido nadie."),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Todo el club")).toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: "Notas" })).toBeNull();
  });
});
const PAST_MATCH: AgendaEvent = {
  ...SCRIMMAGE,
  id: "eeeeeeee-0000-4000-8000-00000000000e",
  startsOn: "2026-05-30",
  title: "Round 3 vs Sydney",
  myResponse: "yes",
};

const OLDER_PAST_TRAINING: AgendaEvent = {
  ...POOL_TRAINING,
  id: "ffffffff-0000-4000-8000-00000000000f",
  startsOn: "2026-05-12",
  title: "Early Season Training",
};

/** Los próximos sin `period`, los pasados con `period=past`. */
function stubBothPeriods(past: readonly AgendaEvent[]): void {
  stubApi(({ url }) =>
    url.searchParams.get("period") === "past"
      ? agendaOrDetail(url, past)
      : agendaOrDetail(url, [POOL_TRAINING, ...past]),
  );
}

function periodButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("próximos y pasados", () => {
  it("abre en Próximos, marcado como elegido", async () => {
    stubBothPeriods([PAST_MATCH]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(periodButton("Upcoming")).toHaveAttribute("aria-pressed", "true");
    expect(periodButton("Past")).toHaveAttribute("aria-pressed", "false");
  });

  it("al elegir Pasados pide los pasados y los pinta en el orden del servidor", async () => {
    stubBothPeriods([PAST_MATCH, OLDER_PAST_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Past"));

    const list = await screen.findByRole("list", { name: "Past events" });
    expect(
      within(list)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([PAST_MATCH.title, OLDER_PAST_TRAINING.title]);
    expect(agendaPageRequests().at(-1)).toEqual({
      method: "GET",
      path: `${AGENDA_PATH}?period=past`,
    });
    expect(periodButton("Past")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("heading", { name: POOL_TRAINING.title }),
    ).not.toBeInTheDocument();
  });

  it("no pone botones de RSVP en los pasados", async () => {
    stubBothPeriods([PAST_MATCH]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Past"));

    const panel = await openPanel(PAST_MATCH.title);
    expect(
      within(panel).queryByRole("button", { name: RSVP_CHOICE }),
    ).toBeNull();
    expectCounts(panel, { going: "Going · 18", maybe: "1 maybe" });
  });

  it("un pasado también se abre en el panel", async () => {
    stubApi(({ url }) => {
      if (url.pathname === eventPath(PAST_MATCH)) {
        return openedResponse(PAST_MATCH, WITH_RESPONSES);
      }
      return url.searchParams.get("period") === "past"
        ? pageResponse({ events: [PAST_MATCH], nextCursor: null })
        : pageResponse({ events: [POOL_TRAINING], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);
    await userEvent.click(periodButton("Past"));

    const panel = await openPanel(PAST_MATCH.title);

    expect(await within(panel).findByText(TRAINING_NOTES)).toBeInTheDocument();
  });

  it("trae más pasados con el cursor y el periodo", async () => {
    stubApi(({ url }) => {
      if (url.searchParams.get("period") !== "past") {
        return pageResponse({ events: [POOL_TRAINING], nextCursor: null });
      }
      return url.searchParams.get("cursor") === "pasados-2"
        ? pageResponse({ events: [OLDER_PAST_TRAINING], nextCursor: null })
        : pageResponse({ events: [PAST_MATCH], nextCursor: "pasados-2" });
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);
    await userEvent.click(periodButton("Past"));
    await findRow(PAST_MATCH.title);

    await userEvent.click(screen.getByRole("button", { name: "See more" }));

    expect(await findRow(OLDER_PAST_TRAINING.title)).toBeInTheDocument();
    expect(agendaPageRequests().at(-1)).toEqual({
      method: "GET",
      path: `${AGENDA_PATH}?period=past&cursor=pasados-2`,
    });
  });

  it("dice con una frase que no hay eventos pasados", async () => {
    stubBothPeriods([]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Past"));

    expect(
      await screen.findByText("There are no past events."),
    ).toBeInTheDocument();
  });

  it("al volver a Próximos devuelve la vista de antes sin pedirla otra vez", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);
    await within(panel).findByText(TRAINING_NOTES);
    await userEvent.click(periodButton("Past"));
    await screen.findByRole("list", { name: "Past events" });

    await userEvent.click(periodButton("Upcoming"));

    const again = await screen.findByRole("complementary", {
      name: POOL_TRAINING.title,
    });
    expect(within(again).getByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(
      requests.filter((request) => request.path === AGENDA_PATH),
    ).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Upcoming events" }),
    ).toBeInTheDocument();
  });

  it("escribe el control y la vista de pasados en español", async () => {
    stubBothPeriods([]);
    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Pasados"));

    expect(
      await screen.findByText("No hay eventos pasados."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Eventos pasados" }),
    ).toBeInTheDocument();
    expect(periodButton("Próximos")).toHaveAttribute("aria-pressed", "false");
  });
});

// "Pasar lista" (#395): lleva a Asistencia con la sesión abierta, sólo a
// quien registra asistencia y sólo en un entrenamiento que ya empezó.
describe("pasar lista desde el panel", () => {
  // El martes 23 de junio de 2026 a las 20:00 de Melbourne: el entrenamiento
  // de las 19:00 ya empezó.
  const TRAINING_EVENING = new Date("2026-06-23T10:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TRAINING_EVENING);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function takeAttendanceLink(panel: HTMLElement): HTMLElement | null {
    return within(panel).queryByRole("link", { name: "Take attendance" });
  }

  async function panelOf(
    event: AgendaEvent,
    canTakeAttendance: boolean,
  ): Promise<HTMLElement> {
    stubAgendaWithDetail([event], WITH_RESPONSES);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={canTakeAttendance}
        canRespond
      />,
    );
    const panel = await openPanel(event.title);
    await within(panel).findByText(TRAINING_NOTES);
    return panel;
  }

  it("a quien pasa lista le ofrece Pasar lista en un entrenamiento empezado, con la sesión en la dirección", async () => {
    const panel = await panelOf(POOL_TRAINING, true);

    expect(takeAttendanceLink(panel)).toHaveAttribute(
      "href",
      `/asistencia?sesion=${POOL_TRAINING.id}`,
    );
  });

  it("no lo ofrece antes de que el entrenamiento empiece", async () => {
    const panel = await panelOf({ ...POOL_TRAINING, startTime: "21:00" }, true);

    expect(takeAttendanceLink(panel)).toBeNull();
  });

  it("no lo ofrece en un evento que no es de entrenamiento", async () => {
    const panel = await panelOf(
      { ...POOL_TRAINING, eventType: "competition" },
      true,
    );

    expect(takeAttendanceLink(panel)).toBeNull();
  });

  it("no lo ofrece en un entrenamiento cancelado", async () => {
    const panel = await panelOf(
      { ...POOL_TRAINING, status: "cancelled" },
      true,
    );

    expect(takeAttendanceLink(panel)).toBeNull();
  });

  it("no se lo ofrece a quien no pasa lista", async () => {
    const panel = await panelOf(POOL_TRAINING, false);

    expect(takeAttendanceLink(panel)).toBeNull();
  });

  it("también lo ofrece en un entrenamiento de los pasados", async () => {
    stubApi(({ url }) => {
      if (url.pathname === eventPath(OLDER_PAST_TRAINING)) {
        return openedResponse(OLDER_PAST_TRAINING, WITH_RESPONSES);
      }
      return url.searchParams.get("period") === "past"
        ? pageResponse({ events: [OLDER_PAST_TRAINING], nextCursor: null })
        : pageResponse({ events: [], nextCursor: null });
    });
    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance
        canRespond
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Pasados" }),
    );

    const panel = await openPanel(OLDER_PAST_TRAINING.title);

    expect(
      await within(panel).findByRole("link", { name: "Pasar lista" }),
    ).toHaveAttribute("href", `/asistencia?sesion=${OLDER_PAST_TRAINING.id}`);
  });
});

// #427: un evento encontrado en la búsqueda global lleva a su fila.
describe("llegar a un evento desde la búsqueda", () => {
  it("lleva el foco al título del evento pedido", async () => {
    stubAgenda([POOL_TRAINING, SCRIMMAGE]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        focusEventId={SCRIMMAGE.id}
      />,
    );

    const title = await screen.findByRole("heading", {
      level: 3,
      name: SCRIMMAGE.title,
    });
    await waitFor(() => expect(title).toHaveFocus());
  });

  it("abre en los pasados cuando el evento ya ocurrió", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        initialPeriod="past"
        focusEventId={POOL_TRAINING.id}
      />,
    );

    expect(
      await screen.findByRole("list", { name: "Past events" }),
    ).toBeInTheDocument();
    expect(agendaPageRequests()).toEqual([
      { method: "GET", path: `${AGENDA_PATH}?period=past` },
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 3, name: POOL_TRAINING.title }),
      ).toHaveFocus(),
    );
  });

  it("sigue pidiendo páginas hasta encontrar el evento pedido", async () => {
    stubApi(({ url }) =>
      url.searchParams.get("cursor") === "pagina-2"
        ? pageResponse({ events: [SCRIMMAGE], nextCursor: "pagina-3" })
        : pageResponse({ events: [POOL_TRAINING], nextCursor: "pagina-2" }),
    );

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        focusEventId={SCRIMMAGE.id}
      />,
    );

    const title = await screen.findByRole("heading", {
      level: 3,
      name: SCRIMMAGE.title,
    });
    await waitFor(() => expect(title).toHaveFocus());
    expect(agendaPageRequests().map((request) => request.path)).toEqual([
      AGENDA_PATH,
      `${AGENDA_PATH}?cursor=pagina-2`,
    ]);
    expect(
      screen.getByRole("button", { name: "See more" }),
    ).toBeInTheDocument();
  });

  it("deja de buscar el evento tras unas pocas páginas", async () => {
    let page = 0;
    stubApi(({ url }) => {
      if (url.pathname !== AGENDA_PATH) {
        return jsonResponse(404, {
          error: { code: "not_found", message: "No está." },
        });
      }
      page += 1;
      return pageResponse({
        events: [
          {
            ...POOL_TRAINING,
            id: `00000000-0000-4000-8000-${String(page).padStart(12, "0")}`,
          },
        ],
        nextCursor: `pagina-${page + 1}`,
      });
    });

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        focusEventId="un-evento-que-no-esta"
      />,
    );

    await screen.findAllByRole("heading", {
      level: 3,
      name: POOL_TRAINING.title,
    });
    await waitFor(() => expect(agendaPageRequests()).toHaveLength(4));
    expect(
      screen.getAllByRole("heading", { level: 3, name: POOL_TRAINING.title }),
    ).toHaveLength(4);
  });

  it("sin evento pedido no mueve el foco", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const title = await screen.findByRole("heading", {
      level: 3,
      name: POOL_TRAINING.title,
    });
    expect(title).not.toHaveFocus();
  });
});

function membershipNotCurrentResponse(): Response {
  return jsonResponse(403, {
    error: {
      code: "forbidden",
      message: "Tu membresía no está al día.",
      reason: "membership_not_current",
    },
  });
}

describe("quien no tiene la membresía al día (#453)", () => {
  it("ve los eventos con los botones de RSVP deshabilitados", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond={false}
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);
    for (const name of ["Going", "Maybe", "Can't go"]) {
      expect(rsvpButton(panel, name)).toBeDisabled();
    }
    expectCounts(panel, { going: "Going · 14", maybe: "2 maybe" });
  });

  it("no pide los equipos al elegir un entrenamiento: son de socio", async () => {
    stubAgenda([POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond={false}
      />,
    );

    await openPanel(POOL_TRAINING.title);

    expect(requests.some((request) => request.path.endsWith("/team"))).toBe(
      false,
    );
  });

  it("le dice por qué con un enlace a Pagos", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond={false}
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(
      screen.getByText(/Your membership isn't up to date/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to Payments" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("anuda la frase a los botones, para que un lector de pantalla sepa por qué no responden", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond={false}
      />,
    );

    const panel = await openPanel(POOL_TRAINING.title);
    expect(
      within(panel).getByRole("group", { name: /^RSVP:/ }),
    ).toHaveAccessibleDescription(/Your membership isn't up to date/);
  });

  it("no manda ninguna respuesta aunque se pulse", async () => {
    stubAgenda([POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond={false}
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(panel, "Going"));

    expect(rsvpRequests(POOL_TRAINING)).toEqual([]);
  });

  it("escribe la frase en español", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond={false}
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(screen.getByText(/Tu membresía no está al día/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Pagos" })).toHaveAttribute(
      "href",
      "/pagos",
    );
  });

  it("no pinta la frase a quien está al día", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(
      screen.queryByRole("link", { name: "Go to Payments" }),
    ).not.toBeInTheDocument();
  });

  it("explica el 403 de una membresía que dejó de estar al día con la pantalla abierta", async () => {
    stubApi(({ method, url }) => {
      if (method === "PUT" && url.pathname === rsvpPath(POOL_TRAINING)) {
        return membershipNotCurrentResponse();
      }
      return agendaOrDetail(url, [POOL_TRAINING]);
    });
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(panel, "Going"));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Your membership isn't up to date. Sort it out in Payments to answer.",
    );
  });
});

// #647, RF-6 del PRD de E24: la agenda de escritorio, con los chips de tipo,
// los grupos por día y la fila nueva.
describe("chips de tipo", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  function chip(name: string): HTMLElement {
    const chips = screen.getByRole("group", { name: "Event types" });
    return within(chips).getByRole("button", { name });
  }

  it("enseña los cuatro tipos encendidos como botones con aria-pressed", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(POOL_TRAINING.title);
    for (const name of ["Training", "Competition", "Social", "Meeting"]) {
      expect(chip(name)).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("al apagar uno vuelve a pedir la agenda con los demás y lo guarda en la dirección", async () => {
    stubAgenda([POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(chip("Meeting"));

    expect(chip("Meeting")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(agendaPageRequests().at(-1)).toEqual({
        method: "GET",
        path: `${AGENDA_PATH}?types=training%2Ccompetition%2Csocial`,
      }),
    );
    expect(window.location.search).toBe(
      "?types=training%2Ccompetition%2Csocial",
    );
  });

  it("al encenderlo otra vez pide todos los tipos y quita el parámetro", async () => {
    stubAgenda([POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        initialTypes={["training"]}
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(chip("Social"));
    await userEvent.click(chip("Competition"));
    await userEvent.click(chip("Meeting"));

    await waitFor(() =>
      expect(agendaPageRequests().at(-1)).toEqual({
        method: "GET",
        path: AGENDA_PATH,
      }),
    );
    expect(window.location.search).toBe("");
  });

  it("abre con el filtro que traía la dirección", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        initialTypes={["training", "social"]}
      />,
    );

    await findRow(POOL_TRAINING.title);
    expect(agendaPageRequests()).toEqual([
      { method: "GET", path: `${AGENDA_PATH}?types=training%2Csocial` },
    ]);
    expect(chip("Competition")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Social")).toHaveAttribute("aria-pressed", "true");
  });

  it("conserva la dirección que ya tenía al escribir el filtro", async () => {
    window.history.replaceState(null, "", `/?evento=${POOL_TRAINING.id}`);
    stubAgenda([POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);

    await userEvent.click(chip("Training"));

    expect(window.location.search).toBe(
      `?evento=${POOL_TRAINING.id}&types=competition%2Csocial%2Cmeeting`,
    );
  });

  it("con todos apagados lo dice sin pedir la agenda y deja encenderlos todos", async () => {
    stubAgenda([POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        initialTypes={["meeting"]}
      />,
    );
    await screen.findByText("TUE · JUN 23");
    const before = agendaPageRequests().length;

    await userEvent.click(chip("Meeting"));

    expect(
      screen.getByText("There are no events of the chosen types."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(agendaPageRequests()).toHaveLength(before);
    expect(window.location.search).toBe("?types=");

    await userEvent.click(
      screen.getByRole("button", { name: "Show all types" }),
    );

    expect(await findRow(POOL_TRAINING.title)).toBeInTheDocument();
    expect(chip("Meeting")).toHaveAttribute("aria-pressed", "true");
    expect(agendaPageRequests().at(-1)).toEqual({
      method: "GET",
      path: AGENDA_PATH,
    });
  });

  it("abre sin pedir la agenda cuando la dirección los traía todos apagados", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        initialTypes={[]}
      />,
    );

    expect(
      await screen.findByText("There are no events of the chosen types."),
    ).toBeInTheDocument();
    expect(agendaPageRequests()).toEqual([]);
  });

  it("conserva el filtro al pasar a los pasados", async () => {
    stubBothPeriods([PAST_MATCH]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await findRow(POOL_TRAINING.title);
    await userEvent.click(chip("Social"));

    await userEvent.click(periodButton("Past"));

    await findRow(PAST_MATCH.title);
    expect(agendaPageRequests().at(-1)).toEqual({
      method: "GET",
      path: `${AGENDA_PATH}?period=past&types=training%2Ccompetition%2Cmeeting`,
    });
    expect(chip("Social")).toHaveAttribute("aria-pressed", "false");
  });

  it("escribe los chips y el aviso en español", async () => {
    stubAgenda([]);
    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
        initialTypes={[]}
      />,
    );

    expect(
      await screen.findByText("No hay eventos de los tipos elegidos."),
    ).toBeInTheDocument();
    const chips = screen.getByRole("group", { name: "Tipos de evento" });
    expect(
      within(chips).getByRole("button", { name: "Entrenamiento" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Mostrar todos los tipos" }),
    ).toBeInTheDocument();
  });
});

describe("grupos por día", () => {
  // Viernes 16 de octubre de 2026, por la mañana en Melbourne.
  const FRIDAY_MORNING = new Date("2026-10-15T22:00:00Z");

  const TODAY_TRAINING: AgendaEvent = {
    ...POOL_TRAINING,
    startsOn: "2026-10-16",
  };
  const SATURDAY_MATCH: AgendaEvent = {
    ...SCRIMMAGE,
    startsOn: "2026-10-17",
  };
  const TUESDAY_MEETING: AgendaEvent = {
    ...COMMITTEE_ONLY,
    startsOn: "2026-10-20",
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FRIDAY_MORNING);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("titula cada día y deja sus eventos debajo", async () => {
    stubAgenda([TODAY_TRAINING, SATURDAY_MATCH, TUESDAY_MEETING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(TODAY_TRAINING.title);
    const days = within(screen.getByRole("list", { name: "Upcoming events" }))
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(days).toEqual([
      "TODAY Today Friday 16 October 2026",
      "SAT · OCT 17 Saturday 17 October 2026 This weekend",
      "TUE · OCT 20 Tuesday 20 October 2026",
    ]);
  });

  it("pinta hoy en el acento y los demás días en secundario", async () => {
    stubAgenda([TODAY_TRAINING, TUESDAY_MEETING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(TODAY_TRAINING.title);
    expect(screen.getByText("TODAY")).toHaveClass("is-today");
    expect(screen.getByText("TUE · OCT 20")).not.toHaveClass("is-today");
  });

  it("anuncia el día entero y no la abreviatura", async () => {
    stubAgenda([SATURDAY_MATCH]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Saturday 17 October 2026 This weekend",
      }),
    ).toBeInTheDocument();
  });

  it("escribe los días en español", async () => {
    stubAgenda([TODAY_TRAINING, SATURDAY_MATCH]);

    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await findRow(TODAY_TRAINING.title);
    expect(screen.getByText("HOY")).toBeInTheDocument();
    expect(screen.getByText("SÁB · 17 OCT")).toBeInTheDocument();
    expect(screen.getByText("Este fin de semana")).toBeInTheDocument();
  });

  it("añade el año a un día de otro año", async () => {
    stubAgenda([{ ...SCRIMMAGE, startsOn: "2025-10-18" }]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    expect(await screen.findByText("SAT · OCT 18 · 2025")).toBeInTheDocument();
  });
});

describe("fila de la agenda", () => {
  const PILL = ".agenda-answer-pill";
  const MISSING_ANSWER = ".agenda-answer-missing";
  const WITH_END_AND_COVER: AgendaEvent = {
    ...POOL_TRAINING,
    endTime: "20:30",
    seriesId: "eeeeeeee-0000-4000-8000-00000000000e",
    coverThumbUrl: "https://storage.example/thumb.webp?token=signed",
  };

  it("pone la hora de fin debajo de la de inicio", async () => {
    stubAgenda([WITH_END_AND_COVER]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(WITH_END_AND_COVER.title);
    expect(within(row).getByText("7:00 pm")).toBeInTheDocument();
    expect(within(row).getByText("8:30 pm")).toBeInTheDocument();
    expect(within(row).getByText("7:00 pm – 8:30 pm")).toHaveClass(
      "visually-hidden",
    );
  });

  it("sin hora de fin sólo pone la de inicio", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(POOL_TRAINING.title);
    expect(within(row).getAllByText(/\d:\d\d/)).toHaveLength(1);
  });

  it("pinta la miniatura del evento como decoración", async () => {
    stubAgenda([WITH_END_AND_COVER]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(WITH_END_AND_COVER.title);
    const thumbnail = row.querySelector("img");
    expect(thumbnail).toHaveAttribute("src", WITH_END_AND_COVER.coverThumbUrl);
    expect(thumbnail).toHaveAttribute("alt", "");
  });

  it("sin imagen pinta el fondo de su tipo", async () => {
    stubAgenda([SCRIMMAGE]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(SCRIMMAGE.title);
    expect(row.querySelector("img")).toBeNull();
    expect(
      row.querySelector(".event-cover-fallback-competition"),
    ).not.toBeNull();
  });

  it("dice que el evento se repite cuando es de una serie", async () => {
    stubAgenda([WITH_END_AND_COVER, SCRIMMAGE]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const series = await findRow(WITH_END_AND_COVER.title);
    const single = await findRow(SCRIMMAGE.title);
    expect(within(series).getByText("Repeats")).toBeInTheDocument();
    expect(within(single).queryByText("Repeats")).not.toBeInTheDocument();
  });

  it("enlaza el lugar al mapa en otra pestaña", async () => {
    stubAgenda([POOL_TRAINING]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(POOL_TRAINING.title);
    const place = within(row).getByRole("link", {
      name: "MSAC Dive Pool (map, opens in a new tab)",
    });
    expect(place).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=MSAC%20Dive%20Pool",
    );
    expect(place).toHaveAttribute("target", "_blank");
    expect(place.getAttribute("rel")).toContain("noopener");
  });

  it("enlaza al punto del lugar cuando tiene coordenadas", async () => {
    stubAgenda([
      {
        ...POOL_TRAINING,
        place: {
          name: "MSAC",
          address: "Aughtie Dr, Albert Park",
          lat: -37.84,
          lng: 144.96,
        },
      },
    ]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(POOL_TRAINING.title);
    expect(within(row).getByRole("link", { name: /MSAC/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-37.84,144.96",
    );
  });

  it("pulsar el lugar no elige la fila", async () => {
    stubAgenda([SCRIMMAGE, POOL_TRAINING]);
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    await openPanel(SCRIMMAGE.title);
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(within(row).getByRole("link", { name: /MSAC/ }));

    expect(rowToggle(row, POOL_TRAINING.title)).not.toHaveAttribute(
      "aria-current",
    );
    expect(detailRequests(POOL_TRAINING)).toEqual([]);
  });

  it("enseña mi respuesta en una píldora", async () => {
    stubAgenda([
      POOL_TRAINING,
      { ...SCRIMMAGE, myResponse: "maybe" },
      { ...CANCELLED_SOCIAL, status: "scheduled", myResponse: "no" },
    ]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const going = await findRow(POOL_TRAINING.title);
    expect(within(going).getByText("Going", { selector: PILL })).toHaveClass(
      "agenda-answer-yes",
    );
    expect(
      within(await findRow(SCRIMMAGE.title)).getByText("Maybe", {
        selector: PILL,
      }),
    ).toHaveClass("agenda-answer-maybe");
    expect(
      within(await findRow(CANCELLED_SOCIAL.title)).getByText("Can't go", {
        selector: PILL,
      }),
    ).toHaveClass("agenda-answer-no");
  });

  it("sin respuesta pide el RSVP y dice cuántos van", async () => {
    stubAgenda([SCRIMMAGE]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(SCRIMMAGE.title);
    expect(
      within(row).getByText("RSVP", { selector: MISSING_ANSWER }),
    ).toBeInTheDocument();
    expect(within(row).getByText("18 going")).toBeInTheDocument();
  });

  it("no pide el RSVP de un evento al que no se puede responder", async () => {
    stubAgenda([COMMITTEE_ONLY]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(COMMITTEE_ONLY.title);
    expect(
      within(row).queryByText("RSVP", { selector: MISSING_ANSWER }),
    ).not.toBeInTheDocument();
  });

  it("la píldora cambia al guardar otra respuesta", async () => {
    stubApi(({ method, url }) =>
      method === "PUT"
        ? savedResponse(SCRIMMAGE.id, "yes")
        : agendaOrDetail(url, [
            {
              ...SCRIMMAGE,
              myResponse: rsvpRequests(SCRIMMAGE).length > 0 ? "yes" : null,
            },
          ]),
    );
    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );
    const panel = await openPanel(SCRIMMAGE.title);
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(panel, "Going"));

    expect(
      await within(row).findByText("Going", { selector: PILL }),
    ).toHaveClass("agenda-answer-yes");
    expect(
      within(row).queryByText("RSVP", { selector: MISSING_ANSWER }),
    ).not.toBeInTheDocument();
  });

  it("marca el cancelado con la palabra y lo atenúa", async () => {
    stubAgenda([CANCELLED_SOCIAL]);

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(CANCELLED_SOCIAL.title);
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    expect(row).toHaveClass("is-cancelled");
  });

  it("escribe la fila en español", async () => {
    stubAgenda([
      { ...WITH_END_AND_COVER, myResponse: "no" },
      { ...SCRIMMAGE, goingCount: 1 },
    ]);

    render(
      <AgendaScreen
        locale="es"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    const row = await findRow(WITH_END_AND_COVER.title);
    expect(within(row).getByText("19:00")).toBeInTheDocument();
    expect(within(row).getByText("20:30")).toBeInTheDocument();
    expect(
      within(row).getByText("No puedo", { selector: PILL }),
    ).toBeInTheDocument();
    expect(within(row).getByText("Se repite")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", {
        name: "MSAC Dive Pool (mapa, se abre en otra pestaña)",
      }),
    ).toBeInTheDocument();
    const single = await findRow(SCRIMMAGE.title);
    expect(within(single).getByText("1 va")).toBeInTheDocument();
  });
});
