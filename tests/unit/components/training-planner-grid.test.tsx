import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import type {
  CycleDayRecord,
  CycleWeekRecord,
  ManagedCycle,
} from "@/lib/training/club-cycles";
import type { ManagedRoutine } from "@/lib/training/club-routines";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La cuadrícula de Planificar → Ciclo (#907, RF-8, D6 y D7 del PRD de E35):
 * hasta dos rutinas por día, la nota y la dosis de cada semana y copiar la
 * semana 1. Lo que vale lo decide la API (#904); aquí se prueba que la
 * pantalla pinta lo que responde y le pide lo que toca.
 */

const CYCLES_PATH = "/api/v1/training/manage/cycles";
const ROUTINES_PATH = "/api/v1/training/manage/routines";

const ACTIVE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: { name: "UWR Nationals", date: "2027-04-22" },
  ownRoutines: 2,
};

const GYM: ManagedRoutine = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: "Gym A",
  cycleId: ACTIVE.id,
  colorIndex: 0,
  itemCount: 5,
  daysUsed: 3,
};

const POOL: ManagedRoutine = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Pool B",
  cycleId: ACTIVE.id,
  colorIndex: 1,
  itemCount: 4,
  daysUsed: 1,
};

const MOBILITY: ManagedRoutine = {
  id: "bbbbbbbb-0000-4000-8000-000000000003",
  name: "Mobility",
  cycleId: null,
  colorIndex: 2,
  itemCount: 2,
  daysUsed: 0,
};

const ROUTINES = [GYM, POOL, MOBILITY];

/** Lunes de la semana 1: gimnasio y piscina. Martes: solo gimnasio. */
const DAYS: readonly CycleDayRecord[] = [
  { weekNo: 1, weekday: 0, slot: 1, routineId: GYM.id },
  { weekNo: 1, weekday: 0, slot: 2, routineId: POOL.id },
  { weekNo: 1, weekday: 1, slot: 1, routineId: GYM.id },
];

const WEEK_TWO: CycleWeekRecord = {
  weekNo: 2,
  note: "Camp",
  dose: { sets: 4, reps: "5", intensity: { kind: "pct", pct: 80 } },
};

/** Las 12:00 del miércoles 28 de octubre de 2026 en Melbourne: la semana 3
 * del ciclo activo. */
const NOW = new Date("2026-10-28T01:00:00.000Z");

type ApiReply = { readonly status: number; readonly body: unknown };
type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

type Plan = {
  readonly weeks: readonly CycleWeekRecord[];
  readonly days: readonly CycleDayRecord[];
};

const requests: ApiRequest[] = [];

function ok(data: unknown, status = 200): ApiReply {
  return { status, body: { data } };
}

const FAILURE: ApiReply = {
  status: 500,
  body: { error: { code: "internal_error", message: "x" } },
};

function stubApi(
  reply: (request: ApiRequest) => ApiReply | Promise<ApiReply>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const request = {
        method: init?.method ?? "GET",
        path: new URL(input, "http://localhost").pathname,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      const { status, body } = await reply(request);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** El ciclo con su cuadrícula; `write` responde lo que no es leer. */
function stubGrid(
  options: {
    readonly cycle?: ManagedCycle;
    readonly plan?: Plan;
    readonly write?: (request: ApiRequest) => ApiReply;
  } = {},
): void {
  const cycle = options.cycle ?? ACTIVE;
  const plan = options.plan ?? { weeks: [WEEK_TWO], days: DAYS };
  const detailPath = `${CYCLES_PATH}/${cycle.id}`;
  stubApi((request) => {
    if (request.method !== "GET") {
      return options.write === undefined ? FAILURE : options.write(request);
    }
    switch (request.path) {
      case CYCLES_PATH:
        return ok({ cycles: [cycle] });
      case detailPath:
        return ok({ cycle, ...plan });
      case ROUTINES_PATH:
        return ok({ routines: ROUTINES });
      default:
        return FAILURE;
    }
  });
}

function writes(): ApiRequest[] {
  return requests.filter((request) => request.method !== "GET");
}

beforeEach(() => {
  requests.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stubScreenWidth(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderGrid(locale: "en" | "es" = "en"): Promise<void> {
  render(<TrainingPlannerScreen locale={locale} />);
  await screen.findAllByRole("combobox", { name: /^Week 1, Mon/ });
}

function daySelect(name: string): HTMLSelectElement {
  const select = screen.getByRole("combobox", { name });
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`${name} no es un selector`);
  }
  return select;
}

function selectedText(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.textContent ?? "";
}

function grid(): HTMLElement {
  return screen.getByRole("table", {
    name: "Plan of Road to Nationals 2027 by week",
  });
}

function weekToggle(week: number): HTMLElement {
  return within(grid()).getByRole("button", {
    name: `Week ${week}: note and dose`,
  });
}

function weekRow(week: number): HTMLElement {
  const row = weekToggle(week).closest("tr");
  if (row === null) {
    throw new Error(`La semana ${week} no tiene fila`);
  }
  return row;
}

describe("la cuadrícula en el escritorio", () => {
  it("tiene la cabecera WK, DATES y los siete días, y una fila por semana", async () => {
    stubGrid();

    await renderGrid();

    const headers = within(grid())
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Wk",
      "Dates",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(within(grid()).getAllByRole("rowheader")).toHaveLength(28);
    expect(weekRow(3)).toHaveTextContent("26 Oct – 1 Nov");
  });

  it("ofrece descanso, las rutinas del ciclo y las compartidas", async () => {
    stubGrid();

    await renderGrid();

    const options = within(daySelect("Week 1, Wed")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Rest",
      "Gym A",
      "Pool B",
      "Mobility (shared)",
    ]);
  });

  it("deja un día sin rutina en descanso y sin +", async () => {
    stubGrid();

    await renderGrid();

    expect(selectedText(daySelect("Week 1, Wed"))).toBe("Rest");
    expect(
      screen.queryByRole("button", {
        name: "Add a second routine to week 1, Wed",
      }),
    ).not.toBeInTheDocument();
  });

  it("tiñe un día con su rutina y le ofrece el + de la segunda", async () => {
    stubGrid();

    await renderGrid();

    const tuesday = daySelect("Week 1, Tue");
    expect(selectedText(tuesday)).toBe("Gym A");
    expect(tuesday.style.getPropertyValue("--routine-color")).toBe(
      "var(--color-routine-0)",
    );
    expect(
      screen.getByRole("button", {
        name: "Add a second routine to week 1, Tue",
      }),
    ).toBeVisible();
  });

  it("enseña las dos rutinas de un día con dos, sin +", async () => {
    stubGrid();

    await renderGrid();

    expect(selectedText(daySelect("Week 1, Mon"))).toBe("Gym A");
    expect(selectedText(daySelect("Week 1, Mon, second routine"))).toBe(
      "Pool B",
    );
    expect(
      screen.queryByRole("button", {
        name: "Add a second routine to week 1, Mon",
      }),
    ).not.toBeInTheDocument();
  });

  it("abre el segundo selector al pulsar el +", async () => {
    stubGrid();
    const user = userEvent.setup();
    await renderGrid();

    await user.click(
      screen.getByRole("button", {
        name: "Add a second routine to week 1, Tue",
      }),
    );

    const second = daySelect("Week 1, Tue, second routine");
    expect(selectedText(second)).toBe("Rest");
    expect(second).toHaveFocus();
  });
});

describe("guardar un día", () => {
  it("guarda al momento la rutina elegida", async () => {
    stubGrid({
      write: () =>
        ok({
          cycle: ACTIVE,
          weeks: [WEEK_TWO],
          days: [
            ...DAYS,
            { weekNo: 1, weekday: 2, slot: 1, routineId: MOBILITY.id },
          ],
        }),
    });
    const user = userEvent.setup();
    await renderGrid();

    await user.selectOptions(daySelect("Week 1, Wed"), "Mobility (shared)");

    expect(writes()).toEqual([
      {
        method: "PUT",
        path: `${CYCLES_PATH}/${ACTIVE.id}/days`,
        body: { weekNo: 1, weekday: 2, slot: 1, routineId: MOBILITY.id },
      },
    ]);
    expect(selectedText(daySelect("Week 1, Wed"))).toBe("Mobility (shared)");
  });

  it("guarda la segunda rutina en la ranura 2", async () => {
    stubGrid({ write: () => ok({ cycle: ACTIVE, weeks: [], days: DAYS }) });
    const user = userEvent.setup();
    await renderGrid();
    await user.click(
      screen.getByRole("button", {
        name: "Add a second routine to week 1, Tue",
      }),
    );

    await user.selectOptions(
      daySelect("Week 1, Tue, second routine"),
      "Pool B",
    );

    expect(writes().at(0)?.body).toEqual({
      weekNo: 1,
      weekday: 1,
      slot: 2,
      routineId: POOL.id,
    });
  });

  it("vuelve atrás y lo dice si no se guarda", async () => {
    stubGrid({ write: () => FAILURE });
    const user = userEvent.setup();
    await renderGrid();

    await user.selectOptions(daySelect("Week 1, Tue"), "Rest");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that change. Try again.",
    );
    expect(selectedText(daySelect("Week 1, Tue"))).toBe("Gym A");
  });
});

describe("la nota y la dosis de una semana", () => {
  it("abre el editor bajo la fila al pulsar el número de la semana", async () => {
    stubGrid();
    const user = userEvent.setup();
    await renderGrid();
    const toggle = within(weekRow(2)).getByRole("button", {
      name: "Week 2: note and dose",
    });

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const editor = screen.getByRole("group", { name: "Week 2" });
    expect(within(editor).getByLabelText("Note")).toHaveValue("Camp");
    expect(within(editor).getByLabelText("Sets")).toHaveValue("4");
    expect(within(editor).getByLabelText("Reps")).toHaveValue("5");
    expect(within(editor).getByLabelText("Intensity")).toHaveValue("pct");
    expect(within(editor).getByLabelText("Percent")).toHaveValue("80");
    expect(within(editor).getByLabelText("Note")).toHaveAttribute(
      "maxlength",
      "140",
    );
  });

  it("guarda la nota al salir del campo", async () => {
    stubGrid({ write: () => ok({ cycle: ACTIVE, weeks: [], days: DAYS }) });
    const user = userEvent.setup();
    await renderGrid();
    await user.click(
      screen.getByRole("button", { name: "Week 4: note and dose" }),
    );

    await user.type(screen.getByLabelText("Note"), "Test 3RM");
    await user.tab();

    expect(writes()).toEqual([
      {
        method: "PUT",
        path: `${CYCLES_PATH}/${ACTIVE.id}/weeks`,
        body: { weekNo: 4, note: "Test 3RM", dose: null },
      },
    ]);
  });

  it("guarda la dosis con una intensidad de texto", async () => {
    stubGrid({ write: () => ok({ cycle: ACTIVE, weeks: [], days: DAYS }) });
    const user = userEvent.setup();
    await renderGrid();
    await user.click(
      screen.getByRole("button", { name: "Week 4: note and dose" }),
    );

    await user.type(screen.getByLabelText("Sets"), "3");
    await user.type(screen.getByLabelText("Reps"), "8-10");
    await user.selectOptions(screen.getByLabelText("Intensity"), "Text");
    await user.type(screen.getByLabelText("Intensity text"), "RPE 7");
    await user.tab();

    expect(writes().at(-1)?.body).toEqual({
      weekNo: 4,
      note: null,
      dose: {
        sets: 3,
        reps: "8-10",
        intensity: { kind: "text", text: "RPE 7" },
      },
    });
  });

  it("devuelve el campo a lo guardado y lo dice si no se guarda", async () => {
    stubGrid({
      write: () => ({
        status: 400,
        body: {
          error: {
            code: "validation_error",
            message: "x",
            reason: "dose_sets_out_of_range",
          },
        },
      }),
    });
    const user = userEvent.setup();
    await renderGrid();
    await user.click(
      screen.getByRole("button", { name: "Week 2: note and dose" }),
    );

    await user.clear(screen.getByLabelText("Sets"));
    await user.type(screen.getByLabelText("Sets"), "120");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sets go from 1 to 99.",
    );
    expect(screen.getByLabelText("Sets")).toHaveValue("4");
  });

  it("enseña el resumen de la nota y la dosis junto a las fechas", async () => {
    stubGrid();

    await renderGrid();

    expect(weekRow(2)).toHaveTextContent("19 Oct – 25 Oct");
    expect(weekRow(2)).toHaveTextContent("Camp · 4 × 5 · 80%");
  });
});

describe("la semana actual y la última", () => {
  it("marca la fila de la semana de hoy en el ciclo activo", async () => {
    stubGrid();

    await renderGrid();

    expect(weekRow(3)).toHaveAttribute("aria-current", "date");
    expect(weekRow(2)).not.toHaveAttribute("aria-current");
  });

  it("no marca ninguna en un borrador", async () => {
    stubGrid({ cycle: { ...ACTIVE, status: "draft" } });

    await renderGrid();

    expect(weekRow(3)).not.toHaveAttribute("aria-current");
  });

  it("pinta el número de la última semana en el color de aviso", async () => {
    stubGrid();

    await renderGrid();

    expect(
      within(weekRow(28)).getByRole("button", {
        name: "Week 28: note and dose",
      }),
    ).toHaveClass("training-grid-week-last");
    expect(
      within(weekRow(27)).getByRole("button", {
        name: "Week 27: note and dose",
      }),
    ).not.toHaveClass("training-grid-week-last");
  });
});

describe("copiar la semana 1", () => {
  it("copia a las semanas 2 a N − 2 y lo dice", async () => {
    stubGrid({ write: () => ok({ cycle: ACTIVE, weeks: [], days: DAYS }) });
    const user = userEvent.setup();
    await renderGrid();

    await user.click(
      screen.getByRole("button", { name: "Copy week 1 to all weeks" }),
    );

    expect(writes()).toEqual([
      {
        method: "POST",
        path: `${CYCLES_PATH}/${ACTIVE.id}/copy-week-one`,
        body: undefined,
      },
    ]);
    expect(
      await screen.findByText(
        "Week 1 copied to weeks 2–26 · the last 2 weeks were kept",
      ),
    ).toBeInTheDocument();
  });

  it("con 4 semanas copia a la 2", async () => {
    const short = { ...ACTIVE, weeks: 4 };
    stubGrid({
      cycle: short,
      write: () => ok({ cycle: short, weeks: [], days: DAYS }),
    });
    const user = userEvent.setup();
    await renderGrid();

    await user.click(
      screen.getByRole("button", { name: "Copy week 1 to all weeks" }),
    );

    expect(
      await screen.findByText(
        "Week 1 copied to weeks 2–2 · the last 2 weeks were kept",
      ),
    ).toBeInTheDocument();
  });

  it("no está con menos de 4 semanas", async () => {
    stubGrid({ cycle: { ...ACTIVE, weeks: 3 } });

    await renderGrid();

    expect(
      screen.queryByRole("button", { name: "Copy week 1 to all weeks" }),
    ).not.toBeInTheDocument();
  });
});

describe("un ciclo archivado", () => {
  it("enseña la cuadrícula sin dejar cambiarla", async () => {
    stubGrid({ cycle: { ...ACTIVE, status: "archived" } });

    await renderGrid();

    expect(daySelect("Week 1, Wed")).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: "Add a second routine to week 1, Tue",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy week 1 to all weeks" }),
    ).not.toBeInTheDocument();
  });
});

describe("si la cuadrícula no carga", () => {
  it("lo dice y deja volver a intentarlo", async () => {
    let routinesFail = true;
    stubApi((request) => {
      if (request.path === CYCLES_PATH) {
        return ok({ cycles: [ACTIVE] });
      }
      if (request.path === ROUTINES_PATH && routinesFail) {
        return FAILURE;
      }
      return request.path === ROUTINES_PATH
        ? ok({ routines: ROUTINES })
        : ok({ cycle: ACTIVE, weeks: [], days: DAYS });
    });
    const user = userEvent.setup();
    render(<TrainingPlannerScreen locale="en" />);

    expect(
      await screen.findByText("We couldn't load the weeks of this cycle."),
    ).toBeInTheDocument();
    routinesFail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("combobox", { name: "Week 1, Mon" }),
    ).toBeInTheDocument();
  });
});

describe("en español", () => {
  it("dice descanso y compartida", async () => {
    stubGrid();
    render(<TrainingPlannerScreen locale="es" />);

    const select = await screen.findByRole("combobox", {
      name: "Semana 1, mié",
    });

    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Descanso", "Gym A", "Pool B", "Mobility (compartida)"]);
  });
});

/** Por debajo de 1024 px la cuadrícula va una semana a la vez; por debajo
 * de 768, también el resto de la pestaña. */
function stubNarrowScreen(options: { readonly isPhone: boolean }): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      query === "(width < 1024px)" ||
      (options.isPhone && query === "(width < 768px)"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("en la tableta", () => {
  it("va una semana a la vez junto a las tarjetas del escritorio", async () => {
    stubNarrowScreen({ isPhone: false });
    stubGrid();
    render(<TrainingPlannerScreen locale="en" />);

    expect(
      await screen.findByRole("heading", { name: "Week 3 of 28" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Road to Nationals 2027/ }),
    ).toBeInTheDocument();
  });
});

describe("en el móvil", () => {
  beforeEach(() => {
    stubNarrowScreen({ isPhone: true });
  });

  async function renderPhoneGrid(): Promise<void> {
    render(<TrainingPlannerScreen locale="en" />);
    await screen.findByRole("heading", { name: /^Week \d+ of 28$/ });
  }

  it("abre la semana de hoy con sus fechas y sus siete días", async () => {
    stubGrid();

    await renderPhoneGrid();

    expect(
      screen.getByRole("heading", { name: "Week 3 of 28" }),
    ).toBeInTheDocument();
    expect(screen.getByText("26 Oct – 1 Nov")).toBeInTheDocument();
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(daySelect(`Week 3, ${day}`)).toBeInTheDocument();
    }
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("pasa de semana con ‹ › y enseña su nota y su dosis", async () => {
    stubGrid();
    const user = userEvent.setup();
    await renderPhoneGrid();

    await user.click(screen.getByRole("button", { name: "Previous week" }));

    expect(
      screen.getByRole("heading", { name: "Week 2 of 28" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("Camp");
    expect(screen.getByLabelText("Sets")).toHaveValue("4");
  });

  it("enseña las dos rutinas de un día y el + del que tiene una", async () => {
    stubGrid();
    const user = userEvent.setup();
    await renderPhoneGrid();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));

    expect(selectedText(daySelect("Week 1, Mon, second routine"))).toBe(
      "Pool B",
    );
    expect(
      screen.getByRole("button", {
        name: "Add a second routine to week 1, Tue",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Previous week" }),
    ).toBeDisabled();
  });
});
