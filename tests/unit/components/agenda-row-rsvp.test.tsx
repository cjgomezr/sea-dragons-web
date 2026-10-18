import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type { AgendaEvent, MemberEventDetail } from "@/lib/events/event-agenda";
import type { RsvpResponse } from "@/lib/events/event-rsvp";

/**
 * Voy, Quizás y No puedo en la fila de la agenda en escritorio (#731): se
 * responde sin abrir el panel. La fila y el panel pintan el mismo estado, así
 * que lo que se guarda en uno se ve en el otro. En el móvil la tarjeta no
 * cambia.
 */

const AGENDA_PATH = "/api/v1/events";
const PHONE_QUERY = "(width < 768px)";

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
  ...POOL_TRAINING,
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-06-27",
  title: "Scrimmage vs Geelong Krakens",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  goingCount: 18,
  maybeCount: 1,
  myResponse: null,
};

const CANCELLED_SOCIAL: AgendaEvent = {
  ...SCRIMMAGE,
  id: "cccccccc-0000-4000-8000-00000000000c",
  title: "End-of-Season Social",
  eventType: "social",
  status: "cancelled",
  myResponse: "maybe",
};

const COMMITTEE_ONLY: AgendaEvent = {
  ...SCRIMMAGE,
  id: "dddddddd-0000-4000-8000-00000000000d",
  title: "Coaches Meeting",
  eventType: "meeting",
  inAudience: false,
};

const PAST_MATCH: AgendaEvent = {
  ...SCRIMMAGE,
  id: "eeeeeeee-0000-4000-8000-00000000000e",
  startsOn: "2026-05-30",
  title: "Round 3 vs Ballarat",
  myResponse: "no",
};

const CHOICES = ["Going", "Maybe", "Can't go"] as const;

type Request = {
  readonly method: string;
  readonly pathname: string;
  readonly period: string | null;
};

/** Lo que responde el servidor a un PUT: la respuesta guardada o un fallo. */
type SaveOutcome = Response | Promise<Response>;

const requests: Request[] = [];
/** Lo que guardó cada evento, por su id: el detalle de después lo trae. */
const savedResponses = new Map<string, RsvpResponse>();

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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

function detailOf(event: AgendaEvent): MemberEventDetail {
  return {
    ...event,
    coverUrl: null,
    series: null,
    notes: null,
    going: [],
    maybe: [],
  };
}

function rsvpPath(event: AgendaEvent): string {
  return `${AGENDA_PATH}/${event.id}/rsvp`;
}

/** La agenda (los próximos, o los pasados con `period=past`), el detalle de
 * cada evento con la respuesta guardada (o lo que diga `saved`) y responder
 * con `onSave`. */
function stubApi(options: {
  readonly upcoming: readonly AgendaEvent[];
  readonly past?: readonly AgendaEvent[];
  readonly onSave?: (event: AgendaEvent, response: RsvpResponse) => SaveOutcome;
  readonly saved?: (event: AgendaEvent) => AgendaEvent;
}): void {
  const { upcoming, past = [] } = options;
  const all = [...upcoming, ...past];
  const onSave =
    options.onSave ??
    ((event: AgendaEvent, response: RsvpResponse) =>
      savedResponse(event.id, response));
  const saved =
    options.saved ??
    ((event: AgendaEvent) => ({
      ...event,
      myResponse: savedResponses.get(event.id) ?? event.myResponse,
    }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const period = url.searchParams.get("period");
      requests.push({ method, pathname: url.pathname, period });
      if (url.pathname.endsWith("/team")) {
        return jsonResponse(200, { data: { status: "not_published" } });
      }
      if (url.pathname === AGENDA_PATH) {
        const events = period === "past" ? past : upcoming;
        return jsonResponse(200, { data: { events, nextCursor: null } });
      }
      const rsvpOf = all.find((event) => url.pathname === rsvpPath(event));
      if (rsvpOf !== undefined && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          response: RsvpResponse;
        };
        const outcome = await onSave(rsvpOf, body.response);
        if (outcome.ok) {
          savedResponses.set(rsvpOf.id, body.response);
        }
        return outcome;
      }
      const opened = all.find(
        (event) => url.pathname === `${AGENDA_PATH}/${event.id}`,
      );
      if (opened !== undefined) {
        return jsonResponse(200, { data: detailOf(saved(opened)) });
      }
      throw new Error(`Petición inesperada: ${method} ${url.pathname}`);
    }),
  );
}

function stubPhone(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderAgenda(
  options: {
    readonly locale?: "en" | "es";
    readonly canRespond?: boolean;
  } = {},
): void {
  render(
    <AgendaScreen
      locale={options.locale ?? "en"}
      canManageEvents={false}
      canTakeAttendance={false}
      canRespond={options.canRespond ?? true}
    />,
  );
}

async function findRow(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 3, name: title });
  const row = heading.closest("li");
  if (row === null) {
    throw new Error(`La fila de ${title} no es un elemento de la lista.`);
  }
  return row;
}

function rowGroup(row: HTMLElement, title: string): HTMLElement {
  return within(row).getByRole("group", {
    name: `Are you going to ${title}?`,
  });
}

function choice(container: HTMLElement, name: string): HTMLElement {
  return within(container).getByRole("button", { name });
}

function rowToggle(row: HTMLElement, title: string): HTMLElement {
  return within(row).getByRole("button", { name: title });
}

async function findPanel(title: string): Promise<HTMLElement> {
  return screen.findByRole("complementary", { name: title });
}

function rsvpRequests(event: AgendaEvent): Request[] {
  return requests.filter(
    (request) =>
      request.method === "PUT" && request.pathname === rsvpPath(event),
  );
}

function expectPressed(container: HTMLElement, pressed: string | null): void {
  for (const name of CHOICES) {
    expect(choice(container, name)).toHaveAttribute(
      "aria-pressed",
      String(name === pressed),
    );
  }
}

afterEach(() => {
  requests.length = 0;
  savedResponses.clear();
  vi.unstubAllGlobals();
});

describe("RSVP en la fila de escritorio", () => {
  it("pone tres botones en lugar de la píldora y debajo cuántos van", async () => {
    stubApi({ upcoming: [POOL_TRAINING, SCRIMMAGE] });

    renderAgenda();

    const answered = await findRow(POOL_TRAINING.title);
    const group = rowGroup(answered, POOL_TRAINING.title);
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([...CHOICES]);
    expect(answered.querySelector(".agenda-answer-pill")).toBeNull();
    expect(within(answered).getByText("14 going")).toBeInTheDocument();
    const unanswered = await findRow(SCRIMMAGE.title);
    expect(within(unanswered).queryByText("RSVP")).not.toBeInTheDocument();
    expect(within(unanswered).getByText("18 going")).toBeInTheDocument();
  });

  it("nombra el grupo con el evento y marca la elegida con el color de su respuesta", async () => {
    stubApi({ upcoming: [{ ...POOL_TRAINING, myResponse: "maybe" }] });

    renderAgenda();

    const group = rowGroup(
      await findRow(POOL_TRAINING.title),
      POOL_TRAINING.title,
    );
    expectPressed(group, "Maybe");
    expect(choice(group, "Maybe")).toHaveClass("agenda-rsvp-choice-maybe");
  });

  it("nombra el grupo y los botones en español", async () => {
    stubApi({ upcoming: [POOL_TRAINING] });

    renderAgenda({ locale: "es" });

    const row = await findRow(POOL_TRAINING.title);
    const group = within(row).getByRole("group", {
      name: "¿Vas a Pool Training?",
    });
    expect(choice(group, "Voy")).toHaveAttribute("aria-pressed", "true");
    expect(choice(group, "Quizás")).toBeInTheDocument();
    expect(choice(group, "No puedo")).toBeInTheDocument();
  });

  it("guarda sin elegir el evento: el panel sigue en el suyo y el foco en el botón", async () => {
    stubApi({ upcoming: [POOL_TRAINING, SCRIMMAGE] });
    renderAgenda();
    await findPanel(POOL_TRAINING.title);
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(choice(row, "Maybe"));

    await waitFor(() =>
      expect(choice(row, "Maybe")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
    expect(rowToggle(row, SCRIMMAGE.title)).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("complementary", { name: POOL_TRAINING.title }),
    ).toBeInTheDocument();
    expect(choice(row, "Maybe")).toHaveFocus();
  });

  it("lo guardado desde la fila sale igual en el panel abierto, con los mismos conteos", async () => {
    let hasSaved = false;
    stubApi({
      upcoming: [POOL_TRAINING],
      onSave: (event, response) => {
        hasSaved = true;
        return savedResponse(event.id, response);
      },
      saved: (event) =>
        hasSaved
          ? { ...event, myResponse: "no", goingCount: 13, maybeCount: 2 }
          : event,
    });
    renderAgenda();
    const panel = await findPanel(POOL_TRAINING.title);
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(choice(row, "Can't go"));

    await waitFor(() => expectPressed(row, "Can't go"));
    expectPressed(
      within(panel).getByRole("group", { name: /^RSVP:/ }),
      "Can't go",
    );
    expect(within(row).getByText("13 going")).toBeInTheDocument();
    expect(within(panel).getByText("Going · 13")).toBeInTheDocument();
  });

  it("lo guardado desde el panel lo marcan también los botones de la fila", async () => {
    stubApi({ upcoming: [SCRIMMAGE] });
    renderAgenda();
    const panel = await findPanel(SCRIMMAGE.title);
    const row = await findRow(SCRIMMAGE.title);
    const panelGroup = within(panel).getByRole("group", { name: /^RSVP:/ });

    await userEvent.click(choice(panelGroup, "Going"));

    await waitFor(() => expectPressed(row, "Going"));
  });

  it("mientras guarda, otro toque no hace nada y nada se marca antes de que confirme", async () => {
    let finishSaving: (response: Response) => void = () => undefined;
    stubApi({
      upcoming: [SCRIMMAGE],
      onSave: () =>
        new Promise<Response>((resolve) => {
          finishSaving = resolve;
        }),
    });
    renderAgenda();
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(choice(row, "Going"));
    await userEvent.click(choice(row, "Can't go"));

    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
    expectPressed(row, null);
    finishSaving(savedResponse(SCRIMMAGE.id, "yes"));
    await waitFor(() => expectPressed(row, "Going"));
    expect(rsvpRequests(SCRIMMAGE)).toHaveLength(1);
  });

  it("si falla lo dice bajo los botones y deja marcada la respuesta de antes", async () => {
    stubApi({ upcoming: [POOL_TRAINING], onSave: () => startedResponse() });
    renderAgenda();
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(choice(row, "Can't go"));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "This event has already started, so you can't answer anymore.",
    );
    expectPressed(row, "Going");
    expect(within(row).getByText("14 going")).toBeInTheDocument();
  });

  it("un fallo de la fila no se anuncia otra vez en el panel", async () => {
    stubApi({ upcoming: [POOL_TRAINING], onSave: () => startedResponse() });
    renderAgenda();
    const panel = await findPanel(POOL_TRAINING.title);
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(choice(row, "Can't go"));

    await within(row).findByRole("alert");
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un fallo del panel no se anuncia en la fila", async () => {
    stubApi({ upcoming: [POOL_TRAINING], onSave: () => startedResponse() });
    renderAgenda();
    const panel = await findPanel(POOL_TRAINING.title);
    const row = await findRow(POOL_TRAINING.title);
    const panelGroup = within(panel).getByRole("group", { name: /^RSVP:/ });

    await userEvent.click(choice(panelGroup, "Can't go"));

    await within(panel).findByRole("alert");
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dice el fallo de la fila en español", async () => {
    stubApi({ upcoming: [POOL_TRAINING], onSave: () => startedResponse() });
    renderAgenda({ locale: "es" });
    const row = await findRow(POOL_TRAINING.title);

    await userEvent.click(choice(row, "No puedo"));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Este evento ya empezó: ya no se puede responder.",
    );
  });

  it("a un cancelado no le pone botones y deja su píldora", async () => {
    stubApi({ upcoming: [CANCELLED_SOCIAL] });

    renderAgenda();

    const row = await findRow(CANCELLED_SOCIAL.title);
    expect(within(row).queryByRole("group")).toBeNull();
    expect(
      within(row).getByText("Maybe", { selector: ".agenda-answer-pill" }),
    ).toBeInTheDocument();
  });

  it("a un evento fuera de mi audiencia no le pone botones", async () => {
    stubApi({ upcoming: [COMMITTEE_ONLY] });

    renderAgenda();

    const row = await findRow(COMMITTEE_ONLY.title);
    expect(within(row).queryByRole("group")).toBeNull();
    expect(within(row).getByText("18 going")).toBeInTheDocument();
  });

  it("a un pasado no le pone botones y deja su píldora", async () => {
    stubApi({ upcoming: [POOL_TRAINING], past: [PAST_MATCH] });
    renderAgenda();
    await findRow(POOL_TRAINING.title);

    await userEvent.click(screen.getByRole("button", { name: "Past" }));

    const row = await findRow(PAST_MATCH.title);
    expect(within(row).queryByRole("group")).toBeNull();
    expect(
      within(row).getByText("Can't go", { selector: ".agenda-answer-pill" }),
    ).toBeInTheDocument();
  });

  it("sin la membresía al día los botones salen desactivados y el grupo dice por qué", async () => {
    stubApi({ upcoming: [POOL_TRAINING] });
    renderAgenda({ canRespond: false });
    const row = await findRow(POOL_TRAINING.title);
    const group = rowGroup(row, POOL_TRAINING.title);

    await userEvent.click(choice(group, "Maybe"));

    for (const name of CHOICES) {
      expect(choice(group, name)).toBeDisabled();
    }
    expect(group).toHaveAccessibleDescription(
      /Your membership isn't up to date/,
    );
    expect(rsvpRequests(POOL_TRAINING)).toEqual([]);
  });

  it("el título de la fila sigue eligiendo el evento", async () => {
    stubApi({ upcoming: [POOL_TRAINING, SCRIMMAGE] });
    renderAgenda();
    const row = await findRow(SCRIMMAGE.title);

    await userEvent.click(rowToggle(row, SCRIMMAGE.title));

    expect(await findPanel(SCRIMMAGE.title)).toBeInTheDocument();
  });
});

describe("RSVP en la tarjeta del móvil", () => {
  it("no pone botones: la tarjeta sigue igual", async () => {
    stubPhone();
    stubApi({ upcoming: [POOL_TRAINING, SCRIMMAGE] });

    renderAgenda();

    const answered = await findRow(POOL_TRAINING.title);
    expect(within(answered).queryByRole("group")).toBeNull();
    expect(
      within(answered).getByText("Going", {
        selector: ".agenda-answer-pill",
      }),
    ).toBeInTheDocument();
    const unanswered = await findRow(SCRIMMAGE.title);
    expect(within(unanswered).queryByRole("group")).toBeNull();
  });
});
