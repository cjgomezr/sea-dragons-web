import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingScreen } from "@/components/training/TrainingScreen";
import type {
  ActiveTrainingPlanWithCycles,
  TrainingCycle,
} from "@/lib/training/training-plan";
import { stubScreenWidth } from "../../support/screen-width";
import {
  TRAINING_USER_ID,
  cycleOption,
} from "../../support/training-cycle-options";

/**
 * El selector de ciclo de Entrenamiento (#981, RF-6, D6 y D7 de E38). Qué
 * ciclos ve el socio y cuál le toca por defecto lo decide la API (#979): aquí
 * se prueba que la pantalla ofrece la lista que recibe, pide `?cycle=` al
 * elegir, y recuerda la elección en el dispositivo sin depender de él.
 */

const PLAN_PATH = "/api/v1/training/plan";
const MARKS_PATH = "/api/v1/training/marks/me";
const STORAGE_KEY = `seadragons:training-cycle:${TRAINING_USER_ID}`;

function cycleNamed(id: string, name: string): TrainingCycle {
  return {
    id,
    name,
    event: null,
    startDate: "2026-10-12",
    endDate: "2026-11-22",
    weeks: 6,
  };
}

const NATIONALS = cycleNamed("cycle-nationals", "Road to Nationals 2027");
const JUNIORS = cycleNamed("cycle-juniors", "Juniors · State League");
const MASTERS = cycleNamed("cycle-masters", "Masters base block");

const CURRENT = { week: 3, phase: "running", today: "2026-10-27" } as const;
const WEEK_3_DATES = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

/** La semana en curso de `cycle`, con `visible` como la lista que ve. */
function planOf(
  cycle: TrainingCycle,
  visible: readonly TrainingCycle[],
): ActiveTrainingPlanWithCycles {
  return {
    cycle,
    current: CURRENT,
    week: {
      number: 3,
      note: null,
      dose: null,
      days: WEEK_3_DATES.map((date, weekday) => ({
        weekday,
        date,
        routines: [],
      })),
    },
    cycles: visible.map((option) => cycleOption(option, CURRENT)),
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Lo que se le pidió al plan, una entrada por petición. */
const planRequests: URLSearchParams[] = [];

/** Sirve los ciclos que ve el socio: sin `?cycle`, el de entrada (D6); uno
 * que no ve responde 404, como la API (#979). */
function stubVisibleCycles(
  visible: readonly TrainingCycle[],
  defaultCycle: TrainingCycle,
): void {
  stubVisibleCyclesListing(visible, { served: visible, defaultCycle });
}

/** Como `stubVisibleCycles`, pero la lista que manda puede llevar un ciclo
 * que ya no sirve: el que archivaron entre la lista y la elección. */
function stubVisibleCyclesListing(
  listed: readonly TrainingCycle[],
  options: {
    readonly served: readonly TrainingCycle[];
    readonly defaultCycle: TrainingCycle;
  },
): void {
  const { served, defaultCycle } = options;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === MARKS_PATH) {
        return jsonResponse(200, { data: { marks: [] } });
      }
      if (url.pathname !== PLAN_PATH) {
        throw new Error(`Petición inesperada: ${url.pathname}`);
      }
      planRequests.push(url.searchParams);
      const cycleId = url.searchParams.get("cycle") ?? defaultCycle.id;
      if (cycleId.trim() === "") {
        return jsonResponse(400, {
          error: { code: "validation_error", message: "Falta el ciclo." },
        });
      }
      const cycle = served.find((candidate) => candidate.id === cycleId);
      return cycle === undefined
        ? jsonResponse(404, {
            error: { code: "not_found", message: "No ves ese ciclo." },
          })
        : jsonResponse(200, { data: planOf(cycle, listed) });
    }),
  );
}

function requestedCycles(): (string | null)[] {
  return planRequests.map((params) => params.get("cycle"));
}

beforeEach(() => {
  planRequests.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/entrenamiento");
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderScreen(canPlan = false): Promise<void> {
  render(
    <TrainingScreen locale="en" canPlan={canPlan} userId={TRAINING_USER_ID} />,
  );
  await screen.findByRole("heading", { level: 1 });
}

function cyclePicker(): HTMLSelectElement {
  const picker = screen.getByRole("combobox", { name: "Cycle" });
  if (!(picker instanceof HTMLSelectElement)) {
    throw new Error("El selector de ciclo no es un <select>");
  }
  return picker;
}

async function expectCycleShown(cycle: TrainingCycle): Promise<void> {
  expect(
    await screen.findByRole("heading", { level: 1, name: cycle.name }),
  ).toBeInTheDocument();
}

describe("con un solo ciclo", () => {
  it("no enseña selector", async () => {
    stubVisibleCycles([NATIONALS], NATIONALS);

    await renderScreen();

    expect(
      screen.queryByRole("combobox", { name: "Cycle" }),
    ).not.toBeInTheDocument();
  });
});

describe("con dos ciclos o más", () => {
  it("enseña el selector con sus nombres y entra en el de la API", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);

    await renderScreen();

    await expectCycleShown(JUNIORS);
    const picker = cyclePicker();
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([JUNIORS.name, NATIONALS.name]);
    expect(picker).toHaveDisplayValue(JUNIORS.name);
    expect(requestedCycles()).toEqual([null]);
  });

  it("enseña todos los ciclos activos que la API le da a quien planifica", async () => {
    stubVisibleCycles([JUNIORS, MASTERS, NATIONALS], NATIONALS);

    await renderScreen(true);

    expect(within(cyclePicker()).getAllByRole("option")).toHaveLength(3);
  });
});

describe("al elegir otro ciclo", () => {
  it("pide ese ciclo en su semana en curso y lo enseña", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);
    await renderScreen();

    await userEvent.selectOptions(cyclePicker(), NATIONALS.name);

    await expectCycleShown(NATIONALS);
    expect(cyclePicker()).toHaveDisplayValue(NATIONALS.name);
    const last = planRequests.at(-1);
    expect(last?.get("cycle")).toBe(NATIONALS.id);
    expect(last?.get("week")).toBeNull();
  });

  it("lleva el ciclo en la URL", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);
    await renderScreen();

    await userEvent.selectOptions(cyclePicker(), NATIONALS.name);

    await expectCycleShown(NATIONALS);
    expect(window.location.pathname).toBe("/entrenamiento");
    expect(new URLSearchParams(window.location.search).get("cycle")).toBe(
      NATIONALS.id,
    );
  });

  it("sigue en ese ciclo al cambiar de semana", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);
    await renderScreen();
    await userEvent.selectOptions(cyclePicker(), NATIONALS.name);
    await expectCycleShown(NATIONALS);

    await userEvent.click(screen.getByRole("button", { name: "Week 5" }));

    await waitFor(() => {
      expect(planRequests.at(-1)?.get("week")).toBe("5");
    });
    expect(planRequests.at(-1)?.get("cycle")).toBe(NATIONALS.id);
  });
});

describe("la elección recordada", () => {
  it("vuelve a entrar en el ciclo elegido sin ?cycle en la URL", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);
    await renderScreen();
    await userEvent.selectOptions(cyclePicker(), NATIONALS.name);
    await expectCycleShown(NATIONALS);
    window.history.replaceState(null, "", "/entrenamiento");
    planRequests.length = 0;
    cleanup();

    await renderScreen();

    await expectCycleShown(NATIONALS);
    expect(requestedCycles()).toEqual([NATIONALS.id]);
  });

  it("entra en el de la API sin error y la olvida cuando ya no la ve", async () => {
    window.localStorage.setItem(STORAGE_KEY, "cycle-archived");
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);

    await renderScreen();

    await expectCycleShown(JUNIORS);
    expect(requestedCycles()).toEqual(["cycle-archived", null]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("cede ante el ciclo de la URL", async () => {
    window.localStorage.setItem(STORAGE_KEY, JUNIORS.id);
    window.history.replaceState(
      null,
      "",
      `/entrenamiento?cycle=${NATIONALS.id}`,
    );
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);

    await renderScreen();

    await expectCycleShown(NATIONALS);
    expect(requestedCycles()).toEqual([NATIONALS.id]);
  });
});

describe("un ?cycle que no ve", () => {
  it("entra en el ciclo de la API sin error", async () => {
    window.history.replaceState(null, "", "/entrenamiento?cycle=cycle-other");
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);

    await renderScreen();

    await expectCycleShown(JUNIORS);
    expect(requestedCycles()).toEqual(["cycle-other", null]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has("cycle")).toBe(
      false,
    );
  });
});

describe("un ?cycle vacío", () => {
  it("se trata como si no estuviera", async () => {
    window.history.replaceState(null, "", "/entrenamiento?cycle=");
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);

    await renderScreen();

    await expectCycleShown(JUNIORS);
    expect(requestedCycles()).toEqual([null]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("un ciclo elegido que deja de verse antes de llegar", () => {
  it("entra en el de la API sin error y lo olvida del dispositivo y de la URL", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);
    await renderScreen();
    // Lo archivan entre la lista y la elección: la API ya responde 404.
    stubVisibleCyclesListing([JUNIORS, NATIONALS], {
      served: [JUNIORS],
      defaultCycle: JUNIORS,
    });

    await userEvent.selectOptions(cyclePicker(), NATIONALS.name);

    await waitFor(() => {
      expect(requestedCycles().slice(-2)).toEqual([NATIONALS.id, null]);
    });
    await expectCycleShown(JUNIORS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(new URLSearchParams(window.location.search).has("cycle")).toBe(
      false,
    );
  });
});

describe("sin almacenamiento local", () => {
  beforeEach(() => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
  });

  it("entra en el ciclo de la API", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);

    await renderScreen();

    await expectCycleShown(JUNIORS);
  });

  it("deja elegir otro ciclo igual", async () => {
    stubVisibleCycles([JUNIORS, NATIONALS], JUNIORS);
    await renderScreen();

    await userEvent.selectOptions(cyclePicker(), NATIONALS.name);

    await expectCycleShown(NATIONALS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
