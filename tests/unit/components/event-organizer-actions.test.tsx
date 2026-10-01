import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaScreen } from "@/components/calendar/AgendaScreen";
import type {
  AgendaEvent,
  OrganizerEventDetail,
} from "@/lib/events/event-agenda";

/**
 * Editar y cancelar eventos y series desde el Calendario (#316, RF-11 y RF-12
 * del PRD de E7). Qué se puede cambiar y a quién se avisa lo decide el
 * servidor (#314, #315, #317): aquí se prueba que la fila ofrece las acciones
 * a quien organiza, que el diálogo de crear se reutiliza con los datos del
 * evento y manda sólo lo que cambió, y que un fallo no tira lo escrito.
 */

const AGENDA_PATH = "/api/v1/events";
const GROUPS_PATH = "/api/v1/groups";
const MANAGE_PATH = "/api/v1/events/manage";

const SENIOR = {
  id: "9a9a9a9a-0000-4000-8000-000000000009",
  name: "Senior Squad",
  memberCount: 12,
};
const MASTERS = {
  id: "8b8b8b8b-0000-4000-8000-000000000008",
  name: "Masters",
  memberCount: 7,
};

const SERIES_ID = "cccccccc-0000-4000-8000-00000000000c";

const SCRIMMAGE: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-10-10",
  startTime: "10:00",
  title: "Scrimmage vs Geelong Krakens",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  status: "scheduled",
  seriesId: null,
  goingCount: 3,
  maybeCount: 1,
  myResponse: null,
  inAudience: true,
};

const TRAINING_OCCURRENCE: AgendaEvent = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-10-06",
  startTime: "19:00",
  title: "Pool Training",
  eventType: "training",
  location: "MSAC Dive Pool",
  status: "scheduled",
  seriesId: SERIES_ID,
  goingCount: 1,
  maybeCount: 0,
  myResponse: "yes",
  inAudience: true,
};

const CANCELLED_SOCIAL: AgendaEvent = {
  ...SCRIMMAGE,
  id: "dddddddd-0000-4000-8000-00000000000d",
  title: "End-of-Season Social",
  eventType: "social",
  status: "cancelled",
};

const SCRIMMAGE_DETAIL: OrganizerEventDetail = {
  ...SCRIMMAGE,
  notes: "Bring both caps",
  going: ["Ana Pérez", "Liam Chen", "Mia Rossi"],
  maybe: ["Noah Park"],
  audience: { kind: "groups", groups: [{ id: SENIOR.id, name: SENIOR.name }] },
};

type Call = {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly body: unknown;
};

type Responder = (call: Call) => Response | Promise<Response>;

const calls: Call[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function businessRule(reason: string): Response {
  return jsonResponse(422, {
    error: { code: "business_rule", message: "No se puede.", reason },
  });
}

function notFound(): Response {
  return jsonResponse(404, {
    error: { code: "not_found", message: "El evento no existe." },
  });
}

function detailOf(event: AgendaEvent): OrganizerEventDetail {
  if (event.id === SCRIMMAGE.id) {
    return SCRIMMAGE_DETAIL;
  }
  return {
    ...event,
    notes: null,
    going: ["Ana Pérez"],
    maybe: [],
    audience: { kind: "club" },
  };
}

function managedEvent(event: AgendaEvent, changes: object): Response {
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
      status: "scheduled",
      ...changes,
    },
  });
}

function editedSeries(updatedOccurrences: number): Response {
  return jsonResponse(200, {
    data: {
      series: {
        id: SERIES_ID,
        title: "Pool Training",
        eventType: "training",
        startTime: "19:30",
        location: "MSAC Dive Pool",
        notes: null,
        audience: { kind: "club" },
        weekdays: [2],
        startsOn: "2026-09-01",
        endsOn: "2026-12-15",
      },
      updatedOccurrences,
    },
  });
}

function cancelledSeries(cancelledOccurrences: number): Response {
  return jsonResponse(200, {
    data: {
      seriesId: SERIES_ID,
      cancelledAt: "2026-10-01T08:00:00.000Z",
      cancelledOccurrences,
    },
  });
}

/** Lo que responde la API a cada acción de quien organiza. La agenda sirve
 * `events` hasta que una acción sale bien, y `eventsAfter` desde entonces. */
function stubApi(options: {
  readonly events: readonly AgendaEvent[];
  readonly eventsAfter?: readonly AgendaEvent[];
  readonly respond?: Responder;
}): void {
  const { events, eventsAfter = events, respond } = options;
  let hasChanged = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const call = { method, pathname: url.pathname, search: url.search, body };
      calls.push(call);
      if (url.pathname === AGENDA_PATH) {
        const served = hasChanged ? eventsAfter : events;
        const period = url.searchParams.get("period");
        return jsonResponse(200, {
          data: { events: period === "past" ? [] : served, nextCursor: null },
        });
      }
      if (url.pathname === GROUPS_PATH) {
        return jsonResponse(200, { data: { groups: [SENIOR, MASTERS] } });
      }
      if (url.pathname.startsWith(MANAGE_PATH)) {
        if (respond === undefined) {
          throw new Error(`Petición inesperada: ${method} ${url.pathname}`);
        }
        const response = await respond(call);
        hasChanged = hasChanged || response.ok;
        return response;
      }
      const opened = [...events, ...eventsAfter].find(
        (event) => url.pathname === `${AGENDA_PATH}/${event.id}`,
      );
      if (opened !== undefined && method === "GET") {
        return jsonResponse(200, { data: detailOf(opened) });
      }
      // Los equipos del evento (#403): aquí nunca hay reparto publicado.
      if (url.pathname.endsWith("/team") && method === "GET") {
        return jsonResponse(200, { data: { status: "not_published" } });
      }
      throw new Error(`Petición inesperada: ${method} ${url.pathname}`);
    }),
  );
}

/** El aviso de la agenda; cada fila que admite respuesta tiene el suyo. */
function agendaNotice(): HTMLElement {
  const notice = screen
    .getAllByRole("status")
    .find((region) => region.closest("li") === null);
  if (notice === undefined) {
    throw new Error("La agenda no tiene su región de avisos.");
  }
  return notice;
}

function manageCalls(): Call[] {
  return calls.filter((call) => call.pathname.startsWith(MANAGE_PATH));
}

function agendaCalls(): Call[] {
  return calls.filter(
    (call) => call.pathname === AGENDA_PATH && call.search === "",
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

/** Despliega la fila y espera a que su detalle llegue. */
async function expandRow(title: string): Promise<HTMLElement> {
  const row = await findRow(title);
  await userEvent.click(within(row).getByRole("button", { name: title }));
  await within(row).findByText("Notes");
  return row;
}

function renderAgenda(
  options: { readonly canManage?: boolean; readonly locale?: "en" | "es" } = {},
): void {
  const { canManage = true, locale = "en" } = options;
  render(
    <AgendaScreen
      locale={locale}
      canManageEvents={canManage}
      canTakeAttendance={false}
      canRespond
    />,
  );
}

async function openEditDialog(
  title: string,
  dialogName: string,
): Promise<HTMLElement> {
  const row = await expandRow(title);
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  return openDialogNamed(dialogName);
}

async function openDialogNamed(name: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog", { name });
  await within(dialog).findByRole("radio", { name: "The whole club" });
  return dialog;
}

async function chooseScope(
  row: HTMLElement,
  action: "Edit" | "Cancel",
  scope: "Only this one" | "The whole series from today on",
): Promise<void> {
  await userEvent.click(within(row).getByRole("button", { name: action }));
  await userEvent.click(within(row).getByRole("button", { name: scope }));
}

function setValue(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

async function save(dialog: HTMLElement): Promise<void> {
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save changes" }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("acciones del organizador", () => {
  it("un Admin o un Committee ve Editar y Cancelar al desplegar un evento futuro", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();

    const row = await expandRow(SCRIMMAGE.title);

    expect(
      within(row).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("no las ve quien no organiza eventos", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda({ canManage: false });

    const row = await expandRow(SCRIMMAGE.title);

    expect(
      within(row).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("no las ofrece en un evento cancelado", async () => {
    stubApi({ events: [CANCELLED_SOCIAL] });
    renderAgenda();

    const row = await expandRow(CANCELLED_SOCIAL.title);

    expect(
      within(row).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("no las ofrece en un evento pasado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://localhost");
        if (url.pathname === AGENDA_PATH) {
          const isPast = url.searchParams.get("period") === "past";
          return jsonResponse(200, {
            data: { events: isPast ? [SCRIMMAGE] : [], nextCursor: null },
          });
        }
        return jsonResponse(200, { data: detailOf(SCRIMMAGE) });
      }),
    );
    renderAgenda();
    await userEvent.click(await screen.findByRole("button", { name: "Past" }));

    const row = await expandRow(SCRIMMAGE.title);

    expect(
      within(row).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("se llaman Editar y Cancelar en español", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda({ locale: "es" });

    const row = await findRow(SCRIMMAGE.title);
    await userEvent.click(
      within(row).getByRole("button", { name: SCRIMMAGE.title }),
    );
    await within(row).findByText("Notas");

    expect(
      within(row).getByRole("button", { name: "Editar" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
  });
});

describe("editar desde el calendario", () => {
  it("abre el diálogo de crear con los datos del evento y sin la repetición", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();

    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    expect(within(dialog).getByLabelText("Title")).toHaveValue(SCRIMMAGE.title);
    expect(within(dialog).getByLabelText("Type")).toHaveValue("competition");
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-10");
    expect(within(dialog).getByLabelText("Time")).toHaveValue("10:00");
    expect(within(dialog).getByLabelText("Location")).toHaveValue(
      SCRIMMAGE.location,
    );
    expect(within(dialog).getByLabelText("Notes")).toHaveValue(
      "Bring both caps",
    );
    expect(
      within(dialog).getByRole("radio", { name: "Specific groups" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", { name: /Senior Squad/ }),
    ).toBeChecked();
    expect(
      within(dialog).queryByRole("radio", { name: "Weekly" }),
    ).not.toBeInTheDocument();
  });

  it("manda sólo lo que cambió de un evento suelto y la fila muestra lo nuevo", async () => {
    const moved = { ...SCRIMMAGE, location: "MSAC Dive Pool" };
    stubApi({
      events: [SCRIMMAGE],
      eventsAfter: [moved],
      respond: () => managedEvent(SCRIMMAGE, { location: moved.location }),
    });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    setValue(dialog, "Location", moved.location);
    await save(dialog);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(manageCalls()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        pathname: `${MANAGE_PATH}/${SCRIMMAGE.id}`,
        body: { location: moved.location },
      }),
    ]);
    const row = await findRow(SCRIMMAGE.title);
    expect(
      await within(row).findByText("10:00 am · MSAC Dive Pool"),
    ).toBeInTheDocument();
    expect(agendaNotice()).toHaveTextContent("Changes saved.");
  });

  it("manda la audiencia entera cuando cambia", async () => {
    stubApi({
      events: [SCRIMMAGE],
      respond: () => managedEvent(SCRIMMAGE, {}),
    });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: /Masters/ }),
    );
    await save(dialog);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    expect(manageCalls()[0]?.body).toEqual({
      audience: { kind: "groups", groupIds: [SENIOR.id, MASTERS.id] },
    });
  });

  it("cierra sin pedir nada si no cambió nada", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    await save(dialog);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(manageCalls()).toEqual([]);
  });

  it("en una ocurrencia pregunta si es solo esta o toda la serie", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const row = await expandRow(TRAINING_OCCURRENCE.title);

    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));

    expect(
      within(row).getByRole("button", { name: "Only this one" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", {
        name: "The whole series from today on",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con Solo esta edita la ocurrencia como un evento suelto", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => managedEvent(TRAINING_OCCURRENCE, { startTime: "19:30" }),
    });
    renderAgenda();
    const row = await expandRow(TRAINING_OCCURRENCE.title);
    await chooseScope(row, "Edit", "Only this one");
    const dialog = await openDialogNamed("Edit event");

    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-06");
    setValue(dialog, "Time", "19:30");
    await save(dialog);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    expect(manageCalls()[0]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        pathname: `${MANAGE_PATH}/${TRAINING_OCCURRENCE.id}`,
        body: { startTime: "19:30" },
      }),
    );
  });

  it("con Toda la serie no deja cambiar la fecha ni los días y advierte que pisa las editadas", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const row = await expandRow(TRAINING_OCCURRENCE.title);

    await chooseScope(row, "Edit", "The whole series from today on");
    const dialog = await openDialogNamed("Edit series");

    expect(within(dialog).queryByLabelText("Date")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Starts")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("group", { name: "Repeats on" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Time")).toHaveValue("19:00");
    expect(
      within(dialog).getByText(
        "These changes apply to every session from today on, including the ones that were edited on their own.",
      ),
    ).toBeInTheDocument();
  });

  it("con Toda la serie manda lo que cambió a la serie y dice cuántas sesiones cambiaron", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => editedSeries(8),
    });
    renderAgenda();
    const row = await expandRow(TRAINING_OCCURRENCE.title);
    await chooseScope(row, "Edit", "The whole series from today on");
    const dialog = await openDialogNamed("Edit series");

    setValue(dialog, "Time", "19:30");
    await save(dialog);

    await waitFor(() => {
      expect(agendaNotice()).toHaveTextContent("Changes saved to 8 sessions.");
    });
    expect(manageCalls()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        pathname: `${MANAGE_PATH}/series/${SERIES_ID}`,
        body: { startTime: "19:30" },
      }),
    ]);
  });

  it("pinta junto a su campo un motivo de la API sin borrar lo escrito", async () => {
    stubApi({
      events: [SCRIMMAGE],
      respond: () => businessRule("event_in_past"),
    });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    setValue(dialog, "Date", "2026-01-01");
    await save(dialog);

    expect(
      await within(dialog).findByText(
        "That date and time have already passed.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-01-01");
  });

  it("si el evento empezó mientras tanto, lo dice traducido y refresca la agenda", async () => {
    stubApi({
      events: [SCRIMMAGE],
      respond: () => businessRule("event_started"),
    });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");
    const agendaLoadsBefore = agendaCalls().length;

    setValue(dialog, "Title", "Scrimmage");
    await save(dialog);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This event has already started, so it can't be changed anymore.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(agendaCalls().length).toBeGreaterThan(agendaLoadsBefore);
    });
  });

  it("si la serie ya no tiene sesiones por delante, lo dice en español", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => businessRule("series_without_upcoming"),
    });
    renderAgenda({ locale: "es" });
    const row = await findRow(TRAINING_OCCURRENCE.title);
    await userEvent.click(
      within(row).getByRole("button", { name: TRAINING_OCCURRENCE.title }),
    );
    await within(row).findByText("Notas");
    await userEvent.click(within(row).getByRole("button", { name: "Editar" }));
    await userEvent.click(
      within(row).getByRole("button", {
        name: "Toda la serie de hoy en adelante",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Editar serie" });
    await within(dialog).findByRole("radio", { name: "Todo el club" });

    setValue(dialog, "Hora", "20:00");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Guardar cambios" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esta serie ya no tiene sesiones de hoy en adelante.",
    );
  });

  it("ante un fallo de red lo dice y deja reintentar sin perder lo escrito", async () => {
    let attempts = 0;
    stubApi({
      events: [SCRIMMAGE],
      respond: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return managedEvent(SCRIMMAGE, { title: "Scrimmage" });
      },
    });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    setValue(dialog, "Title", "Scrimmage");
    await save(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Scrimmage");

    await save(dialog);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(manageCalls()).toHaveLength(2);
  });

  it("no manda un segundo guardado mientras el primero sigue en curso", async () => {
    let release: (response: Response) => void = () => undefined;
    stubApi({
      events: [SCRIMMAGE],
      respond: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    renderAgenda();
    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");
    setValue(dialog, "Title", "Scrimmage");
    const saveButton = within(dialog).getByRole("button", {
      name: "Save changes",
    });

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    release(managedEvent(SCRIMMAGE, { title: "Scrimmage" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(manageCalls()).toHaveLength(1);
  });
});

describe("cancelar desde el calendario", () => {
  it("pide confirmación diciendo cuántos habían dicho que van", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);

    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    expect(
      within(row).getByText(
        "3 people said they're going. We'll let the audience know it's cancelled.",
      ),
    ).toBeInTheDocument();
    expect(manageCalls()).toEqual([]);
  });

  it("al confirmar cancela el evento y la fila queda marcada Cancelado", async () => {
    stubApi({
      events: [SCRIMMAGE],
      eventsAfter: [{ ...SCRIMMAGE, status: "cancelled" }],
      respond: () =>
        managedEvent(SCRIMMAGE, {
          status: "cancelled",
          cancelledAt: "2026-10-01T08:00:00.000Z",
        }),
    });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel event" }),
    );

    const refreshed = await findRow(SCRIMMAGE.title);
    expect(await within(refreshed).findByText("Cancelled")).toBeInTheDocument();
    expect(manageCalls()).toEqual([
      expect.objectContaining({
        method: "POST",
        pathname: `${MANAGE_PATH}/${SCRIMMAGE.id}/cancellation`,
      }),
    ]);
    expect(agendaNotice()).toHaveTextContent(
      "Event cancelled. We let the audience know.",
    );
  });

  it("deja volver atrás sin cancelar nada", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    await userEvent.click(within(row).getByRole("button", { name: "Keep it" }));

    expect(
      within(row).queryByRole("button", { name: "Cancel event" }),
    ).not.toBeInTheDocument();
    expect(manageCalls()).toEqual([]);
  });

  it("con Toda la serie cancela la serie y las filas quedan marcadas Cancelado", async () => {
    const nextWeek: AgendaEvent = {
      ...TRAINING_OCCURRENCE,
      id: "eeeeeeee-0000-4000-8000-00000000000e",
      startsOn: "2026-10-13",
    };
    stubApi({
      events: [TRAINING_OCCURRENCE, nextWeek],
      eventsAfter: [
        { ...TRAINING_OCCURRENCE, status: "cancelled" },
        { ...nextWeek, status: "cancelled" },
      ],
      respond: () => cancelledSeries(2),
    });
    renderAgenda();
    const [row] = await screen.findAllByRole("listitem");
    if (row === undefined) {
      throw new Error("La agenda no pintó ninguna fila.");
    }
    await userEvent.click(
      within(row).getByRole("button", { name: TRAINING_OCCURRENCE.title }),
    );
    await within(row).findByText("Notes");
    await chooseScope(row, "Cancel", "The whole series from today on");

    expect(
      within(row).getByText(
        "Every session from today on will be cancelled. 1 person said they're going to this one.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel series" }),
    );

    await waitFor(() => {
      expect(screen.getAllByText("Cancelled")).toHaveLength(2);
    });
    expect(manageCalls()).toEqual([
      expect.objectContaining({
        method: "POST",
        pathname: `${MANAGE_PATH}/series/${SERIES_ID}/cancellation`,
      }),
    ]);
    expect(agendaNotice()).toHaveTextContent(
      "Cancelled 2 sessions. We let the audience know.",
    );
  });

  it("con Solo esta cancela sólo la ocurrencia", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () =>
        managedEvent(TRAINING_OCCURRENCE, {
          status: "cancelled",
          cancelledAt: "2026-10-01T08:00:00.000Z",
        }),
    });
    renderAgenda();
    const row = await expandRow(TRAINING_OCCURRENCE.title);
    await chooseScope(row, "Cancel", "Only this one");

    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel event" }),
    );

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    expect(manageCalls()[0]?.pathname).toBe(
      `${MANAGE_PATH}/${TRAINING_OCCURRENCE.id}/cancellation`,
    );
  });

  it("no manda una segunda cancelación con la doble pulsación", async () => {
    let release: (response: Response) => void = () => undefined;
    stubApi({
      events: [SCRIMMAGE],
      respond: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    const confirm = within(row).getByRole("button", { name: "Cancel event" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    release(
      managedEvent(SCRIMMAGE, {
        status: "cancelled",
        cancelledAt: "2026-10-01T08:00:00.000Z",
      }),
    );
    await waitFor(() => {
      expect(agendaNotice()).toHaveTextContent("Event cancelled.");
    });
    expect(manageCalls()).toHaveLength(1);
  });

  it("ante un fallo de red lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubApi({
      events: [SCRIMMAGE],
      respond: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return managedEvent(SCRIMMAGE, {
          status: "cancelled",
          cancelledAt: "2026-10-01T08:00:00.000Z",
        });
      },
    });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel event" }),
    );

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel event" }),
    );

    await waitFor(() => {
      expect(agendaNotice()).toHaveTextContent("Event cancelled.");
    });
    expect(manageCalls()).toHaveLength(2);
  });

  it("si otro ya lo había cancelado, lo dice y refresca la agenda", async () => {
    stubApi({
      events: [SCRIMMAGE],
      respond: () => businessRule("event_cancelled"),
    });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);
    const agendaLoadsBefore = agendaCalls().length;
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel event" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This event was already cancelled.",
    );
    await waitFor(() => {
      expect(agendaCalls().length).toBeGreaterThan(agendaLoadsBefore);
    });
  });

  it("si el evento ya no existe, lo dice y refresca la agenda", async () => {
    stubApi({ events: [SCRIMMAGE], respond: notFound });
    renderAgenda();
    const row = await expandRow(SCRIMMAGE.title);
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    await userEvent.click(
      within(row).getByRole("button", { name: "Cancel event" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This event no longer exists.",
    );
  });
});
