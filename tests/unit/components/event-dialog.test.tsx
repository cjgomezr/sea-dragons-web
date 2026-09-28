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
import type { AgendaEvent } from "@/lib/events/event-agenda";

/**
 * El diálogo para crear eventos (#313, RF-9 del PRD de E7). Qué se guarda y
 * a quién se avisa lo decide el servidor (#307, #310): aquí se prueba que el
 * diálogo manda lo que se escribió, pinta cada error de la API junto a su
 * campo sin borrar nada y devuelve el foco a "+ Evento" al cerrar.
 */

const AGENDA_PATH = "/api/v1/events";
const CREATE_PATH = "/api/v1/events/manage";
const GROUPS_PATH = "/api/v1/groups";

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

const CREATED_EVENT: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  startsOn: "2026-10-06",
  startTime: "19:00",
  title: "Pool Training",
  eventType: "training",
  location: "MSAC Dive Pool",
  status: "scheduled",
  seriesId: null,
  goingCount: 0,
  maybeCount: 0,
  myResponse: null,
  inAudience: true,
};

type Call = {
  readonly method: string;
  readonly pathname: string;
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

function createdSingle(): Response {
  const { id, startsOn, title, eventType, startTime, location } = CREATED_EVENT;
  return jsonResponse(201, {
    data: {
      repeat: "none",
      event: {
        id,
        startsOn,
        title,
        eventType,
        startTime,
        location,
        notes: null,
        audience: { kind: "club" },
      },
    },
  });
}

function createdSeries(sessionCount: number): Response {
  const occurrences = Array.from({ length: sessionCount }, (_, index) => ({
    id: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`,
    startsOn: `2026-10-${String(index + 10).padStart(2, "0")}`,
  }));
  return jsonResponse(201, {
    data: {
      repeat: "weekly",
      series: {
        id: "cccccccc-0000-4000-8000-00000000000c",
        title: "Pool Training",
        eventType: "training",
        startTime: "19:00",
        location: "MSAC Dive Pool",
        notes: null,
        audience: { kind: "groups", groupIds: [SENIOR.id] },
        weekdays: [2, 4],
        startsOn: "2026-10-06",
        endsOn: "2026-10-29",
      },
      occurrences,
    },
  });
}

/** La agenda arranca vacía y, cuando ya se creó algo, trae lo creado. */
function stubApi(options: {
  readonly groups?: readonly (typeof SENIOR)[];
  readonly respondToCreate?: Responder;
  readonly agendaAfterCreate?: readonly AgendaEvent[];
}): void {
  const {
    groups = [SENIOR, MASTERS],
    respondToCreate = createdSingle,
    agendaAfterCreate = [CREATED_EVENT],
  } = options;
  let hasCreated = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const call = { method, pathname: url.pathname, body };
      calls.push(call);
      if (url.pathname === AGENDA_PATH) {
        return jsonResponse(200, {
          data: {
            events: hasCreated ? agendaAfterCreate : [],
            nextCursor: null,
          },
        });
      }
      if (url.pathname === GROUPS_PATH) {
        return jsonResponse(200, { data: { groups } });
      }
      if (url.pathname === CREATE_PATH && method === "POST") {
        const response = await respondToCreate(call);
        hasCreated = response.ok;
        return response;
      }
      throw new Error(`Petición inesperada: ${method} ${url.pathname}`);
    }),
  );
}

function createCalls(): Call[] {
  return calls.filter((call) => call.pathname === CREATE_PATH);
}

async function openDialog(): Promise<HTMLElement> {
  render(<AgendaScreen locale="en" canCreateEvents />);
  await userEvent.click(await screen.findByRole("button", { name: "Event" }));
  const dialog = await screen.findByRole("dialog", { name: "New event" });
  await within(dialog).findByRole("radio", { name: "The whole club" });
  return dialog;
}

function setValue(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

/** Lo mínimo de un evento suelto que el servidor aceptaría. */
function fillSingleEvent(dialog: HTMLElement): void {
  setValue(dialog, "Title", "Pool Training");
  setValue(dialog, "Date", "2026-10-06");
  setValue(dialog, "Time", "19:00");
  setValue(dialog, "Location", "MSAC Dive Pool");
}

async function chooseWeekly(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByRole("radio", { name: "Weekly" }));
}

async function fillWeeklySeries(dialog: HTMLElement): Promise<void> {
  setValue(dialog, "Title", "Pool Training");
  setValue(dialog, "Time", "19:00");
  setValue(dialog, "Location", "MSAC Dive Pool");
  await chooseWeekly(dialog);
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: "Tuesday" }),
  );
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: "Thursday" }),
  );
  setValue(dialog, "Starts", "2026-10-06");
  setValue(dialog, "Ends", "2026-10-29");
}

async function submit(dialog: HTMLElement): Promise<void> {
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create event" }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("botón + Evento", () => {
  it("lo pinta a quien puede crear eventos", async () => {
    stubApi({});

    render(<AgendaScreen locale="en" canCreateEvents />);

    expect(
      await screen.findByRole("button", { name: "Event" }),
    ).toBeInTheDocument();
  });

  it("no lo pinta a quien no puede crear eventos", async () => {
    stubApi({});

    render(<AgendaScreen locale="en" canCreateEvents={false} />);

    await screen.findByText("There are no upcoming events.");
    expect(
      screen.queryByRole("button", { name: "Event" }),
    ).not.toBeInTheDocument();
  });

  it("se llama Evento en español", async () => {
    stubApi({});

    render(<AgendaScreen locale="es" canCreateEvents />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Evento" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Nuevo evento" }),
    ).toBeInTheDocument();
  });
});

describe("diálogo de evento", () => {
  it("abre con título, tipo, fecha, hora, lugar, notas, repetición y audiencia", async () => {
    stubApi({});

    const dialog = await openDialog();

    expect(within(dialog).getByLabelText("Title")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Time")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Location")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Notes")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "One-time" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Weekly" }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "The whole club" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Specific groups" }),
    ).toBeInTheDocument();
  });

  it("ofrece los cuatro tipos de evento", async () => {
    stubApi({});

    const dialog = await openDialog();

    const options = within(within(dialog).getByLabelText("Type")).getAllByRole(
      "option",
    );
    expect(options.map((option) => option.textContent)).toEqual([
      "Training",
      "Competition",
      "Meeting",
      "Social",
    ]);
  });

  it("pone el foco en el título al abrir", async () => {
    stubApi({});

    const dialog = await openDialog();

    expect(within(dialog).getByLabelText("Title")).toHaveFocus();
  });

  it("con Semanal cambia la fecha por los días de la semana, el inicio y el fin", async () => {
    stubApi({});
    const dialog = await openDialog();

    await chooseWeekly(dialog);

    expect(within(dialog).queryByLabelText("Date")).not.toBeInTheDocument();
    const days = within(dialog).getByRole("group", { name: "Repeats on" });
    expect(within(days).getAllByRole("checkbox")).toHaveLength(7);
    expect(
      within(days).getByRole("checkbox", { name: "Monday" }),
    ).toBeInTheDocument();
    expect(
      within(days).getByRole("checkbox", { name: "Sunday" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Starts")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Ends")).toBeInTheDocument();
  });

  it("manda un evento suelto con lo escrito y la audiencia de todo el club", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Type"),
      "Competition",
    );
    await userEvent.type(within(dialog).getByLabelText("Notes"), "Bring fins");

    await submit(dialog);

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]?.body).toEqual({
      repeat: "none",
      title: "Pool Training",
      eventType: "competition",
      startsOn: "2026-10-06",
      startTime: "19:00",
      location: "MSAC Dive Pool",
      notes: "Bring fins",
      audience: { kind: "club" },
    });
  });

  it("al guardar un evento suelto cierra el diálogo, lo pinta en la agenda y dice que avisó", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await submit(dialog);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("heading", { name: CREATED_EVENT.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Event created. We let the members know."),
    ).toHaveAttribute("role", "status");
  });

  it("manda una serie con los días, el rango y los grupos marcados", async () => {
    stubApi({ respondToCreate: () => createdSeries(8) });
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Specific groups" }),
    );
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: SENIOR.name }),
    );

    await submit(dialog);

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]?.body).toEqual({
      repeat: "weekly",
      title: "Pool Training",
      eventType: "training",
      weekdays: [2, 4],
      startsOn: "2026-10-06",
      endsOn: "2026-10-29",
      startTime: "19:00",
      location: "MSAC Dive Pool",
      notes: null,
      audience: { kind: "groups", groupIds: [SENIOR.id] },
    });
  });

  it("al guardar una serie pinta las sesiones y dice cuántas creó", async () => {
    const sessions: AgendaEvent[] = [
      { ...CREATED_EVENT, seriesId: "cccccccc-0000-4000-8000-00000000000c" },
      {
        ...CREATED_EVENT,
        id: "dddddddd-0000-4000-8000-00000000000d",
        startsOn: "2026-10-08",
        seriesId: "cccccccc-0000-4000-8000-00000000000c",
      },
    ];
    stubApi({
      respondToCreate: () => createdSeries(8),
      agendaAfterCreate: sessions,
    });
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);

    await submit(dialog);

    expect(
      await screen.findAllByRole("heading", { name: CREATED_EVENT.title }),
    ).toHaveLength(2);
    expect(
      screen.getByText("Created 8 sessions. We let the members know."),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("no avisa de nada antes de crear", async () => {
    stubApi({});

    render(<AgendaScreen locale="en" canCreateEvents />);

    await screen.findByText("There are no upcoming events.");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each([
    ["event_in_past", "Date", "That date and time have already passed."],
    ["event_title_invalid", "Title", "Write a title of up to 80 characters."],
    [
      "event_location_invalid",
      "Location",
      "Write a location of up to 120 characters.",
    ],
    [
      "event_notes_too_long",
      "Notes",
      "The notes can be up to 2,000 characters long.",
    ],
  ])(
    "pinta el %s de la API junto a %s sin borrar lo escrito",
    async (reason, label, message) => {
      stubApi({ respondToCreate: () => businessRule(reason) });
      const dialog = await openDialog();
      fillSingleEvent(dialog);

      await submit(dialog);

      const field = within(dialog).getByLabelText(label);
      await waitFor(() => expect(field).toHaveAccessibleDescription(message));
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(within(dialog).getByLabelText("Title")).toHaveValue(
        "Pool Training",
      );
      expect(within(dialog).getByLabelText("Location")).toHaveValue(
        "MSAC Dive Pool",
      );
    },
  );

  it("pinta el rango sin días junto a los días de la semana", async () => {
    stubApi({ respondToCreate: () => businessRule("series_weekdays_empty") });
    const dialog = await openDialog();
    setValue(dialog, "Title", "Pool Training");
    setValue(dialog, "Time", "19:00");
    setValue(dialog, "Location", "MSAC Dive Pool");
    await chooseWeekly(dialog);
    setValue(dialog, "Starts", "2026-10-06");
    setValue(dialog, "Ends", "2026-10-29");

    await submit(dialog);

    const days = within(dialog).getByRole("group", { name: "Repeats on" });
    await waitFor(() =>
      expect(days).toHaveAccessibleDescription(
        "Choose at least one day of the week.",
      ),
    );
    expect(within(dialog).getByLabelText("Ends")).toHaveValue("2026-10-29");
  });

  it.each([
    ["series_range_inverted", "The end date is before the start date."],
    ["series_range_too_long", "A series can last up to 366 days."],
  ])("pinta el %s junto al fin", async (reason, message) => {
    stubApi({ respondToCreate: () => businessRule(reason) });
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);

    await submit(dialog);

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Ends")).toHaveAccessibleDescription(
        message,
      ),
    );
  });

  it("pinta la serie sin sesiones junto a los días de la semana", async () => {
    stubApi({ respondToCreate: () => businessRule("series_without_sessions") });
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);

    await submit(dialog);

    await waitFor(() =>
      expect(
        within(dialog).getByRole("group", { name: "Repeats on" }),
      ).toHaveAccessibleDescription(
        "Those days and dates don't give any session. Change the days or the range.",
      ),
    );
  });

  it("pinta la audiencia vacía junto a los grupos, en español", async () => {
    stubApi({ respondToCreate: () => businessRule("event_audience_empty") });
    render(<AgendaScreen locale="es" canCreateEvents />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Evento" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Nuevo evento" });
    await userEvent.click(
      await within(dialog).findByRole("radio", { name: "Grupos concretos" }),
    );
    setValue(dialog, "Título", "Entreno");
    setValue(dialog, "Fecha", "2026-10-06");
    setValue(dialog, "Hora", "19:00");
    setValue(dialog, "Lugar", "MSAC");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Crear evento" }),
    );

    const groups = within(dialog).getByRole("group", { name: "Grupos" });
    await waitFor(() =>
      expect(groups).toHaveAccessibleDescription(
        "Elige todo el club o al menos un grupo.",
      ),
    );
    expect(within(dialog).getByLabelText("Título")).toHaveValue("Entreno");
  });

  it("marca los campos obligatorios vacíos sin llamar a la API", async () => {
    stubApi({});
    const dialog = await openDialog();

    await submit(dialog);

    expect(within(dialog).getByLabelText("Title")).toHaveAccessibleDescription(
      "Fill in this field.",
    );
    expect(within(dialog).getByLabelText("Date")).toHaveAccessibleDescription(
      "Fill in this field.",
    );
    expect(createCalls()).toEqual([]);
  });

  it("si la red cae lo dice arriba del diálogo y deja reintentar sin perder lo escrito", async () => {
    let attempts = 0;
    stubApi({
      respondToCreate: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return createdSingle();
      },
    });
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await submit(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Pool Training");

    await submit(dialog);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(createCalls()).toHaveLength(2);
  });

  it("no manda una segunda petición mientras la primera está en curso", async () => {
    let finishCreate: (response: Response) => void = () => undefined;
    stubApi({
      respondToCreate: () =>
        new Promise<Response>((resolve) => {
          finishCreate = resolve;
        }),
    });
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    const button = within(dialog).getByRole("button", { name: "Create event" });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Saving…" }),
      ).toBeDisabled(),
    );
    expect(createCalls()).toHaveLength(1);
    finishCreate(createdSingle());
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("Cancelar cierra sin guardar y devuelve el foco a + Evento", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Event" })).toHaveFocus();
    expect(createCalls()).toEqual([]);
  });

  it("Escape cierra sin guardar y devuelve el foco a + Evento", async () => {
    stubApi({});
    await openDialog();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Event" })).toHaveFocus();
    expect(createCalls()).toEqual([]);
  });

  it("al volver a abrir empieza en blanco", async () => {
    stubApi({});
    const dialog = await openDialog();
    setValue(dialog, "Title", "Pool Training");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Event" }));

    const reopened = await screen.findByRole("dialog", { name: "New event" });
    expect(within(reopened).getByLabelText("Title")).toHaveValue("");
  });

  it("en un club sin grupos sólo ofrece todo el club", async () => {
    stubApi({ groups: [] });

    const dialog = await openDialog();

    expect(
      within(dialog).getByRole("radio", { name: "The whole club" }),
    ).toBeChecked();
    expect(
      within(dialog).queryByRole("radio", { name: "Specific groups" }),
    ).not.toBeInTheDocument();
  });

  it("si no llegan los grupos lo dice y deja reintentar", async () => {
    let groupReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://localhost");
        if (url.pathname === GROUPS_PATH) {
          groupReads += 1;
          return groupReads === 1
            ? jsonResponse(500, {
                error: { code: "internal_error", message: "Falló." },
              })
            : jsonResponse(200, { data: { groups: [SENIOR] } });
        }
        return jsonResponse(200, { data: { events: [], nextCursor: null } });
      }),
    );
    render(<AgendaScreen locale="en" canCreateEvents />);
    await userEvent.click(await screen.findByRole("button", { name: "Event" }));
    const dialog = await screen.findByRole("dialog", { name: "New event" });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We couldn't load the club's groups. Try again.",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Try again" }),
    );

    expect(
      await within(dialog).findByRole("radio", { name: "Specific groups" }),
    ).toBeInTheDocument();
  });
});
