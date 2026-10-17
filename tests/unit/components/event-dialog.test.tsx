import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const UPLOAD_PATH = "/api/v1/events/manage/uploads";
const PLACES_PATH = "/api/v1/events/manage/places";
const COVER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";

const PRINCES_PARK = {
  name: "Princes Park, Oval 2",
  address: "Princes Park Dr, Carlton North VIC 3054",
  lat: -37.7836,
  lng: 144.9616,
};

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
  endTime: null,
  endsOn: null,
  title: "Pool Training",
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
  readonly respondToUpload?: Responder;
  readonly agendaAfterCreate?: readonly AgendaEvent[];
}): void {
  const {
    groups = [SENIOR, MASTERS],
    respondToCreate = createdSingle,
    respondToUpload = () => jsonResponse(201, { data: { id: COVER_ID } }),
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
      if (url.pathname === PLACES_PATH) {
        return jsonResponse(200, {
          data: {
            places: [{ source: "club", ...PRINCES_PARK }],
            searchAvailable: true,
          },
        });
      }
      if (url.pathname === UPLOAD_PATH && method === "POST") {
        return respondToUpload(call);
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
  render(
    <AgendaScreen
      locale="en"
      canManageEvents
      canTakeAttendance={false}
      canRespond
    />,
  );
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
  setValue(dialog, "Starts", "19:00");
  setValue(dialog, "Ends", "20:30");
  setValue(dialog, "Location", "MSAC Dive Pool");
}

async function chooseWeekly(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByRole("radio", { name: "Weekly" }));
}

async function fillWeeklySeries(dialog: HTMLElement): Promise<void> {
  setValue(dialog, "Title", "Pool Training");
  setValue(dialog, "Starts", "19:00");
  setValue(dialog, "Ends", "20:30");
  setValue(dialog, "Location", "MSAC Dive Pool");
  await chooseWeekly(dialog);
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Tuesday" }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Thursday" }),
  );
  setValue(dialog, "Starts on", "2026-10-06");
  setValue(dialog, "Until", "2026-10-29");
}

/** La letra que se ve del día; el nombre entero es para el lector. */
function visibleLetter(toggle: HTMLElement): string | null {
  return toggle.querySelector('[aria-hidden="true"]')?.textContent ?? null;
}

async function submit(dialog: HTMLElement): Promise<void> {
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create event" }),
  );
}

// El resumen de una serie cuenta las sesiones desde ahora (#651): con el
// reloj real, las fechas de estos tests acabarían en el pasado.
const BEFORE_THE_SERIES = new Date("2026-10-01T09:00:00+10:00");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BEFORE_THE_SERIES);
});

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("botón + Evento", () => {
  it("lo pinta a quien puede crear eventos", async () => {
    stubApi({});

    render(
      <AgendaScreen
        locale="en"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Event" }),
    ).toBeInTheDocument();
  });

  it("no lo pinta a quien no puede crear eventos", async () => {
    stubApi({});

    render(
      <AgendaScreen
        locale="en"
        canManageEvents={false}
        canTakeAttendance={false}
        canRespond
      />,
    );

    await screen.findByText("There are no upcoming events.");
    expect(
      screen.queryByRole("button", { name: "Event" }),
    ).not.toBeInTheDocument();
  });

  it("se llama Evento en español", async () => {
    stubApi({});

    render(
      <AgendaScreen
        locale="es"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );

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
    expect(within(dialog).getByLabelText("Starts")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Ends")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Location")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Notes")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Once" })).toBeChecked();
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

    const types = within(dialog).getByRole("group", { name: "Type" });
    expect(within(types).getAllByRole("radio")).toHaveLength(4);
    expect(
      ["Training", "Competition", "Meeting", "Social"].map((name) =>
        within(types).getByRole("radio", { name }),
      ),
    ).toEqual(within(types).getAllByRole("radio"));
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
    const days = within(dialog).getByRole("group", { name: "On these days" });
    const toggles = within(days).getAllByRole("button");
    expect(
      [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ].map((name) => within(days).getByRole("button", { name })),
    ).toEqual(toggles);
    expect(toggles.map(visibleLetter)).toEqual([
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
      "S",
    ]);
    expect(
      toggles.every(
        (toggle) => toggle.getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);
    expect(within(dialog).getByLabelText("Starts on")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Until")).toBeInTheDocument();
  });

  it("manda un evento suelto con lo escrito y la audiencia de todo el club", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Competition" }),
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
      endTime: "20:30",
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
      await screen.findByRole("heading", {
        level: 3,
        name: CREATED_EVENT.title,
      }),
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
      endTime: "20:30",
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
      await screen.findAllByRole("heading", {
        level: 3,
        name: CREATED_EVENT.title,
      }),
    ).toHaveLength(2);
    expect(
      screen.getByText("Created 8 sessions. We let the members know."),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("no avisa de nada antes de crear", async () => {
    stubApi({});

    render(
      <AgendaScreen
        locale="en"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );

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

  it("sin días pide al menos uno y no deja crear", async () => {
    stubApi({});
    const dialog = await openDialog();
    setValue(dialog, "Title", "Pool Training");
    setValue(dialog, "Starts", "19:00");
    setValue(dialog, "Ends", "20:30");
    setValue(dialog, "Location", "MSAC Dive Pool");
    await chooseWeekly(dialog);
    setValue(dialog, "Starts on", "2026-10-06");
    setValue(dialog, "Until", "2026-10-29");

    const days = within(dialog).getByRole("group", { name: "On these days" });
    expect(days).toHaveAccessibleDescription("Pick at least one day.");
    expect(days).toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).getByRole("button", { name: "Create event" }),
    ).toBeDisabled();
  });

  it("marcar un día lo deja pulsado y volver a pulsarlo lo quita", async () => {
    stubApi({});
    const dialog = await openDialog();
    await chooseWeekly(dialog);
    const tuesday = within(dialog).getByRole("button", { name: "Tuesday" });

    await userEvent.click(tuesday);
    expect(tuesday).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(tuesday);
    expect(tuesday).toHaveAttribute("aria-pressed", "false");
  });

  it("resume la serie con las primeras fechas y cuántas más", async () => {
    stubApi({});
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);

    expect(
      within(dialog).getByText(
        "Every Tuesday and Thursday, 7:00 pm – 8:30 pm · 8 sessions until Thu, 29 Oct",
      ),
    ).toBeInTheDocument();
    const next = within(dialog).getByRole("list", { name: "Next:" });
    expect(
      within(next)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Tue, 6 Oct", "Thu, 8 Oct", "Tue, 13 Oct", "Thu, 15 Oct"]);
    expect(within(dialog).getByText("+4 more")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Each session gets its own RSVP and attendance. You can still edit or cancel a single one.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create event" }),
    ).toBeEnabled();
  });

  it("con todo marcado dice todos los días y sin más fechas no dice más", async () => {
    stubApi({});
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);
    for (const day of ["Monday", "Wednesday", "Friday", "Saturday", "Sunday"]) {
      await userEvent.click(within(dialog).getByRole("button", { name: day }));
    }
    setValue(dialog, "Until", "2026-10-07");

    expect(
      within(dialog).getByText(
        "Every day, 7:00 pm – 8:30 pm · 2 sessions until Wed, 7 Oct",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/more$/)).not.toBeInTheDocument();
  });

  it("si ningún día cae en el rango lo dice y no deja crear", async () => {
    stubApi({});
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);

    setValue(dialog, "Until", "2026-10-07");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Tuesday" }),
    );

    expect(
      within(dialog).getByRole("group", { name: "On these days" }),
    ).toHaveAccessibleDescription(
      "No sessions fall between the start and the until date.",
    );
    expect(
      within(dialog).queryByText(/sessions? until/),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create event" }),
    ).toBeDisabled();
  });

  it("en español resume la serie con sus días en plural", async () => {
    stubApi({});
    render(
      <AgendaScreen
        locale="es"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Evento" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Nuevo evento" });
    await within(dialog).findByRole("radio", { name: "Todo el club" });
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Semanal" }),
    );
    const days = within(dialog).getByRole("group", { name: "Estos días" });
    expect(days).toHaveAccessibleDescription("Elige al menos un día.");
    expect(within(days).getAllByRole("button").map(visibleLetter)).toEqual([
      "L",
      "M",
      "M",
      "J",
      "V",
      "S",
      "D",
    ]);

    await userEvent.click(within(days).getByRole("button", { name: "lunes" }));
    await userEvent.click(within(days).getByRole("button", { name: "jueves" }));
    setValue(dialog, "Empieza", "18:00");
    setValue(dialog, "Termina", "19:30");
    setValue(dialog, "Empieza el", "2026-10-01");
    setValue(dialog, "Hasta", "2026-12-17");

    expect(
      within(dialog).getByText(
        "Todos los lunes y jueves, 18:00 – 19:30 · 23 sesiones hasta el jue 17 dic",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("+19 más")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Cada sesión tiene su propio RSVP y su asistencia. Puedes editar o cancelar una sola.",
      ),
    ).toBeInTheDocument();
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
      expect(
        within(dialog).getByLabelText("Until"),
      ).toHaveAccessibleDescription(message),
    );
  });

  it("pinta la serie sin sesiones junto a los días de la semana", async () => {
    stubApi({ respondToCreate: () => businessRule("series_without_sessions") });
    const dialog = await openDialog();
    await fillWeeklySeries(dialog);

    await submit(dialog);

    await waitFor(() =>
      expect(
        within(dialog).getByRole("group", { name: "On these days" }),
      ).toHaveAccessibleDescription(
        "Those days and dates don't give any session. Change the days or the range.",
      ),
    );
  });

  it("pinta la audiencia vacía junto a los grupos, en español", async () => {
    stubApi({ respondToCreate: () => businessRule("event_audience_empty") });
    render(
      <AgendaScreen
        locale="es"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Evento" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Nuevo evento" });
    await userEvent.click(
      await within(dialog).findByRole("radio", { name: "Grupos concretos" }),
    );
    setValue(dialog, "Título", "Entreno");
    setValue(dialog, "Fecha", "2026-10-06");
    setValue(dialog, "Empieza", "19:00");
    setValue(dialog, "Termina", "20:30");
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

  it("un motivo de la API sin campo va al aviso general sin marcar ninguno", async () => {
    stubApi({ respondToCreate: () => businessRule("event_started") });
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await submit(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We couldn't create the event. Try again.",
    );
    expect(
      within(dialog)
        .getAllByRole("textbox")
        .filter((field) => field.getAttribute("aria-invalid") === "true"),
    ).toEqual([]);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Pool Training");
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
    render(
      <AgendaScreen
        locale="en"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );
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
function aPicture(): File {
  return new File([new Uint8Array([1, 2, 3])], "gala.png", {
    type: "image/png",
  });
}

async function chooseImage(dialog: HTMLElement): Promise<void> {
  await userEvent.upload(
    within(dialog).getByLabelText("Choose an image"),
    aPicture(),
  );
}

function uploadCalls(): Call[] {
  return calls.filter((call) => call.pathname === UPLOAD_PATH);
}

describe("imagen, tipo y cuándo (#650)", () => {
  it("pone los campos en el orden del diseño, con Cancelar y Crear evento al pie", async () => {
    stubApi({});

    const dialog = await openDialog();

    const fields = [
      within(dialog).getByRole("group", { name: "Image · optional" }),
      within(dialog).getByRole("group", { name: "Type" }),
      within(dialog).getByLabelText("Title"),
      within(dialog).getByRole("group", { name: "When" }),
      within(dialog).getByRole("group", { name: "Repeat" }),
      within(dialog).getByLabelText("Location"),
      within(dialog).getByLabelText("Notes"),
      within(dialog).getByRole("group", { name: "Who's invited" }),
      within(dialog).getByRole("button", { name: "Cancel" }),
      within(dialog).getByRole("button", { name: "Create event" }),
    ];
    const followsPrevious = fields
      .slice(1)
      .map(
        (field, index) =>
          (fields[index]?.compareDocumentPosition(field) ?? 0) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(followsPrevious).toEqual(
      fields.slice(1).map(() => Node.DOCUMENT_POSITION_FOLLOWING),
    );
  });

  it("sin imagen enseña el fondo del tipo y Añadir imagen", async () => {
    stubApi({});

    const dialog = await openDialog();

    expect(
      within(dialog).getByText(
        "Without an image, the training background is used.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Add image" }),
    ).toBeInTheDocument();
  });

  it("al elegir otro tipo marca ese y cambia el fondo sin imagen", async () => {
    stubApi({});
    const dialog = await openDialog();

    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Competition" }),
    );

    expect(
      within(dialog).getByRole("radio", { name: "Competition" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Training" }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByText(
        "Without an image, the competition background is used.",
      ),
    ).toBeInTheDocument();
  });

  it("sube la imagen elegida, dice que sube y al guardar manda su id", async () => {
    URL.createObjectURL = vi.fn(() => "blob:gala");
    URL.revokeObjectURL = vi.fn();
    let finishUpload: (response: Response) => void = () => undefined;
    stubApi({
      respondToUpload: () =>
        new Promise<Response>((resolve) => {
          finishUpload = resolve;
        }),
    });
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await chooseImage(dialog);

    expect(
      await within(dialog).findByText("Uploading the image…"),
    ).toHaveAttribute("role", "status");
    expect(
      within(dialog).getByRole("button", { name: "Create event" }),
    ).toBeDisabled();
    finishUpload(jsonResponse(201, { data: { id: COVER_ID } }));
    expect(
      await within(dialog).findByRole("img", { name: "The event image" }),
    ).toHaveAttribute("src", "blob:gala");
    expect(uploadCalls()).toEqual([
      expect.objectContaining({ method: "POST", pathname: UPLOAD_PATH }),
    ]);
    await submit(dialog);
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]?.body).toMatchObject({ coverUploadId: COVER_ID });
  });

  it("quitar la imagen subida vuelve al fondo y no manda ninguna al crear", async () => {
    URL.createObjectURL = vi.fn(() => "blob:gala");
    URL.revokeObjectURL = vi.fn();
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    await chooseImage(dialog);

    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Remove image" }),
    );
    await submit(dialog);

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]?.body).not.toHaveProperty("coverUploadId");
  });

  it.each([
    ["event_cover_type_unsupported", "Choose a JPEG, PNG or WebP image."],
    ["event_cover_too_large", "The image can be up to 10 MB."],
    ["event_cover_empty", "That image is empty. Choose another one."],
  ])("pinta el %s de la subida traducido", async (reason, message) => {
    stubApi({ respondToUpload: () => businessRule(reason) });
    const dialog = await openDialog();

    await chooseImage(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(
      within(dialog).getByRole("button", { name: "Add image" }),
    ).toBeInTheDocument();
  });

  it("si la subida no llega lo dice", async () => {
    stubApi({
      respondToUpload: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const dialog = await openDialog();

    await chooseImage(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
  });

  it("dice cuánto dura con inicio y fin válidos", async () => {
    stubApi({});
    const dialog = await openDialog();

    setValue(dialog, "Date", "2026-10-14");
    setValue(dialog, "Starts", "18:00");
    setValue(dialog, "Ends", "19:30");

    expect(within(dialog).getByText("Lasts 1 h 30 min")).toBeInTheDocument();
  });

  it("con el fin antes del inicio lo dice, marca Termina y desactiva Crear", async () => {
    stubApi({});
    const dialog = await openDialog();

    setValue(dialog, "Date", "2026-10-14");
    setValue(dialog, "Starts", "18:00");
    setValue(dialog, "Ends", "17:00");

    const ends = within(dialog).getByLabelText("Ends");
    expect(ends).toHaveAccessibleDescription(
      "The end must be after the start.",
    );
    expect(ends).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).queryByText(/^Lasts/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create event" }),
    ).toBeDisabled();
  });

  it("una duración rápida pone Termina en el inicio más esa duración", async () => {
    stubApi({});
    const dialog = await openDialog();
    setValue(dialog, "Date", "2026-10-14");
    setValue(dialog, "Starts", "18:00");

    await userEvent.click(within(dialog).getByRole("button", { name: "2 h" }));

    expect(within(dialog).getByLabelText("Ends")).toHaveValue("20:00");
    expect(within(dialog).getByText("Lasts 2 h")).toBeInTheDocument();
  });

  it("una duración rápida que cruza la medianoche enciende Termina otro día con la fecha siguiente", async () => {
    stubApi({});
    const dialog = await openDialog();
    setValue(dialog, "Date", "2026-10-14");
    setValue(dialog, "Starts", "23:00");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "1 h 30" }),
    );

    expect(within(dialog).getByLabelText("Ends")).toHaveValue("00:30");
    expect(
      within(dialog).getByRole("switch", { name: "Ends on another day" }),
    ).toBeChecked();
    expect(within(dialog).getByLabelText("End date")).toHaveValue("2026-10-15");
  });

  it("en una serie no hay Termina otro día y cruzar la medianoche marca el error", async () => {
    stubApi({});
    const dialog = await openDialog();
    await chooseWeekly(dialog);
    setValue(dialog, "Starts on", "2026-10-14");
    setValue(dialog, "Starts", "23:00");

    await userEvent.click(within(dialog).getByRole("button", { name: "3 h" }));

    expect(
      within(dialog).queryByRole("switch", { name: "Ends on another day" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Ends")).toHaveAccessibleDescription(
      "The end must be after the start.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Create event" }),
    ).toBeDisabled();
  });

  it("Termina otro día añade la fecha de fin y la manda", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    expect(within(dialog).queryByLabelText("End date")).not.toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("switch", { name: "Ends on another day" }),
    );
    setValue(dialog, "End date", "2026-10-07");
    setValue(dialog, "Ends", "17:00");
    await submit(dialog);

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]?.body).toMatchObject({
      startsOn: "2026-10-06",
      endsOn: "2026-10-07",
      endTime: "17:00",
    });
  });

  it("pide la hora de fin sin llamar a la API", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    setValue(dialog, "Ends", "");

    await submit(dialog);

    expect(within(dialog).getByLabelText("Ends")).toHaveAccessibleDescription(
      "Fill in this field.",
    );
    expect(createCalls()).toEqual([]);
  });

  it.each([
    ["end_time_required", "Add the time the event ends."],
    ["end_before_start", "The end must be after the start."],
    ["multi_day_series", "A series session has to end on the day it starts."],
  ])("pinta el %s de la API junto a Termina", async (reason, message) => {
    stubApi({ respondToCreate: () => businessRule(reason) });
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await submit(dialog);

    const ends = within(dialog).getByLabelText("Ends");
    await waitFor(() => expect(ends).toHaveAccessibleDescription(message));
    expect(ends).toHaveAttribute("aria-invalid", "true");
  });

  it("pinta el event_cover_upload_invalid de la API junto a la imagen", async () => {
    stubApi({
      respondToCreate: () => businessRule("event_cover_upload_invalid"),
    });
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await submit(dialog);

    await waitFor(() =>
      expect(
        within(dialog).getByRole("group", { name: "Image · optional" }),
      ).toHaveAccessibleDescription(
        "That image is no longer available. Choose it again.",
      ),
    );
  });

  it("lo dice en español: la duración, el fin al revés y la imagen", async () => {
    stubApi({});
    render(
      <AgendaScreen
        locale="es"
        canManageEvents
        canTakeAttendance={false}
        canRespond
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Evento" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Nuevo evento" });
    await within(dialog).findByRole("radio", { name: "Todo el club" });

    setValue(dialog, "Fecha", "2026-10-14");
    setValue(dialog, "Empieza", "18:00");
    setValue(dialog, "Termina", "19:30");
    expect(within(dialog).getByText("Dura 1 h 30 min")).toBeInTheDocument();
    setValue(dialog, "Termina", "17:00");

    expect(
      within(dialog).getByLabelText("Termina"),
    ).toHaveAccessibleDescription(
      "La hora de fin debe ser después del inicio.",
    );
    expect(
      within(dialog).getByRole("switch", { name: "Termina otro día" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Añadir imagen" }),
    ).toBeInTheDocument();
  });
});

describe("los avisos del fin tras corregir (#650)", () => {
  it("al cambiar el inicio se va el aviso del servidor junto a Termina", async () => {
    stubApi({ respondToCreate: () => businessRule("end_before_start") });
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    await submit(dialog);
    const ends = within(dialog).getByLabelText("Ends");
    await waitFor(() =>
      expect(ends).toHaveAccessibleDescription(
        "The end must be after the start.",
      ),
    );

    setValue(dialog, "Starts", "18:00");

    expect(ends).not.toHaveAttribute("aria-invalid", "true");
  });

  it("anuncia cuánto dura sin mover el foco", async () => {
    stubApi({});
    const dialog = await openDialog();
    setValue(dialog, "Date", "2026-10-14");
    setValue(dialog, "Starts", "18:00");

    await userEvent.click(within(dialog).getByRole("button", { name: "1 h" }));

    expect(
      within(dialog).getByText("Lasts 1 h").closest("[aria-live]"),
    ).toHaveAttribute("aria-live", "polite");
  });
});

describe("el lugar en el diálogo (#652)", () => {
  it("manda el lugar elegido y dónde exactamente al crear", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);
    await userEvent.click(within(dialog).getByRole("combobox"));

    await userEvent.click(
      await within(dialog).findByRole("option", { name: /Princes Park/ }),
    );
    await userEvent.type(
      within(dialog).getByLabelText("Where exactly · optional"),
      "Field 2",
    );
    await submit(dialog);

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]?.body).toMatchObject({
      location: PRINCES_PARK.name,
      place: PRINCES_PARK,
      placeDetail: "Field 2",
    });
  });

  it("con texto libre manda sólo el lugar escrito", async () => {
    stubApi({});
    const dialog = await openDialog();
    fillSingleEvent(dialog);

    await submit(dialog);

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const body = createCalls()[0]?.body;
    expect(body).toMatchObject({ location: "MSAC Dive Pool" });
    expect(body).not.toHaveProperty("place");
    expect(body).not.toHaveProperty("placeDetail");
  });

  it("Escape cierra la lista de lugares sin cerrar el diálogo", async () => {
    stubApi({});
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("combobox"));
    await within(dialog).findByRole("listbox");

    await userEvent.keyboard("{Escape}");

    expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New event" })).toBeVisible();
  });
});
