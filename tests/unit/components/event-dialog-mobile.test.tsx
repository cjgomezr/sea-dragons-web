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
import { EventDialog } from "@/components/calendar/EventDialog";
import {
  EMPTY_EVENT_FORM,
  type EventForm,
} from "@/components/calendar/event-form";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El formulario de evento en el móvil (#657, RF-14 del PRD de E24): por
 * debajo de 768 px ocupa la pantalla y lleva su barra con Cancelar, el nombre
 * de la pantalla y el botón principal. Las piezas del formulario son las del
 * diálogo de escritorio; aquí se prueba la barra. Las medidas, que la barra se
 * quede arriba y axe los prueba Playwright.
 *
 * El ancho lo dice `matchMedia`, que aquí se simula.
 */

const PHONE_QUERY = "(width < 768px)";
const AGENDA_PATH = "/api/v1/events";
const CREATE_PATH = "/api/v1/events/manage";
const GROUPS_PATH = "/api/v1/groups";
const DISCARD_QUESTION = "You have unsaved changes. Leave and discard them?";

const CREATED_EVENT: AgendaEvent = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
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
  seriesId: null,
  goingCount: 0,
  maybeCount: 0,
  myResponse: null,
  inAudience: true,
  coverThumbUrl: null,
};

const SAVED_FORM: EventForm = {
  ...EMPTY_EVENT_FORM,
  title: "Pool Training",
  startsOn: "2026-10-06",
  startTime: "19:00",
  endTime: "20:30",
  location: "MSAC Dive Pool",
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
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

/** La agenda arranca vacía y, cuando ya se creó algo, trae lo creado. */
function stubApi(): void {
  let hasCreated = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const { pathname } = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      if (pathname === AGENDA_PATH) {
        return jsonResponse(200, {
          data: { events: hasCreated ? [CREATED_EVENT] : [], nextCursor: null },
        });
      }
      if (pathname === GROUPS_PATH) {
        return jsonResponse(200, { data: { groups: [] } });
      }
      if (pathname === CREATE_PATH && method === "POST") {
        hasCreated = true;
        return createdSingle();
      }
      throw new Error(`Petición inesperada: ${method} ${pathname}`);
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

async function openCreate(locale: Locale = "en"): Promise<HTMLElement> {
  render(
    <AgendaScreen
      locale={locale}
      canManageEvents
      canTakeAttendance={false}
      canRespond
    />,
  );
  // En el móvil el botón de crear es sólo el + (#656), con su nombre entero.
  const openName = locale === "en" ? "New event" : "Nuevo evento";
  await userEvent.click(await screen.findByRole("button", { name: openName }));
  const dialog = await screen.findByRole("dialog", {
    name: locale === "en" ? "New event" : "Nuevo evento",
  });
  await within(dialog).findByLabelText(locale === "en" ? "Title" : "Título");
  return dialog;
}

async function openEdit(options: {
  readonly locale: Locale;
  readonly submit?: () => Promise<{ readonly kind: "finished" }>;
  readonly onClosed?: () => void;
}): Promise<HTMLElement> {
  const {
    locale,
    submit = async () => ({ kind: "finished" }),
    onClosed = () => {},
  } = options;
  render(
    <EventDialog
      translate={createTranslator(locale)}
      layout="event"
      initialForm={SAVED_FORM}
      submit={submit}
      onClosed={onClosed}
    />,
  );
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByLabelText(locale === "en" ? "Title" : "Título");
  return dialog;
}

function phoneBar(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("group", {
    name: /^(New event|Edit event)$/,
  });
}

function setValue(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

function fillSingleEvent(dialog: HTMLElement): void {
  setValue(dialog, "Title", "Pool Training");
  setValue(dialog, "Date", "2026-10-06");
  setValue(dialog, "Starts", "19:00");
  setValue(dialog, "Ends", "20:30");
  setValue(dialog, "Location", "MSAC Dive Pool");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T09:00:00+10:00"));
  stubPhone();
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("la barra del formulario de evento en el móvil", () => {
  it("al crear lleva Cancelar, Nuevo evento y Crear, sin el pie ni la ×", async () => {
    const dialog = await openCreate();

    const bar = phoneBar(dialog);
    expect(
      within(bar).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("heading", { name: "New event" }),
    ).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Create" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Create event" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: "Cancel" }),
    ).toHaveLength(1);
  });

  it("en español dice Cancelar, Nuevo evento y Crear", async () => {
    const dialog = await openCreate("es");

    const bar = within(dialog).getByRole("group", { name: "Nuevo evento" });
    expect(
      within(bar).getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: "Crear" }),
    ).toBeInTheDocument();
  });

  it("al editar dice Editar evento y Guardar", async () => {
    const dialog = await openEdit({ locale: "en" });

    const bar = within(dialog).getByRole("group", { name: "Edit event" });
    expect(
      within(bar).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
  });

  it("al editar en español dice Editar evento y Guardar", async () => {
    const dialog = await openEdit({ locale: "es" });

    const bar = within(dialog).getByRole("group", { name: "Editar evento" });
    expect(
      within(bar).getByRole("button", { name: "Guardar" }),
    ).toBeInTheDocument();
  });

  it("con el fin antes del inicio desactiva Crear en la barra y marca Termina", async () => {
    const dialog = await openCreate();
    fillSingleEvent(dialog);

    setValue(dialog, "Ends", "18:00");

    expect(
      within(phoneBar(dialog)).getByRole("button", { name: "Create" }),
    ).toBeDisabled();
    expect(within(dialog).getByLabelText("Ends")).toHaveAccessibleDescription(
      "The end must be after the start.",
    );
  });

  it("al crear con Crear de la barra vuelve a la agenda con el aviso", async () => {
    const dialog = await openCreate();
    fillSingleEvent(dialog);

    await userEvent.click(
      within(phoneBar(dialog)).getByRole("button", { name: "Create" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("Event created. We let the members know."),
    ).toHaveAttribute("role", "status");
  });

  it("al guardar con Guardar de la barra cierra la pantalla", async () => {
    const submit = vi.fn(async () => ({ kind: "finished" }) as const);
    const onClosed = vi.fn();
    const dialog = await openEdit({ locale: "en", submit, onClosed });
    setValue(dialog, "Title", "Gym session");

    await userEvent.click(
      within(phoneBar(dialog)).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => expect(onClosed).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe("Cancelar en el móvil", () => {
  it("sin cambios cierra sin preguntar", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const dialog = await openCreate();

    await userEvent.click(
      within(phoneBar(dialog)).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("con cambios pregunta y se queda si no se confirma", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const dialog = await openCreate();
    setValue(dialog, "Title", "Pool Training");

    await userEvent.click(
      within(phoneBar(dialog)).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).toHaveBeenCalledWith(DISCARD_QUESTION);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Pool Training");
  });

  it("con cambios cierra si se confirma", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const dialog = await openCreate();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /Social/ }),
    );

    await userEvent.click(
      within(phoneBar(dialog)).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("escribir y borrar lo escrito no cuenta como cambio", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const dialog = await openEdit({ locale: "en" });
    setValue(dialog, "Title", "Gym session");
    setValue(dialog, "Title", SAVED_FORM.title);

    await userEvent.click(
      within(phoneBar(dialog)).getByRole("button", { name: "Cancel" }),
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("el botón atrás del teléfono también pregunta con cambios", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const dialog = await openCreate();
    setValue(dialog, "Title", "Pool Training");

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(confirm).toHaveBeenCalledWith(DISCARD_QUESTION);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lo pregunta en español", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const dialog = await openCreate("es");
    setValue(dialog, "Título", "Entrenamiento");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancelar" }),
    );

    expect(confirm).toHaveBeenCalledWith(
      "Tienes cambios sin guardar. ¿Salir y descartarlos?",
    );
  });
});
