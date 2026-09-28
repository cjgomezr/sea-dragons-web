import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const RSVP_CHOICE = /^(Yes|Maybe|No)$/;

const POOL_TRAINING: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-06-23",
  startTime: "19:00",
  title: "Pool Training",
  eventType: "training",
  location: "MSAC Dive Pool",
  status: "scheduled",
  seriesId: null,
  goingCount: 14,
  maybeCount: 2,
  myResponse: "yes",
  inAudience: true,
};

const SCRIMMAGE: AgendaEvent = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-06-27",
  startTime: "10:00",
  title: "Scrimmage vs Geelong Krakens",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  status: "scheduled",
  seriesId: null,
  goingCount: 18,
  maybeCount: 1,
  myResponse: null,
  inAudience: true,
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
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return respond({ method, url, body });
    }),
  );
}

/** La agenda de una sola página y nada más: responder no está servido. */
function stubAgenda(events: readonly AgendaEvent[]): void {
  stubApi(({ url }) => {
    if (url.pathname !== AGENDA_PATH) {
      throw new Error(`Petición inesperada: ${url.pathname}`);
    }
    return pageResponse({ events, nextCursor: null });
  });
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
  const heading = await screen.findByRole("heading", { name: title });
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
  it("pinta cada evento con su bloque de fecha, título, tipo, hora, lugar y conteos", async () => {
    stubAgenda([POOL_TRAINING]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await findRow(POOL_TRAINING.title);
    expect(within(row).getByText("Tue")).toBeInTheDocument();
    expect(within(row).getByText("23")).toBeInTheDocument();
    expect(within(row).getByText("Jun")).toBeInTheDocument();
    expect(within(row).getByText("Training")).toBeInTheDocument();
    expect(
      within(row).getByText("7:00 pm · MSAC Dive Pool"),
    ).toBeInTheDocument();
    expect(within(row).getByText("14 going · 2 maybe")).toBeInTheDocument();
  });

  it("titula la sección Próximos eventos y deja los eventos en el orden del servidor", async () => {
    stubAgenda([POOL_TRAINING, SCRIMMAGE]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const list = await screen.findByRole("list", { name: "Upcoming events" });
    const titles = within(list)
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([POOL_TRAINING.title, SCRIMMAGE.title]);
  });

  it("pide la agenda de los próximos a la API v1", async () => {
    stubAgenda([POOL_TRAINING]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    await findRow(POOL_TRAINING.title);
    expect(requests).toEqual([{ method: "GET", path: AGENDA_PATH }]);
  });

  it("marca el evento cancelado y no le pone botones de RSVP", async () => {
    stubAgenda([CANCELLED_SOCIAL]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await findRow(CANCELLED_SOCIAL.title);
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: RSVP_CHOICE })).toBeNull();
  });

  it("no le pone botones de RSVP a un evento fuera de la audiencia de quien organiza", async () => {
    stubAgenda([COMMITTEE_ONLY]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await findRow(COMMITTEE_ONLY.title);
    expect(within(row).queryByRole("button", { name: RSVP_CHOICE })).toBeNull();
    expect(within(row).getByText("18 going · 1 maybe")).toBeInTheDocument();
  });

  it("dice con una frase que no hay eventos", async () => {
    stubAgenda([]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);

    await userEvent.click(screen.getByRole("button", { name: "See more" }));

    await findRow(SCRIMMAGE.title);
    expect(await findRow(POOL_TRAINING.title)).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);
    expect(
      screen.getByRole("heading", { name: POOL_TRAINING.title }),
    ).not.toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "See more" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: SCRIMMAGE.title }),
      ).toHaveFocus(),
    );
  });

  it("no ofrece Ver más en la última página", async () => {
    stubAgenda([POOL_TRAINING]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await findRow(POOL_TRAINING.title)).toBeInTheDocument();
  });

  it("escribe textos, fechas y horas en español", async () => {
    stubAgenda([POOL_TRAINING, CANCELLED_SOCIAL]);

    render(<AgendaScreen locale="es" canCreateEvents={false} />);

    const row = await findRow(POOL_TRAINING.title);
    expect(
      screen.getByRole("heading", { level: 1, name: "Próximos eventos" }),
    ).toBeInTheDocument();
    expect(within(row).getByText("mar")).toBeInTheDocument();
    expect(within(row).getByText("jun")).toBeInTheDocument();
    expect(within(row).getByText("Entrenamiento")).toBeInTheDocument();
    expect(within(row).getByText("19:00 · MSAC Dive Pool")).toBeInTheDocument();
    expect(within(row).getByText("14 van · 2 quizás")).toBeInTheDocument();
    expect(rsvpButton(row, "Sí")).toBeInTheDocument();
    expect(rsvpButton(row, "Quizás")).toBeInTheDocument();
    const cancelled = await findRow(CANCELLED_SOCIAL.title);
    expect(within(cancelled).getByText("Cancelado")).toBeInTheDocument();
  });

  it("escribe en singular una sola persona que va en español", async () => {
    stubAgenda([{ ...SCRIMMAGE, goingCount: 1, maybeCount: 0 }]);

    render(<AgendaScreen locale="es" canCreateEvents={false} />);

    const row = await findRow(SCRIMMAGE.title);
    expect(within(row).getByText("1 va · 0 quizás")).toBeInTheDocument();
  });

  it("dice que no hay eventos en español", async () => {
    stubAgenda([]);

    render(<AgendaScreen locale="es" canCreateEvents={false} />);

    expect(
      await screen.findByText("No hay eventos próximos."),
    ).toBeInTheDocument();
  });
});

describe("RSVP en la fila", () => {
  it("anuncia qué respuesta está elegida", async () => {
    stubAgenda([POOL_TRAINING]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await findRow(POOL_TRAINING.title);
    const group = within(row).getByRole("group", {
      name: `RSVP: ${POOL_TRAINING.title}`,
    });
    expect(within(group).getByRole("button", { name: "Yes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(group).getByRole("button", { name: "Maybe" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: "No" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(row, "Maybe"));

    await waitFor(() =>
      expect(rsvpButton(row, "Maybe")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(row).getByText("20 going · 4 maybe")).toBeInTheDocument();
    expect(rsvpButton(row, "Yes")).toHaveAttribute("aria-pressed", "false");
  });

  it("si la respuesta se guardó pero los conteos no llegan, los recuenta con la respuesta anterior", async () => {
    stubApi(({ method, url }) => {
      if (method === "PUT") {
        return savedResponse(POOL_TRAINING.id, "maybe");
      }
      if (url.pathname === `${AGENDA_PATH}/${POOL_TRAINING.id}`) {
        throw new TypeError("Failed to fetch");
      }
      return pageResponse({ events: [POOL_TRAINING], nextCursor: null });
    });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(row, "Maybe"));

    await waitFor(() =>
      expect(rsvpButton(row, "Maybe")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(row).getByText("13 going · 3 maybe")).toBeInTheDocument();
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(row, "Yes"));
    await userEvent.click(rsvpButton(row, "Yes"));
    await userEvent.click(rsvpButton(row, "No"));

    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
    finishSaving(savedResponse(SCRIMMAGE.id, "yes"));
    await waitFor(() =>
      expect(rsvpButton(row, "Yes")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
  });

  it("con un fallo de red lo dice en la fila, no marca el botón y deja reintentar", async () => {
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(row, "Yes"));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "We couldn't save your answer. Check your connection and try again.",
    );
    expect(rsvpButton(row, "Yes")).toHaveAttribute("aria-pressed", "false");
    expect(within(row).getByText("18 going · 1 maybe")).toBeInTheDocument();

    await userEvent.click(rsvpButton(row, "Yes"));

    await waitFor(() =>
      expect(rsvpButton(row, "Yes")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(row).getByText("19 going · 1 maybe")).toBeInTheDocument();
  });

  it("con un 422 de evento empezado lo dice en la fila y deja la respuesta que había", async () => {
    stubApi(({ method }) =>
      method === "PUT"
        ? startedResponse()
        : pageResponse({ events: [POOL_TRAINING], nextCursor: null }),
    );
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(row, "No"));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "This event has already started, so you can't answer anymore.",
    );
    expect(rsvpButton(row, "No")).toHaveAttribute("aria-pressed", "false");
    expect(rsvpButton(row, "Yes")).toHaveAttribute("aria-pressed", "true");
    expect(within(row).getByText("14 going · 2 maybe")).toBeInTheDocument();
  });

  it("tras un 422 se puede volver a intentar y manda otra petición", async () => {
    stubApi(({ method }) =>
      method === "PUT"
        ? startedResponse()
        : pageResponse({ events: [POOL_TRAINING], nextCursor: null }),
    );
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(POOL_TRAINING.title);
    await userEvent.click(rsvpButton(row, "No"));
    await within(row).findByRole("alert");

    await userEvent.click(rsvpButton(row, "No"));

    await waitFor(() => expect(rsvpRequests(POOL_TRAINING)).toHaveLength(2));
  });

  it("con un 422 de evento cancelado dice que se canceló", async () => {
    stubApi(({ method }) =>
      method === "PUT"
        ? jsonResponse(422, {
            error: {
              code: "business_rule",
              message: "El evento está cancelado: ya no se puede responder.",
              reason: "rsvp_event_cancelled",
            },
          })
        : pageResponse({ events: [SCRIMMAGE], nextCursor: null }),
    );
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(rsvpButton(row, "Yes"));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "This event was cancelled, so you can't answer anymore.",
    );
    expect(rsvpButton(row, "Yes")).toHaveAttribute("aria-pressed", "false");
  });

  it("dice el error de RSVP en español", async () => {
    stubApi(({ method }) =>
      method === "PUT"
        ? startedResponse()
        : pageResponse({ events: [POOL_TRAINING], nextCursor: null }),
    );
    render(<AgendaScreen locale="es" canCreateEvents={false} />);
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(rsvpButton(row, "No"));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
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
  return jsonResponse(200, { data: { ...event, ...extras } });
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

async function expandRow(title: string): Promise<HTMLElement> {
  const row = await findRow(title);
  await userEvent.click(rowToggle(row, title));
  return row;
}

describe("fila desplegable", () => {
  it("empieza plegada y sin pedir el detalle", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await findRow(POOL_TRAINING.title);
    expect(rowToggle(row, POOL_TRAINING.title)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(row).queryByText(TRAINING_NOTES)).not.toBeInTheDocument();
    expect(detailRequests(POOL_TRAINING)).toEqual([]);
  });

  it("al pulsarla se despliega con las notas y los nombres de quienes van y quizás", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(await within(row).findByText(TRAINING_NOTES)).toBeInTheDocument();
    const going = within(row).getByRole("list", { name: "Going" });
    expect(
      within(going)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ana Ruiz", "Liam O'Connor"]);
    const maybe = within(row).getByRole("list", { name: "Maybe" });
    expect(within(maybe).getByText("Mia Chen")).toBeInTheDocument();
    expect(rowToggle(row, POOL_TRAINING.title)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("pide sólo el detalle del evento que se despliega", async () => {
    stubAgendaWithDetail([POOL_TRAINING, SCRIMMAGE], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(SCRIMMAGE.title);

    await within(row).findByText(TRAINING_NOTES);
    expect(detailRequests(SCRIMMAGE)).toHaveLength(1);
    expect(detailRequests(POOL_TRAINING)).toEqual([]);
  });

  it("al pulsarla otra vez se pliega y al volver a abrirla no pide de nuevo", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await expandRow(POOL_TRAINING.title);
    await within(row).findByText(TRAINING_NOTES);

    await userEvent.click(rowToggle(row, POOL_TRAINING.title));

    expect(rowToggle(row, POOL_TRAINING.title)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(row).queryByText(TRAINING_NOTES)).not.toBeInTheDocument();
    await userEvent.click(rowToggle(row, POOL_TRAINING.title));
    expect(within(row).getByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(detailRequests(POOL_TRAINING)).toHaveLength(1);
  });

  it("dice con una frase que el evento no tiene notas", async () => {
    stubAgendaWithDetail([POOL_TRAINING], { ...WITH_RESPONSES, notes: null });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(
      await within(row).findByText("This event has no notes."),
    ).toBeInTheDocument();
  });

  it("dice con una frase que nadie ha respondido todavía", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      notes: TRAINING_NOTES,
      going: [],
      maybe: [],
    });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(
      await within(row).findByText("Nobody has answered yet."),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("list")).not.toBeInTheDocument();
  });

  it("dice que nadie va todavía si sólo hay quizás", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      notes: TRAINING_NOTES,
      going: [],
      maybe: ["Mia Chen"],
    });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(await within(row).findByText("Nobody yet.")).toBeInTheDocument();
    expect(within(row).getByText("Mia Chen")).toBeInTheDocument();
  });

  it("a quien organiza le enseña que el evento va a todo el club", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      ...WITH_RESPONSES,
      audience: { kind: "club" },
    });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(await within(row).findByText("Audience")).toBeInTheDocument();
    expect(within(row).getByText("The whole club")).toBeInTheDocument();
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(
      await within(row).findByText("Juniors, Masters"),
    ).toBeInTheDocument();
  });

  it("dice que la audiencia se quedó sin grupos", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      ...WITH_RESPONSES,
      audience: { kind: "groups", groups: [] },
    });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(
      await within(row).findByText(
        "No groups: only Admins and the Committee see it.",
      ),
    ).toBeInTheDocument();
  });

  it("a un Player o un Coach no le enseña la audiencia", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    await within(row).findByText(TRAINING_NOTES);
    expect(within(row).queryByText("Audience")).not.toBeInTheDocument();
  });

  it("si el detalle no carga lo dice en la fila y deja reintentar", async () => {
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await expandRow(POOL_TRAINING.title);

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(
      within(row).getByRole("button", { name: "Try again" }),
    );

    expect(await within(row).findByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("se despliega y se pliega con Enter y con Espacio", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await findRow(POOL_TRAINING.title);
    const toggle = rowToggle(row, POOL_TRAINING.title);
    toggle.focus();

    await userEvent.keyboard("{Enter}");
    expect(await within(row).findByText(TRAINING_NOTES)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("el botón de la fila apunta a la zona que despliega", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await expandRow(POOL_TRAINING.title);
    await within(row).findByText(TRAINING_NOTES);

    const controlled = rowToggle(row, POOL_TRAINING.title).getAttribute(
      "aria-controls",
    );

    expect(controlled).not.toBeNull();
    expect(document.getElementById(controlled ?? "")).toHaveTextContent(
      TRAINING_NOTES,
    );
  });

  it("al responder con la fila desplegada pone los nombres que devuelve la API", async () => {
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await expandRow(SCRIMMAGE.title);
    await within(row).findByText("Liam O'Connor");

    await userEvent.click(rsvpButton(row, "Yes"));

    expect(await within(row).findByText("Zoe Park")).toBeInTheDocument();
    expect(within(row).queryByText("Liam O'Connor")).not.toBeInTheDocument();
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await expandRow(SCRIMMAGE.title);
    await userEvent.click(rsvpButton(row, "Yes"));
    await within(row).findByText("Zoe Park");

    finishFirstOpening(openedResponse(SCRIMMAGE, WITH_RESPONSES));

    await waitFor(() => expect(openings).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(row).getByText("Zoe Park")).toBeInTheDocument();
    expect(within(row).queryByText("Liam O'Connor")).not.toBeInTheDocument();
  });
  it("escribe el detalle en español", async () => {
    stubAgendaWithDetail([POOL_TRAINING], {
      notes: null,
      going: [],
      maybe: [],
      audience: { kind: "club" },
    });
    render(<AgendaScreen locale="es" canCreateEvents={false} />);

    const row = await expandRow(POOL_TRAINING.title);

    expect(
      await within(row).findByText("Este evento no tiene notas."),
    ).toBeInTheDocument();
    expect(
      within(row).getByText("Todavía no ha respondido nadie."),
    ).toBeInTheDocument();
    expect(within(row).getByText("Audiencia")).toBeInTheDocument();
    expect(within(row).getByText("Todo el club")).toBeInTheDocument();
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
      ? pageResponse({ events: past, nextCursor: null })
      : pageResponse({ events: [POOL_TRAINING], nextCursor: null }),
  );
}

function periodButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("próximos y pasados", () => {
  it("abre en Próximos, marcado como elegido", async () => {
    stubBothPeriods([PAST_MATCH]);

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    await findRow(POOL_TRAINING.title);
    expect(periodButton("Upcoming")).toHaveAttribute("aria-pressed", "true");
    expect(periodButton("Past")).toHaveAttribute("aria-pressed", "false");
  });

  it("al elegir Pasados pide los pasados y los pinta en el orden del servidor", async () => {
    stubBothPeriods([PAST_MATCH, OLDER_PAST_TRAINING]);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Past"));

    const list = await screen.findByRole("list", { name: "Past events" });
    expect(
      within(list)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([PAST_MATCH.title, OLDER_PAST_TRAINING.title]);
    expect(requests.at(-1)).toEqual({
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Past"));

    const row = await findRow(PAST_MATCH.title);
    expect(within(row).queryByRole("button", { name: RSVP_CHOICE })).toBeNull();
    expect(within(row).getByText("18 going · 1 maybe")).toBeInTheDocument();
  });

  it("un pasado también se despliega", async () => {
    stubApi(({ url }) => {
      if (url.pathname === eventPath(PAST_MATCH)) {
        return openedResponse(PAST_MATCH, WITH_RESPONSES);
      }
      return url.searchParams.get("period") === "past"
        ? pageResponse({ events: [PAST_MATCH], nextCursor: null })
        : pageResponse({ events: [POOL_TRAINING], nextCursor: null });
    });
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);
    await userEvent.click(periodButton("Past"));

    const row = await expandRow(PAST_MATCH.title);

    expect(await within(row).findByText(TRAINING_NOTES)).toBeInTheDocument();
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
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);
    await userEvent.click(periodButton("Past"));
    await findRow(PAST_MATCH.title);

    await userEvent.click(screen.getByRole("button", { name: "See more" }));

    expect(await findRow(OLDER_PAST_TRAINING.title)).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({
      method: "GET",
      path: `${AGENDA_PATH}?period=past&cursor=pasados-2`,
    });
  });

  it("dice con una frase que no hay eventos pasados", async () => {
    stubBothPeriods([]);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    await findRow(POOL_TRAINING.title);

    await userEvent.click(periodButton("Past"));

    expect(
      await screen.findByText("There are no past events."),
    ).toBeInTheDocument();
  });

  it("al volver a Próximos devuelve la vista de antes sin pedirla otra vez", async () => {
    stubAgendaWithDetail([POOL_TRAINING], WITH_RESPONSES);
    render(<AgendaScreen locale="en" canCreateEvents={false} />);
    const row = await expandRow(POOL_TRAINING.title);
    await within(row).findByText(TRAINING_NOTES);
    await userEvent.click(periodButton("Past"));
    await screen.findByRole("list", { name: "Past events" });

    await userEvent.click(periodButton("Upcoming"));

    const again = await findRow(POOL_TRAINING.title);
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
    render(<AgendaScreen locale="es" canCreateEvents={false} />);
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
