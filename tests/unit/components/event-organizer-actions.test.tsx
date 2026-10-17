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
  endTime: "12:00",
  endsOn: null,
  title: "Scrimmage vs Geelong Krakens",
  eventType: "competition",
  location: "Geelong Aquatic Centre",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: null,
  goingCount: 3,
  maybeCount: 1,
  myResponse: null,
  inAudience: true,
  coverThumbUrl: null,
};

const TRAINING_OCCURRENCE: AgendaEvent = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  startsOn: "2026-10-06",
  startTime: "19:00",
  endTime: "20:30",
  endsOn: null,
  title: "Pool Training",
  eventType: "training",
  location: "MSAC Dive Pool",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: SERIES_ID,
  goingCount: 1,
  maybeCount: 0,
  myResponse: "yes",
  inAudience: true,
  coverThumbUrl: null,
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
  coverUrl: null,
  series: null,
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

function sessionNotInSeries(): Response {
  return jsonResponse(409, {
    error: {
      code: "conflict",
      message: "La sesión no es de la serie.",
      reason: "session_not_in_series",
    },
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
    // La grande no hace falta distinguirla de la miniatura aquí.
    coverUrl: event.coverThumbUrl,
    series:
      event.seriesId === null
        ? null
        : { weekdays: [2], endsOn: "2026-12-15", sessionsLeft: 10 },
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

/** El aviso de la agenda; el panel del evento tiene los suyos (¿Vas? y
 * copiar la dirección). */
function agendaNotice(): HTMLElement {
  const notice = screen
    .getAllByRole("status")
    .find(
      (region) =>
        region.closest("li") === null && region.closest("aside") === null,
    );
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

function eventList(): HTMLElement {
  return screen.getByRole("list", { name: "Upcoming events" });
}

/** Elige la fila si no lo está ya: la primera se elige sola al cargar. */
async function selectRow(row: HTMLElement, title: string): Promise<void> {
  const button = within(row).getByRole("button", { name: title });
  if (button.getAttribute("aria-current") !== "true") {
    await userEvent.click(button);
  }
}

/** El panel del evento con su detalle ya llegado: los que van sólo se pintan
 * con el detalle, en inglés y en español. */
async function findLoadedPanel(title: string): Promise<HTMLElement> {
  const panel = await screen.findByRole("complementary", { name: title });
  await within(panel).findByRole("heading", {
    level: 3,
    name: /^(Going|Van) · \d+$/,
  });
  return panel;
}

/** Elige la fila del evento y devuelve su panel con el detalle llegado. */
async function openPanel(title: string): Promise<HTMLElement> {
  await selectRow(await findRow(title), title);
  return findLoadedPanel(title);
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
  const panel = await openPanel(title);
  await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
  return openDialogNamed(dialogName);
}

async function openDialogNamed(name: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog", { name });
  await within(dialog).findByRole("radio", { name: "The whole club" });
  return dialog;
}

async function chooseEditScope(
  panel: HTMLElement,
  scope: "This session only" | "This and all following sessions",
): Promise<void> {
  await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
  await userEvent.click(within(panel).getByRole("button", { name: scope }));
}

async function chooseCancelScope(
  panel: HTMLElement,
  scope: "Only this one" | "The whole series from today on",
): Promise<void> {
  await userEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
  await userEvent.click(within(panel).getByRole("button", { name: scope }));
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
  it("un Admin o un Committee ve Editar y Cancelar al elegir un evento futuro", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();

    const panel = await openPanel(SCRIMMAGE.title);

    expect(
      within(panel).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("no las ve quien no organiza eventos", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda({ canManage: false });

    const panel = await openPanel(SCRIMMAGE.title);

    expect(
      within(panel).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("no las ofrece en un evento cancelado", async () => {
    stubApi({ events: [CANCELLED_SOCIAL] });
    renderAgenda();

    const panel = await openPanel(CANCELLED_SOCIAL.title);

    expect(
      within(panel).queryByRole("button", { name: "Edit" }),
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

    const panel = await openPanel(SCRIMMAGE.title);

    expect(
      within(panel).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("se llaman Editar y Cancelar en español", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda({ locale: "es" });

    const panel = await openPanel(SCRIMMAGE.title);

    expect(
      within(panel).getByRole("button", { name: "Editar" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
  });
});

describe("editar desde el calendario", () => {
  it("abre el diálogo de crear con los datos del evento y sin la repetición", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();

    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    expect(within(dialog).getByLabelText("Title")).toHaveValue(SCRIMMAGE.title);
    expect(
      within(dialog).getByRole("radio", { name: "Competition" }),
    ).toBeChecked();
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-10");
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("10:00");
    expect(within(dialog).getByLabelText("Ends")).toHaveValue("12:00");
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
      await within(row).findByRole("link", { name: /^MSAC Dive Pool/ }),
    ).toBeInTheDocument();
    expect(within(row).getByText("10:00 am")).toBeInTheDocument();
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

  it("en una sesión de una serie pregunta qué editar encima de las acciones, con la fecha, y enfoca la primera opción", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    const edit = within(panel).getByRole("button", { name: "Edit" });

    await userEvent.click(edit);

    const chooser = within(panel).getByRole("group", {
      name: "This event repeats. What do you want to edit?",
    });
    const sessionOnly = within(chooser).getByRole("button", {
      name: "This session only",
    });
    expect(sessionOnly).toHaveAccessibleDescription(
      "Changes only Tuesday, October 6. The rest stay the same.",
    );
    expect(
      within(chooser).getByRole("button", {
        name: "This and all following sessions",
      }),
    ).toBeInTheDocument();
    expect(
      within(chooser).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(sessionOnly).toHaveFocus();
    expect(
      chooser.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pregunta qué editar en español", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda({ locale: "es" });
    const panel = await openPanel(TRAINING_OCCURRENCE.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Editar" }),
    );

    const chooser = within(panel).getByRole("group", {
      name: "Este evento se repite. ¿Qué quieres editar?",
    });
    expect(
      within(chooser).getByRole("button", { name: "Solo esta sesión" }),
    ).toHaveAccessibleDescription(
      "Cambia solo el martes, 6 de octubre. Las demás quedan igual.",
    );
    expect(
      within(chooser).getByRole("button", { name: "Esta y las siguientes" }),
    ).toBeInTheDocument();
    expect(
      within(chooser).getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
  });

  it("con Cancelar cierra el selector y devuelve el foco a Editar", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const chooser = within(panel).getByRole("group", {
      name: "This event repeats. What do you want to edit?",
    });

    await userEvent.click(
      within(chooser).getByRole("button", { name: "Cancel" }),
    );

    expect(chooser).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("con Escape cierra el selector y devuelve el foco a Editar", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const chooser = within(panel).getByRole("group", {
      name: "This event repeats. What do you want to edit?",
    });

    await userEvent.keyboard("{Escape}");

    expect(chooser).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("con Solo esta sesión edita la sesión como un evento suelto", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => managedEvent(TRAINING_OCCURRENCE, { startTime: "19:30" }),
    });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await chooseEditScope(panel, "This session only");
    const dialog = await openDialogNamed("Edit event");

    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-06");
    expect(
      within(dialog).queryByRole("group", { name: "Repeats on" }),
    ).not.toBeInTheDocument();
    setValue(dialog, "Starts", "19:30");
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

  it("con Esta y las siguientes abre la serie con los valores de la sesión, los días y Hasta", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);

    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");

    expect(within(dialog).queryByLabelText("Date")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      TRAINING_OCCURRENCE.title,
    );
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("19:00");
    // Los días son botones con aria-pressed desde #651.
    const days = within(dialog).getByRole("group", { name: "On these days" });
    expect(
      within(days).getByRole("button", { name: "Tuesday" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(days).getByRole("button", { name: "Thursday" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).getByLabelText("Until")).toHaveValue("2026-12-15");
  });

  it("con Esta y las siguientes advierte que pisa lo editado en las sesiones sueltas", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);

    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");

    expect(
      within(dialog).getByText(
        "These changes apply to this session and every one after it, also to the ones that were edited on their own.",
      ),
    ).toBeInTheDocument();
  });

  it("con Esta y las siguientes guarda desde la sesión con los días y Hasta nuevos", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => editedSeries(8),
    });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");

    setValue(dialog, "Starts", "19:30");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Thursday" }),
    );
    setValue(dialog, "Until", "2026-11-30");
    await save(dialog);

    await waitFor(() => {
      expect(agendaNotice()).toHaveTextContent("Changes saved to 8 sessions.");
    });
    expect(manageCalls()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        pathname: `${MANAGE_PATH}/series/${SERIES_ID}`,
        body: {
          fromOccurrenceId: TRAINING_OCCURRENCE.id,
          startTime: "19:30",
          weekdays: [2, 4],
          endsOn: "2026-11-30",
        },
      }),
    ]);
  });

  it("con Esta y las siguientes no manda los días ni Hasta si no cambiaron", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => editedSeries(8),
    });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");

    setValue(dialog, "Title", "Pool Session");
    await save(dialog);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    expect(manageCalls()[0]?.body).toEqual({
      fromOccurrenceId: TRAINING_OCCURRENCE.id,
      title: "Pool Session",
    });
  });

  it("si otra edición partió la serie, lo dice y ofrece recargar", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => sessionNotInSeries(),
    });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");
    setValue(dialog, "Starts", "19:30");
    await save(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This series changed while you were editing it. Reload to see the current version.",
    );
    const agendaLoadsBefore = agendaCalls().length;

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Reload" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(agendaCalls().length).toBeGreaterThan(agendaLoadsBefore);
    });
  });

  it("si otra edición partió la serie, lo dice en español", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => sessionNotInSeries(),
    });
    renderAgenda({ locale: "es" });
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Editar" }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: "Esta y las siguientes" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Editar serie" });
    await within(dialog).findByRole("radio", { name: "Todo el club" });
    setValue(dialog, "Empieza", "20:00");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Guardar cambios" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Esta serie cambió mientras la editabas. Recarga para ver la versión actual.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Recargar" }),
    ).toBeInTheDocument();
  });

  it("si la sesión empezó mientras tanto, lo dice y refresca la agenda", async () => {
    stubApi({
      events: [TRAINING_OCCURRENCE],
      respond: () => businessRule("occurrence_started"),
    });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");
    setValue(dialog, "Starts", "19:30");
    await save(dialog);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This session has already started, so it can't be changed anymore.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Editar" }),
    );
    await userEvent.click(
      within(panel).getByRole("button", {
        name: "Esta y las siguientes",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Editar serie" });
    await within(dialog).findByRole("radio", { name: "Todo el club" });

    setValue(dialog, "Empieza", "20:00");
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
    const panel = await openPanel(SCRIMMAGE.title);

    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );

    expect(
      within(panel).getByText(
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
    const panel = await openPanel(SCRIMMAGE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );

    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel event" }),
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
    const panel = await openPanel(SCRIMMAGE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );

    await userEvent.click(
      within(panel).getByRole("button", { name: "Keep it" }),
    );

    expect(
      within(panel).queryByRole("button", { name: "Cancel event" }),
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
    await screen.findAllByRole("heading", {
      level: 3,
      name: TRAINING_OCCURRENCE.title,
    });
    const [row] = within(eventList()).getAllByRole("listitem");
    if (row === undefined) {
      throw new Error("La agenda no pintó ninguna fila.");
    }
    await selectRow(row, TRAINING_OCCURRENCE.title);
    const panel = await findLoadedPanel(TRAINING_OCCURRENCE.title);
    await chooseCancelScope(panel, "The whole series from today on");

    expect(
      within(panel).getByText(
        "Every session from today on will be cancelled. 1 person said they're going to this one.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel series" }),
    );

    await waitFor(() => {
      expect(within(eventList()).getAllByText("Cancelled")).toHaveLength(2);
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
    const panel = await openPanel(TRAINING_OCCURRENCE.title);
    await chooseCancelScope(panel, "Only this one");

    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel event" }),
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
    const panel = await openPanel(SCRIMMAGE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );
    const confirm = within(panel).getByRole("button", { name: "Cancel event" });

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
    const panel = await openPanel(SCRIMMAGE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel event" }),
    );

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel event" }),
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
    const panel = await openPanel(SCRIMMAGE.title);
    const agendaLoadsBefore = agendaCalls().length;
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );

    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel event" }),
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
    const panel = await openPanel(SCRIMMAGE.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel" }),
    );

    await userEvent.click(
      within(panel).getByRole("button", { name: "Cancel event" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This event no longer exists.",
    );
  });
});

describe("el fin y la imagen al editar (#650)", () => {
  const BEFORE_E24: AgendaEvent = {
    ...SCRIMMAGE,
    id: "eeeeeeee-0000-4000-8000-00000000000e",
    title: "Committee Meeting",
    eventType: "meeting",
    endTime: null,
  };
  const WITH_COVER: AgendaEvent = {
    ...SCRIMMAGE,
    id: "ffffffff-0000-4000-8000-00000000000f",
    title: "Gala Night",
    eventType: "social",
    coverThumbUrl: "https://storage.example/gala.webp",
  };

  it("en un evento anterior a E24 deja Termina vacío, explica por qué y no deja guardar", async () => {
    stubApi({ events: [BEFORE_E24] });
    renderAgenda();

    const dialog = await openEditDialog(BEFORE_E24.title, "Edit event");

    const ends = within(dialog).getByLabelText("Ends");
    expect(ends).toHaveValue("");
    expect(ends).toHaveAccessibleDescription(
      "Events now need an end time. Add one to save.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
  });

  it("al llenar Termina en un evento anterior a E24 deja guardar y la manda", async () => {
    stubApi({
      events: [BEFORE_E24],
      respond: () => managedEvent(BEFORE_E24, { endTime: "11:30" }),
    });
    renderAgenda();
    const dialog = await openEditDialog(BEFORE_E24.title, "Edit event");

    setValue(dialog, "Ends", "11:30");
    await save(dialog);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    expect(manageCalls()[0]?.body).toEqual({ endTime: "11:30" });
  });

  it("en un evento anterior a E24 lo dice en español", async () => {
    stubApi({ events: [BEFORE_E24] });
    renderAgenda({ locale: "es" });
    const panel = await openPanel(BEFORE_E24.title);
    await userEvent.click(
      within(panel).getByRole("button", { name: "Editar" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Editar evento" });
    await within(dialog).findByRole("radio", { name: "Todo el club" });

    expect(
      within(dialog).getByLabelText("Termina"),
    ).toHaveAccessibleDescription(
      "Ahora los eventos necesitan hora de fin. Añádela para guardar.",
    );
  });

  it("enseña la imagen que tiene el evento y quitarla manda ninguna", async () => {
    stubApi({
      events: [WITH_COVER],
      respond: () => managedEvent(WITH_COVER, {}),
    });
    renderAgenda();
    const dialog = await openEditDialog(WITH_COVER.title, "Edit event");

    expect(
      within(dialog).getByRole("img", { name: "The event image" }),
    ).toHaveAttribute("src", WITH_COVER.coverThumbUrl);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove image" }),
    );
    await save(dialog);

    await waitFor(() => {
      expect(manageCalls()).toHaveLength(1);
    });
    expect(manageCalls()[0]?.body).toEqual({ coverUploadId: null });
  });

  it("en toda la serie no ofrece Termina otro día", async () => {
    stubApi({ events: [TRAINING_OCCURRENCE] });
    renderAgenda();
    const panel = await openPanel(TRAINING_OCCURRENCE.title);

    await chooseEditScope(panel, "This and all following sessions");
    const dialog = await openDialogNamed("Edit series");

    expect(within(dialog).getByLabelText("Ends")).toHaveValue("20:30");
    expect(
      within(dialog).queryByRole("switch", { name: "Ends on another day" }),
    ).not.toBeInTheDocument();
  });

  it("en un evento suelto ofrece Termina otro día", async () => {
    stubApi({ events: [SCRIMMAGE] });
    renderAgenda();

    const dialog = await openEditDialog(SCRIMMAGE.title, "Edit event");

    expect(
      within(dialog).getByRole("switch", { name: "Ends on another day" }),
    ).not.toBeChecked();
  });
});

describe("quitar una imagen que el servidor rechazó (#650)", () => {
  it("se lleva también su aviso", async () => {
    const withCover: AgendaEvent = {
      ...SCRIMMAGE,
      id: "abababab-0000-4000-8000-0000000000ab",
      coverThumbUrl: "https://storage.example/scrimmage.webp",
    };
    stubApi({
      events: [withCover],
      respond: () => businessRule("event_cover_upload_invalid"),
    });
    renderAgenda();
    const dialog = await openEditDialog(withCover.title, "Edit event");
    setValue(dialog, "Title", "Scrimmage");
    await save(dialog);
    const image = within(dialog).getByRole("group", {
      name: "Image · optional",
    });
    await waitFor(() =>
      expect(image).toHaveAccessibleDescription(
        "That image is no longer available. Choose it again.",
      ),
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove image" }),
    );

    expect(image).toHaveAccessibleDescription("");
  });
});
