import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingScreen } from "@/components/training/TrainingScreen";
import type {
  ActiveTrainingPlan,
  TrainingCycle,
  TrainingRoutine,
  TrainingWeek,
} from "@/lib/training/training-plan";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La semana del socio en Entrenamiento (#900, RF-3 y RF-12 del PRD de E35).
 * Qué semana toca y qué rutinas lleva lo decide el servidor (#898): aquí se
 * prueba que la pantalla pinta lo que responde la API, abre el día que toca y
 * se mueve entre semanas pidiéndolas a la API.
 */

const PLAN_PATH = "/api/v1/training/plan";
const MARKS_PATH = "/api/v1/training/marks/me";

/** Las marcas del socio (#899), que la pantalla pide junto al plan (#901). */
const NO_MARKS = { data: { marks: [] } };

const CYCLE: TrainingCycle = {
  id: "cccccccc-0000-4000-8000-00000000000c",
  name: "Road to Nationals 2027",
  event: { name: "UWR Nationals", date: "2026-11-19" },
  // Seis semanas, del lunes 12 de octubre al domingo 22 de noviembre. El
  // evento cae el jueves de la última.
  startDate: "2026-10-12",
  endDate: "2026-11-22",
  weeks: 6,
};

function exercise(id: string): TrainingRoutine["items"][number] {
  return {
    kind: "exercise",
    id,
    exercise: {
      id: `e-${id}`,
      name: `Exercise ${id}`,
      tips: [],
      photoUrls: [],
      youtubeUrl: "https://www.youtube.com/results?search_query=x",
    },
    sets: 3,
    reps: "8",
    rest: null,
    note: null,
    load: { kind: "none" },
  };
}

function routine(
  name: string,
  exercises: number,
  colorIndex = 0,
): TrainingRoutine {
  return {
    id: `r-${name}`,
    name,
    colorIndex,
    items: [
      { kind: "section", id: `s-${name}`, title: "Warm up" },
      ...Array.from({ length: exercises }, (_, index) =>
        exercise(`${name}-${index}`),
      ),
    ],
  };
}

const GYM_A = routine("Gym A · Strength", 5, 1);
const POOL = routine("Pool · Endurance", 3, 0);
const MOBILITY = routine("Mobility", 2, 4);

const WEEK_DATES: Readonly<Record<number, readonly string[]>> = {
  3: [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ],
  4: [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ],
  6: [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
  ],
};

function weekOf(
  number: number,
  routinesByDay: Partial<Record<number, TrainingRoutine[]>>,
  note: string | null = null,
): TrainingWeek {
  const dates = WEEK_DATES[number];
  if (dates === undefined) {
    throw new Error(`No hay fechas para la semana ${number}`);
  }
  return {
    number,
    note,
    dose: null,
    days: dates.map((date, weekday) => ({
      weekday,
      date,
      routines: routinesByDay[weekday] ?? [],
    })),
  };
}

/** Semana 3: lunes Pool, martes Gym A y Pool, miércoles Mobility, el resto
 * descanso. */
const WEEK_3 = weekOf(
  3,
  { 0: [POOL], 1: [GYM_A, POOL], 2: [MOBILITY] },
  "Training Camp",
);
const WEEK_4 = weekOf(4, { 3: [GYM_A] });
const WEEK_6 = weekOf(6, { 0: [POOL] });

function planFor(
  week: TrainingWeek,
  current: ActiveTrainingPlan["current"] = {
    week: 3,
    phase: "running",
    today: "2026-10-27",
  },
  cycle: TrainingCycle = CYCLE,
): ActiveTrainingPlan {
  return { cycle, current, week };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const requestedWeeks: (string | null)[] = [];

/** El plan de cada semana pedida; sin `?week`, la actual. */
function stubPlan(
  plans: Readonly<Record<string, unknown>> & { readonly current: unknown },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === MARKS_PATH) {
        return jsonResponse(200, NO_MARKS);
      }
      if (url.pathname !== PLAN_PATH) {
        return jsonResponse(404, { error: { code: "not_found" } });
      }
      const week = url.searchParams.get("week");
      requestedWeeks.push(week);
      const plan = week === null ? plans.current : plans[week];
      return jsonResponse(200, { data: plan });
    }),
  );
}

function stubCurrentPlan(plan: unknown): void {
  stubPlan({ current: plan });
}

beforeEach(() => {
  requestedWeeks.length = 0;
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderScreen(
  options: {
    readonly locale?: "en" | "es";
    readonly canPlan?: boolean;
  } = {},
): Promise<void> {
  render(
    <TrainingScreen
      locale={options.locale ?? "en"}
      canPlan={options.canPlan ?? false}
    />,
  );
  await screen.findByRole("heading", { level: 1 });
}

function dayList(): HTMLElement {
  return screen.getByRole("list", {
    name: /^(Days of week|Días de la semana)/,
  });
}

function dayButtons(): HTMLElement[] {
  return within(dayList()).getAllByRole("button");
}

function dayAt(index: number): HTMLElement {
  const day = dayButtons()[index];
  if (day === undefined) {
    throw new Error(`No hay día ${index}`);
  }
  return day;
}

describe("la cabecera del ciclo", () => {
  it("enseña el antetítulo, el nombre, el evento con su fecha y cuántas semanas faltan", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Road to Nationals 2027",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("UWR Nationals · Thu 19 Nov 2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("weeks to go").parentElement).toHaveTextContent(
      "3 weeks to go",
    );
    expect(screen.getByText("week 3 of 6")).toBeInTheDocument();
  });

  it("dice cuándo termina un ciclo sin evento", async () => {
    stubCurrentPlan(planFor(WEEK_3, undefined, { ...CYCLE, event: null }));

    await renderScreen();

    expect(screen.getByText("Ends Sun 22 Nov 2026")).toBeInTheDocument();
  });

  it("dice cuándo empieza un ciclo que todavía no empezó", async () => {
    stubCurrentPlan(
      planFor(WEEK_3, { week: 1, phase: "not_started", today: "2026-10-01" }),
    );

    await renderScreen();

    expect(screen.getByText("starts Mon 12 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText("weeks to go")).not.toBeInTheDocument();
  });

  it("dice que el ciclo terminó cuando ya pasó", async () => {
    stubCurrentPlan(
      planFor(WEEK_6, { week: 6, phase: "finished", today: "2026-12-01" }),
    );

    await renderScreen();

    expect(screen.getByText("cycle finished")).toBeInTheDocument();
    expect(screen.queryByText("weeks to go")).not.toBeInTheDocument();
  });
});

describe("la franja de semanas", () => {
  it("tiene un botón por semana con su número, la actual con NOW y seleccionada", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    const strip = screen.getByRole("navigation", { name: "Weeks" });
    const weeks = within(strip).getAllByRole("button");
    expect(weeks.map((week) => week.textContent)).toEqual([
      "1",
      "2",
      "Now3",
      "4",
      "5",
      "6",
    ]);
    expect(
      within(strip).getByRole("button", { name: "Week 3, this week" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(strip).getByRole("button", { name: "Week 4" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("nombra la semana del evento", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    expect(
      screen.getByRole("button", { name: "Week 6, event week" }),
    ).toBeInTheDocument();
  });

  it("pide a la API la semana que se elige y la selecciona", async () => {
    stubPlan({ current: planFor(WEEK_3), "6": planFor(WEEK_6) });
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Week 6, event week" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Week 6 of 6" }),
    ).toBeInTheDocument();
    expect(requestedWeeks).toEqual([null, "6"]);
    expect(
      screen.getByRole("button", { name: "Week 6, event week" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("la semana seleccionada", () => {
  it("enseña su número, sus fechas y su nota", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    expect(
      screen.getByRole("heading", { name: "Week 3 of 6" }),
    ).toBeInTheDocument();
    expect(screen.getByText("26 Oct – 1 Nov")).toBeInTheDocument();
    expect(screen.getByText("Training Camp")).toBeInTheDocument();
  });

  it("pinta siete días: con una rutina, con dos, y de descanso", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    const days = dayButtons();
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveTextContent("Pool · Endurance");
    expect(days[0]).toHaveTextContent("3 exercises");
    expect(days[1]).toHaveTextContent("Gym A · Strength + Pool · Endurance");
    expect(days[1]).toHaveTextContent("8 exercises");
    expect(days[2]).toHaveTextContent("2 exercises");
    expect(days[3]).toHaveTextContent("Rest");
    expect(days[3]).toHaveTextContent("Nothing planned");
  });

  it("pinta el día del evento con su nombre", async () => {
    stubPlan({ current: planFor(WEEK_3), "6": planFor(WEEK_6) });
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Week 6, event week" }),
    );
    await screen.findByRole("heading", { name: "Week 6 of 6" });

    const thursday = dayButtons()[3];
    expect(thursday).toHaveTextContent("UWR Nationals");
    expect(thursday).toHaveTextContent("Event day");
    expect(dayButtons()[2]).toHaveTextContent("Rest");
  });

  it("abre hoy, con TODAY, cuando hoy tiene rutina", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    const tuesday = dayButtons()[1];
    expect(tuesday).toHaveAttribute("aria-pressed", "true");
    expect(tuesday).toHaveTextContent("Today");
  });

  it("abre el primer día con rutina cuando hoy descansa", async () => {
    stubCurrentPlan(
      planFor(WEEK_3, { week: 3, phase: "running", today: "2026-10-29" }),
    );

    await renderScreen();

    expect(dayButtons()[0]).toHaveAttribute("aria-pressed", "true");
    expect(dayButtons()[3]).toHaveAttribute("aria-pressed", "false");
  });

  it("cambia de día al elegir otra fila", async () => {
    stubCurrentPlan(planFor(WEEK_3));
    await renderScreen();

    await userEvent.click(dayAt(2));

    expect(dayButtons()[2]).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { level: 3, name: "Mobility" }),
    ).toBeInTheDocument();
  });
});

describe("volver a esta semana", () => {
  it("no aparece en la semana actual", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    expect(
      screen.queryByRole("button", { name: "Back to this week" }),
    ).not.toBeInTheDocument();
  });

  it("aparece en otra semana y vuelve a la actual", async () => {
    stubPlan({
      current: planFor(WEEK_3),
      "3": planFor(WEEK_3),
      "4": planFor(WEEK_4),
    });
    await renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    await screen.findByRole("heading", { name: "Week 4 of 6" });
    await userEvent.click(
      screen.getByRole("button", { name: "Back to this week" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Week 3 of 6" }),
    ).toBeInTheDocument();
    expect(requestedWeeks).toEqual([null, "4", "3"]);
    expect(
      screen.queryByRole("button", { name: "Back to this week" }),
    ).not.toBeInTheDocument();
  });

  it("no deja ir antes de la primera semana ni después de la última", async () => {
    stubCurrentPlan(
      planFor(WEEK_6, { week: 6, phase: "running", today: "2026-11-16" }),
    );

    await renderScreen();

    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeEnabled();
  });
});

describe("el panel del día", () => {
  it("enseña la rutina del día con su fecha y sus ejercicios", async () => {
    stubCurrentPlan(planFor(WEEK_3));
    await renderScreen();

    await userEvent.click(dayAt(0));

    const panel = screen.getByRole("region", { name: "Pool · Endurance" });
    expect(panel).toHaveTextContent("Mon 26 Oct · 3 exercises");
  });

  it("enseña las dos rutinas de un día, una debajo de la otra", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Gym A · Strength", "Pool · Endurance"]);
    expect(screen.getByText("Tue 27 Oct · 5 exercises")).toBeInTheDocument();
    expect(screen.getByText("Tue 27 Oct · 3 exercises")).toBeInTheDocument();
  });

  it("enseña el descanso en un día sin nada", async () => {
    stubCurrentPlan(planFor(WEEK_3));
    await renderScreen();

    await userEvent.click(dayAt(4));

    expect(
      screen.getByRole("heading", { level: 3, name: "Rest day" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nothing planned. Recover well."),
    ).toBeInTheDocument();
  });
});

describe("en el móvil", () => {
  beforeEach(() => {
    stubScreenWidth(true);
  });

  it("compacta la cabecera en una línea", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    expect(screen.getByText("3 weeks to go · week 3 of 6")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Weeks" }),
    ).not.toBeInTheDocument();
  });

  it("tiene ‹ › y la semana con sus fechas", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    expect(
      screen.getByRole("button", { name: "Previous week" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next week" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Week 3" })).toBeInTheDocument();
    expect(screen.getByText("26 Oct – 1 Nov")).toBeInTheDocument();
  });

  it("pinta siete píldoras con la inicial, el número y un punto por rutina", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen();

    const pills = dayButtons();
    expect(pills).toHaveLength(7);
    expect(pills[1]).toHaveTextContent("T27");
    expect(pills[1]).toHaveAccessibleName(
      "Tue 27 Oct: Gym A · Strength + Pool · Endurance",
    );
    expect(pills[1]).toHaveAttribute("aria-pressed", "true");
    expect(pills[3]).toHaveAccessibleName("Thu 29 Oct: Rest");
    expect(pills[1]?.querySelectorAll(".training-pill-dot")).toHaveLength(2);
    expect(pills[3]?.querySelectorAll(".training-pill-dot")).toHaveLength(0);
  });

  it("enseña debajo la rutina del día elegido", async () => {
    stubCurrentPlan(planFor(WEEK_3));
    await renderScreen();

    await userEvent.click(dayAt(2));

    expect(screen.getByRole("region", { name: "Mobility" })).toHaveTextContent(
      "Wed 28 Oct · 2 exercises",
    );
  });
});

describe("sin ciclo activo", () => {
  it("dice que no hay plan, sin enlace a Planificar para un socio", async () => {
    stubCurrentPlan({ cycle: null });

    await renderScreen({ canPlan: false });

    expect(screen.getByText("No plan yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("enlaza a Planificar a quien planifica", async () => {
    stubCurrentPlan({ cycle: null });

    await renderScreen({ canPlan: true });

    const links = screen.getAllByRole("link", { name: "Plan training" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/entrenamiento/planificar");
    }
  });
});

describe("Plan training en la cabecera", () => {
  it("lo ve quien planifica, y lleva a Planificar", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen({ canPlan: true });

    expect(screen.getByRole("link", { name: "Plan training" })).toHaveAttribute(
      "href",
      "/entrenamiento/planificar",
    );
  });

  it("no lo ve un socio", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen({ canPlan: false });

    expect(
      screen.queryByRole("link", { name: "Plan training" }),
    ).not.toBeInTheDocument();
  });
});

describe("cuando la API no da la semana", () => {
  it("no pinta los días si la membresía no está al día", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, {
          error: {
            block: "pending",
            cycle: CYCLE,
            code: "forbidden",
            message: "Tu membresía no está al día.",
            reason: "membership_not_current",
          },
        }),
      ),
    );

    await renderScreen();

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("avisa del fallo y deja reintentar", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (new URL(input, "http://localhost").pathname === MARKS_PATH) {
          return jsonResponse(200, NO_MARKS);
        }
        calls += 1;
        return calls === 1
          ? jsonResponse(500, { error: { code: "internal_error" } })
          : jsonResponse(200, { data: planFor(WEEK_3) });
      }),
    );
    render(<TrainingScreen locale="en" canPlan={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the training plan.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Road to Nationals 2027" }),
      ).toBeInTheDocument();
    });
  });
});

describe("en español", () => {
  it("traduce la cabecera, la semana y los días, con tú", async () => {
    stubCurrentPlan(planFor(WEEK_3));

    await renderScreen({ locale: "es", canPlan: true });

    expect(screen.getByText("Entrenamiento")).toBeInTheDocument();
    expect(screen.getByText("semanas restantes")).toBeInTheDocument();
    expect(screen.getByText("semana 3 de 6")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Semana 3 de 6" }),
    ).toBeInTheDocument();
    expect(dayButtons()[3]).toHaveTextContent("Descanso");
    expect(dayButtons()[0]).toHaveTextContent("3 ejercicios");
    expect(dayButtons()[1]).toHaveTextContent("Hoy");
    expect(
      screen.getByRole("link", { name: "Planificar entrenamiento" }),
    ).toBeInTheDocument();
  });

  it("dice que no hay plan", async () => {
    stubCurrentPlan({ cycle: null });

    await renderScreen({ locale: "es" });

    expect(screen.getByText("Todavía no hay plan")).toBeInTheDocument();
  });
});
