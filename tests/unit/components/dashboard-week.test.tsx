import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DashboardWeek } from "@/components/dashboard/DashboardWeek";
import type { Week, WeekEvent } from "@/lib/dashboard/dashboard";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * "Esta semana" del inicio (#748, RF-4 y D14 del PRD de E27): la franja de
 * hoy a hoy + 6 con un punto por tipo, y debajo los eventos del día marcado
 * con mi respuesta. Cada fila abre su evento en el calendario.
 */

// Jueves 15 de octubre de 2026 en Melbourne.
const TODAY = "2026-10-15";

function weekEvent(
  overrides: Partial<WeekEvent> & Pick<WeekEvent, "id" | "title">,
): WeekEvent {
  return {
    eventType: "training",
    startsOn: TODAY,
    endsOn: null,
    startTime: "19:00",
    endTime: "21:00",
    location: "MSAC Dive Pool",
    myResponse: null,
    ...overrides,
  };
}

const SCRIMMAGE = weekEvent({
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Saturday scrimmage",
  startsOn: "2026-10-17",
  startTime: "09:00",
  endTime: "11:00",
  location: "Princes Park · Field 2",
});

const SOCIAL = weekEvent({
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  title: "Pizza night",
  eventType: "social",
  startsOn: "2026-10-17",
  startTime: "18:00",
  endTime: null,
  location: "Clubhouse",
  myResponse: "yes",
});

const CUP = weekEvent({
  id: "cccccccc-0000-4000-8000-00000000000c",
  title: "Island Cup",
  eventType: "competition",
  startsOn: "2026-10-19",
  endsOn: "2026-10-20",
  startTime: "08:00",
  endTime: "17:00",
  location: "Hobart",
  myResponse: "maybe",
});

const WEEK: Week = { kind: "week", events: [SCRIMMAGE, SOCIAL, CUP] };

type Options = {
  readonly week?: Week;
  readonly nextUpStartsOn?: string | null;
  readonly isRestricted?: boolean;
  readonly locale?: Locale;
  readonly onRetry?: () => void;
};

function renderWeek({
  week = WEEK,
  nextUpStartsOn = null,
  isRestricted = false,
  locale = "en",
  onRetry = vi.fn(),
}: Options = {}): void {
  render(
    <DashboardWeek
      translate={createTranslator(locale)}
      week={week}
      today={TODAY}
      nextUpStartsOn={nextUpStartsOn}
      isRestricted={isRestricted}
      onRetry={onRetry}
    />,
  );
}

function weekSection(): HTMLElement {
  return screen.getByRole("region", { name: "This week" });
}

function dayButtons(): HTMLElement[] {
  return within(
    within(weekSection()).getByRole("group", { name: "Days" }),
  ).getAllByRole("button");
}

function dayButton(name: RegExp): HTMLElement {
  return within(weekSection()).getByRole("button", { name });
}

function eventList(): HTMLElement {
  return within(weekSection()).getByRole("list", { name: /events on/i });
}

describe("la franja de la semana", () => {
  it("lleva el título y el enlace al calendario", () => {
    renderWeek();

    const section = weekSection();
    expect(
      within(section).getByRole("heading", { name: "This week" }),
    ).toBeVisible();
    expect(
      within(section).getByRole("link", { name: /calendar/i }),
    ).toHaveAttribute("href", "/calendario");
  });

  it("pinta siete días de hoy a hoy + 6 con su día de la semana y su fecha", () => {
    renderWeek();

    const buttons = dayButtons();
    expect(buttons).toHaveLength(7);
    expect(buttons[0]).toHaveAccessibleName(/Thursday, October 15/);
    expect(buttons[6]).toHaveAccessibleName(/Wednesday, October 21/);
    expect(buttons[0]).toHaveTextContent("Thu");
    expect(buttons[0]).toHaveTextContent("15");
  });

  it("dice en el nombre de cada día cuántos eventos tiene", () => {
    renderWeek();

    expect(dayButton(/October 17/)).toHaveAccessibleName(
      "Saturday, October 17 · 2 events",
    );
    expect(dayButton(/October 16/)).toHaveAccessibleName(
      "Friday, October 16 · no events",
    );
  });

  it("pone un punto por tipo presente en el día", () => {
    renderWeek();

    const saturday = dayButton(/October 17/);
    expect(
      saturday.querySelectorAll(".dashboard-week-dot-training"),
    ).toHaveLength(1);
    expect(
      saturday.querySelectorAll(".dashboard-week-dot-social"),
    ).toHaveLength(1);
    expect(
      dayButton(/October 16/).querySelectorAll(".dashboard-week-dot"),
    ).toHaveLength(0);
  });

  it("pone el día de la semana de hoy en acento", () => {
    renderWeek();

    const weekdays = dayButtons().map((button) =>
      button.querySelector(".dashboard-week-weekday"),
    );
    expect(weekdays[0]).toHaveClass("is-today");
    expect(
      weekdays.slice(1).some((day) => day?.classList.contains("is-today")),
    ).toBe(false);
  });

  it("cuenta un evento de varios días en cada día que ocupa", () => {
    renderWeek();

    expect(dayButton(/October 19/)).toHaveAccessibleName(/1 event$/);
    expect(dayButton(/October 20/)).toHaveAccessibleName(/1 event$/);
  });
});

describe("el día marcado", () => {
  it("es el del Próximo cuando cae en la franja", () => {
    renderWeek({ nextUpStartsOn: "2026-10-17" });

    expect(dayButton(/October 17/)).toHaveAttribute("aria-pressed", "true");
    expect(dayButton(/October 15/)).toHaveAttribute("aria-pressed", "false");
  });

  it("es hoy cuando el Próximo cae fuera de la franja", () => {
    renderWeek({ nextUpStartsOn: "2026-11-02" });

    expect(dayButton(/October 15/)).toHaveAttribute("aria-pressed", "true");
  });

  it("es hoy cuando no hay Próximo", () => {
    renderWeek({ nextUpStartsOn: null });

    expect(dayButton(/October 15/)).toHaveAttribute("aria-pressed", "true");
  });

  it("pasa al día que pulso y desmarca los demás", async () => {
    const user = userEvent.setup();
    renderWeek({ nextUpStartsOn: "2026-10-17" });

    await user.click(dayButton(/October 19/));

    expect(dayButton(/October 19/)).toHaveAttribute("aria-pressed", "true");
    expect(
      dayButtons().filter(
        (button) => button.getAttribute("aria-pressed") === "true",
      ),
    ).toHaveLength(1);
  });
});

describe("los eventos del día marcado", () => {
  it("salen con inicio y fin, título, lugar y mi respuesta", () => {
    renderWeek({ nextUpStartsOn: "2026-10-17" });

    const rows = within(eventList()).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Saturday scrimmage");
    expect(rows[0]).toHaveTextContent("Princes Park · Field 2");
    expect(rows[0]).toHaveTextContent("9:00 am");
    expect(rows[0]).toHaveTextContent("11:00 am");
    expect(rows[0]).toHaveTextContent("RSVP");
    expect(rows[1]).toHaveTextContent("Pizza night");
    expect(rows[1]).toHaveTextContent("Going");
  });

  it("pone cada respuesta con su tono: Voy, Quizás y Responder", () => {
    renderWeek({ nextUpStartsOn: "2026-10-17" });

    const [scrimmage, social] = within(eventList()).getAllByRole("link");
    expect(
      scrimmage?.querySelector(".dashboard-week-response-rsvp"),
    ).toHaveTextContent("RSVP");
    expect(
      social?.querySelector(".dashboard-week-response-yes"),
    ).toHaveTextContent("Going");
  });

  it("dice Quizás en un evento al que respondí quizás", async () => {
    const user = userEvent.setup();
    renderWeek();

    await user.click(dayButton(/October 19/));

    const [cup] = within(eventList()).getAllByRole("link");
    expect(
      cup?.querySelector(".dashboard-week-response-maybe"),
    ).toHaveTextContent("Maybe");
  });

  it("saca un evento de varios días en la lista de cada día que ocupa", async () => {
    const user = userEvent.setup();
    renderWeek();

    await user.click(dayButton(/October 20/));

    expect(within(eventList()).getByRole("link")).toHaveTextContent(
      "Island Cup",
    );
  });

  it("abre el evento de la fila en el calendario", () => {
    renderWeek({ nextUpStartsOn: "2026-10-17" });

    const [scrimmage] = within(eventList()).getAllByRole("link");
    expect(scrimmage).toHaveAttribute(
      "href",
      `/calendario?evento=${SCRIMMAGE.id}`,
    );
  });

  it("abre en los pasados un evento que empezó antes de hoy", () => {
    const camp = weekEvent({
      id: "dddddddd-0000-4000-8000-00000000000d",
      title: "Winter camp",
      startsOn: "2026-10-13",
      endsOn: "2026-10-16",
    });
    renderWeek({ week: { kind: "week", events: [camp] } });

    expect(within(eventList()).getByRole("link")).toHaveAttribute(
      "href",
      `/calendario?evento=${camp.id}&periodo=past`,
    );
  });

  it("dice que no hay nada en un día sin eventos", async () => {
    const user = userEvent.setup();
    renderWeek();

    await user.click(dayButton(/October 16/));

    expect(
      within(weekSection()).getByText("Nothing on Friday, October 16."),
    ).toBeVisible();
    expect(
      within(weekSection()).queryByRole("list", { name: /events on/i }),
    ).toBeNull();
  });

  it("lo dice en español", async () => {
    const user = userEvent.setup();
    renderWeek({ locale: "es" });

    await user.click(
      within(screen.getByRole("region", { name: "Esta semana" })).getByRole(
        "button",
        { name: /16 de octubre/ },
      ),
    );

    expect(screen.getByText("Nada el viernes, 16 de octubre.")).toBeVisible();
  });
});

describe("una respuesta negativa", () => {
  it("dice No puedo y no ofrece Responder", () => {
    const declined = weekEvent({
      id: "eeeeeeee-0000-4000-8000-00000000000e",
      title: "Gym session",
      myResponse: "no",
    });
    renderWeek({ week: { kind: "week", events: [declined] } });

    const row = within(eventList()).getByRole("link");
    expect(row.querySelector(".dashboard-week-response-no")).toHaveTextContent(
      "Can't go",
    );
    expect(row).not.toHaveTextContent("RSVP");
  });
});

describe("un socio restringido", () => {
  it("no ve Responder", () => {
    renderWeek({ nextUpStartsOn: "2026-10-17", isRestricted: true });

    const [scrimmage] = within(eventList()).getAllByRole("link");
    expect(scrimmage).not.toHaveTextContent("RSVP");
  });

  it("sí ve lo que respondió antes", () => {
    renderWeek({ nextUpStartsOn: "2026-10-17", isRestricted: true });

    const [, social] = within(eventList()).getAllByRole("link");
    expect(social).toHaveTextContent("Going");
  });
});

describe("el teclado en la franja", () => {
  it("las flechas llevan el foco al día de al lado", async () => {
    const user = userEvent.setup();
    renderWeek();
    dayButton(/October 15/).focus();

    await user.keyboard("{ArrowRight}");
    expect(dayButton(/October 16/)).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowLeft}");
    expect(dayButton(/October 16/)).toHaveFocus();
  });

  it("Inicio y Fin llevan al primero y al último", async () => {
    const user = userEvent.setup();
    renderWeek();
    dayButton(/October 17/).focus();

    await user.keyboard("{End}");
    expect(dayButton(/October 21/)).toHaveFocus();

    await user.keyboard("{Home}");
    expect(dayButton(/October 15/)).toHaveFocus();
  });

  it("no se sale de la franja por los extremos", async () => {
    const user = userEvent.setup();
    renderWeek();
    dayButton(/October 15/).focus();

    await user.keyboard("{ArrowLeft}");

    expect(dayButton(/October 15/)).toHaveFocus();
  });
});

describe("una semana que no se pudo cargar", () => {
  it("lo dice y ofrece reintentar", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWeek({ week: { kind: "unavailable" }, onRetry });

    expect(
      within(weekSection()).getByText("We couldn't load this week."),
    ).toBeVisible();
    await user.click(
      within(weekSection()).getByRole("button", { name: "Try again" }),
    );

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
