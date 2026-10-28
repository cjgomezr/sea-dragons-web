import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type {
  ManagedRoutine,
  RoutineEditorItem,
} from "@/lib/training/club-routines";
import { stubScreenSize } from "../../support/screen-width";

/**
 * Planificar → Rutinas (#908, RF-9, D8 y D9 del PRD de E35): el filtro, la
 * lista, el editor de filas con sus secciones y el orden. Lo que vale y lo
 * que se guarda lo decide la API (#905); aquí se prueba que la pantalla
 * pinta lo que responde y le pide lo que toca.
 */

const API = "/api/v1/training/manage";
const CYCLES_PATH = `${API}/cycles`;
const ROUTINES_PATH = `${API}/routines`;
const MARKS_PATH = `${API}/marks`;

const ACTIVE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: null,
  ownRoutines: 1,
};

const DRAFT: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Summer base 2027",
  status: "draft",
  weeks: 8,
  startDate: "2027-06-07",
  event: null,
  ownRoutines: 0,
};

const ARCHIVED: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Winter 2026",
  status: "archived",
  weeks: 10,
  startDate: "2026-05-04",
  event: null,
  ownRoutines: 0,
};

const MARK = {
  id: "1b2c3d4e-0000-4000-8000-000000000001",
  name: "Back squat",
};

const STRENGTH: ManagedRoutine = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: "Gym A · Strength",
  cycleId: ACTIVE.id,
  colorIndex: 1,
  itemCount: 3,
  daysUsed: 27,
};

const MOBILITY: ManagedRoutine = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Mobility",
  cycleId: null,
  colorIndex: 4,
  itemCount: 2,
  daysUsed: 0,
};

const NEW_ROUTINE_ID = "bbbbbbbb-0000-4000-8000-000000000003";

const STRENGTH_ITEMS: readonly RoutineEditorItem[] = [
  { kind: "section", title: "Main" },
  {
    kind: "exercise",
    exercise: {
      id: "e0e0e0e0-0000-4000-8000-000000000001",
      name: "Back squat",
      photoUrl: null,
    },
    sets: 4,
    reps: "6",
    rest: "2:00",
    note: null,
    load: { kind: "pct", markId: MARK.id, pct: 75 },
  },
  {
    kind: "exercise",
    exercise: {
      id: "e0e0e0e0-0000-4000-8000-000000000002",
      name: "Pull-up",
      photoUrl: null,
    },
    sets: 3,
    reps: "max",
    rest: "1:30",
    note: "Slow down",
    load: { kind: "text", text: "Bodyweight" },
  },
];

type ApiReply = { readonly status: number; readonly body: unknown };
type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
};

const requests: ApiRequest[] = [];
let routines: ManagedRoutine[];
let items: Map<string, readonly RoutineEditorItem[]>;
let failWrites: boolean;

function ok(data: unknown, status = 200): ApiReply {
  return { status, body: { data } };
}

const SERVER_ERROR: ApiReply = {
  status: 500,
  body: { error: { code: "internal_error", message: "x" } },
};

function listRoutines(search: string): ApiReply {
  const params = new URLSearchParams(search);
  const cycleId = params.get("cycle");
  const shared = routines.filter((routine) => routine.cycleId === null);
  const own = routines.filter(
    (routine) => cycleId !== null && routine.cycleId === cycleId,
  );
  return ok({ routines: [...own, ...shared] });
}

function routineIdIn(path: string): string {
  const id = path.slice(ROUTINES_PATH.length + 1).split("/")[0];
  if (id === undefined) {
    throw new Error(`Sin rutina en ${path}`);
  }
  return id;
}

function findRoutine(id: string): ManagedRoutine {
  const routine = routines.find((candidate) => candidate.id === id);
  if (routine === undefined) {
    throw new Error(`No hay rutina ${id}`);
  }
  return routine;
}

function createRoutine(body: { name: string; cycleId: string | null }) {
  const routine: ManagedRoutine = {
    id: NEW_ROUTINE_ID,
    name: body.name,
    cycleId: body.cycleId,
    colorIndex: 2,
    itemCount: 0,
    daysUsed: 0,
  };
  routines.push(routine);
  return ok({ routine }, 201);
}

function deleteRoutine(request: ApiRequest): ApiReply {
  const routine = findRoutine(routineIdIn(request.path));
  if (routine.daysUsed > 0 && !request.search.includes("confirm=true")) {
    return {
      status: 409,
      body: {
        error: {
          code: "conflict",
          message: "x",
          reason: "routine_in_use",
          daysUsed: routine.daysUsed,
        },
      },
    };
  }
  routines = routines.filter((candidate) => candidate.id !== routine.id);
  return ok({ routineId: routine.id, daysCleared: routine.daysUsed });
}

function routineWrite(request: ApiRequest): ApiReply {
  const routine = findRoutine(routineIdIn(request.path));
  if (request.method === "PUT") {
    const saved = (request.body as { items: unknown[] }).items;
    return ok({
      routine: { ...routine, itemCount: saved.length },
      items: saved,
    });
  }
  if (request.method === "PATCH") {
    const { name } = request.body as { name: string };
    routines = routines.map((candidate) =>
      candidate.id === routine.id ? { ...candidate, name } : candidate,
    );
    return ok({ routine: { ...routine, name } });
  }
  return deleteRoutine(request);
}

function reply(request: ApiRequest): ApiReply {
  const { method, path } = request;
  if (method === "GET" && path === CYCLES_PATH) {
    return ok({ cycles: [ACTIVE, DRAFT, ARCHIVED] });
  }
  if (method === "GET" && path === MARKS_PATH) {
    return ok({ marks: [MARK] });
  }
  if (method === "GET" && path === ROUTINES_PATH) {
    return listRoutines(request.search);
  }
  if (method === "GET" && path.endsWith("/items")) {
    const id = routineIdIn(path);
    return ok({ routine: findRoutine(id), items: items.get(id) ?? [] });
  }
  if (failWrites) {
    return SERVER_ERROR;
  }
  if (method === "POST" && path === ROUTINES_PATH) {
    return createRoutine(request.body as { name: string; cycleId: null });
  }
  return routineWrite(request);
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const request = {
        method: init?.method ?? "GET",
        path: url.pathname,
        search: url.search,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      const { status, body } = reply(request);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function writes(): ApiRequest[] {
  return requests.filter((request) => request.method !== "GET");
}

function lastSavedItems(): unknown[] {
  const saves = writes().filter((request) => request.method === "PUT");
  const last = saves.at(-1);
  if (last === undefined) {
    throw new Error("No se guardó ninguna fila");
  }
  return (last.body as { items: unknown[] }).items;
}

beforeEach(() => {
  requests.length = 0;
  routines = [STRENGTH, MOBILITY];
  items = new Map([[STRENGTH.id, STRENGTH_ITEMS]]);
  failWrites = false;
  stubApi();
  stubScreenSize("desktop");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openRoutinesTab(
  user: ReturnType<typeof userEvent.setup>,
  locale: "en" | "es" = "en",
): Promise<void> {
  render(<TrainingPlannerScreen locale={locale} />);
  await user.click(
    await screen.findByRole("tab", {
      name: locale === "en" ? "Routines" : "Rutinas",
    }),
  );
}

/** Con la rutina de fuerza abierta en el editor. */
async function openStrength(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await openRoutinesTab(user);
  await screen.findByRole("textbox", { name: "Routine name" });
  await screen.findByRole("combobox", { name: "Load for Back squat" });
}

function routineButton(name: string): HTMLElement {
  return within(screen.getByRole("list", { name: "Routines" })).getByRole(
    "button",
    { name: new RegExp(`^${name}`) },
  );
}

describe("la pestaña Rutinas", () => {
  it("está junto a Ciclo y al pulsarla se elige", async () => {
    const user = userEvent.setup();

    await openRoutinesTab(user);

    expect(screen.getByRole("tab", { name: "Routines" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /^Cycle/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("se elige también con las flechas desde la pestaña Ciclo", async () => {
    const user = userEvent.setup();
    render(<TrainingPlannerScreen locale="en" />);
    const cycleTab = await screen.findByRole("tab", { name: /^Cycle/ });

    cycleTab.focus();
    await user.keyboard("{ArrowRight}");

    const routinesTab = screen.getByRole("tab", { name: "Routines" });
    expect(routinesTab).toHaveFocus();
    expect(routinesTab).toHaveAttribute("aria-selected", "true");
  });

  it("enseña el filtro con el activo, el borrador, las compartidas y los archivados aparte, sin All", async () => {
    const user = userEvent.setup();

    await openRoutinesTab(user);

    const filter = await screen.findByRole("combobox", { name: "Routines of" });
    const options = within(filter).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Road to Nationals 2027 · active",
      "Summer base 2027 · draft",
      "Shared routines only",
      "Winter 2026",
    ]);
    expect(
      within(filter).getByRole("group", { name: "Archived cycles" }),
    ).toContainElement(
      within(filter).getByRole("option", { name: "Winter 2026" }),
    );
    expect(filter).toHaveValue(ACTIVE.id);
    expect(
      screen.getByText(
        "A cycle shows its own routines plus the shared ones. Changing a shared routine changes it everywhere.",
      ),
    ).toBeInTheDocument();
  });

  it("habla en español", async () => {
    const user = userEvent.setup();

    await openRoutinesTab(user, "es");

    expect(
      await screen.findByRole("combobox", { name: "Rutinas de" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Solo rutinas compartidas" }),
    ).toBeInTheDocument();
  });
});

describe("la lista", () => {
  it("enseña las del ciclo y al final las compartidas, con su cuenta y la etiqueta Shared", async () => {
    const user = userEvent.setup();

    await openRoutinesTab(user);

    const list = await screen.findByRole("list", { name: "Routines" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Gym A · Strength3 exercises · used 27×",
      "Mobility2 exercises · used 0×Shared",
    ]);
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: ROUTINES_PATH,
        search: `?cycle=${ACTIVE.id}`,
      }),
    );
  });

  it("al elegir las compartidas pide solo esas y ofrece una compartida nueva", async () => {
    const user = userEvent.setup();
    await openRoutinesTab(user);

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Routines of" }),
      "Shared routines only",
    );

    await waitFor(() =>
      expect(screen.queryByText("Gym A · Strength")).not.toBeInTheDocument(),
    );
    expect(requests).toContainEqual(
      expect.objectContaining({ path: ROUTINES_PATH, search: "?scope=shared" }),
    );
    expect(
      screen.getByRole("button", { name: "New shared routine" }),
    ).toBeInTheDocument();
  });

  it("abre la primera en el editor y otra al pulsarla", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(routineButton("Mobility"));

    expect(
      await screen.findByRole("textbox", { name: "Routine name" }),
    ).toHaveValue("Mobility");
    expect(routineButton("Mobility")).toHaveAttribute("aria-pressed", "true");
  });

  it("vacía, dice que no hay rutinas y que cree una para el ciclo", async () => {
    routines = [];
    const user = userEvent.setup();

    await openRoutinesTab(user);

    expect(await screen.findByText("No routines here yet")).toBeInTheDocument();
    expect(screen.getByText("Create one for this cycle.")).toBeInTheDocument();
  });

  it("New routine in this cycle la crea en el ciclo y la abre", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(
      screen.getByRole("button", { name: "New routine in this cycle" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Routine name" })).toHaveValue(
        "New routine",
      ),
    );
    expect(writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        body: { name: "New routine", cycleId: ACTIVE.id },
      }),
    ]);
    expect(routineButton("New routine")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("New shared routine la crea sin ciclo", async () => {
    const user = userEvent.setup();
    await openRoutinesTab(user);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Routines of" }),
      "Shared routines only",
    );

    await user.click(
      await screen.findByRole("button", { name: "New shared routine" }),
    );

    await waitFor(() =>
      expect(writes()).toEqual([
        expect.objectContaining({
          method: "POST",
          body: { name: "New routine", cycleId: null },
        }),
      ]),
    );
  });
});

describe("el editor", () => {
  it("enseña el nombre y la tabla con sus columnas", async () => {
    const user = userEvent.setup();

    await openStrength(user);

    expect(screen.getByRole("textbox", { name: "Routine name" })).toHaveValue(
      "Gym A · Strength",
    );
    for (const column of ["Exercise", "Sets", "Reps / dist.", "Rest", "Load"]) {
      expect(screen.getByText(column)).toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Section title" })).toHaveValue(
      "Main",
    );
    expect(screen.getByText("Back squat")).toBeInTheDocument();
  });

  it("renombra la rutina al salir del campo", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    const name = screen.getByRole("textbox", { name: "Routine name" });

    await user.clear(name);
    await user.type(name, "Gym A · Heavy");
    await user.tab();

    await waitFor(() =>
      expect(writes()).toEqual([
        expect.objectContaining({
          method: "PATCH",
          body: { name: "Gym A · Heavy" },
        }),
      ]),
    );
    expect(routineButton("Gym A · Heavy")).toBeInTheDocument();
  });

  it("guarda las series al salir, y solo admite cifras", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    const sets = screen.getByRole("textbox", { name: "Sets for Back squat" });

    await user.clear(sets);
    await user.type(sets, "5x");
    await user.tab();

    expect(sets).toHaveValue("5");
    await waitFor(() => expect(lastSavedItems()[1]).toMatchObject({ sets: 5 }));
  });

  it.each([
    ["Reps or distance for Back squat", "50 m", { reps: "50 m" }],
    ["Rest for Back squat", "3:00", { rest: "3:00" }],
    [
      "Note for Back squat",
      "Pause at the bottom",
      { note: "Pause at the bottom" },
    ],
  ])("guarda %s al salir", async (label, value, expected) => {
    const user = userEvent.setup();
    await openStrength(user);
    const field = screen.getByRole("textbox", { name: label });

    await user.clear(field);
    await user.type(field, value);
    await user.tab();

    await waitFor(() => expect(lastSavedItems()[1]).toMatchObject(expected));
  });

  it("no guarda si sale de un campo sin cambiarlo", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(
      screen.getByRole("textbox", { name: "Rest for Back squat" }),
    );
    await user.tab();

    expect(writes()).toEqual([]);
  });

  it("ofrece sin carga, % y dosis de la semana de cada marca, y texto", async () => {
    const user = userEvent.setup();

    await openStrength(user);

    const load = screen.getByRole("combobox", { name: "Load for Back squat" });
    expect(
      within(load)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "No load",
      "% of Back squat",
      "Week dose of Back squat",
      "Text…",
    ]);
  });

  it("con %, enseña el porcentaje y lo guarda al salir", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    const pct = screen.getByRole("textbox", {
      name: "Percentage for Back squat",
    });
    expect(pct).toHaveValue("75");

    await user.clear(pct);
    await user.type(pct, "80");
    await user.tab();

    await waitFor(() =>
      expect(lastSavedItems()[1]).toMatchObject({
        load: { kind: "pct", markId: MARK.id, pct: 80 },
      }),
    );
  });

  it("la dosis de la semana se guarda al elegirla, sin campo", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Load for Back squat" }),
      "Week dose of Back squat",
    );

    await waitFor(() =>
      expect(lastSavedItems()[1]).toMatchObject({
        load: { kind: "week", markId: MARK.id },
      }),
    );
    expect(
      screen.queryByRole("textbox", { name: "Percentage for Back squat" }),
    ).not.toBeInTheDocument();
  });

  it("sin carga se guarda al elegirla", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Load for Pull-up" }),
      "No load",
    );

    await waitFor(() =>
      expect(lastSavedItems()[2]).toMatchObject({ load: { kind: "none" } }),
    );
    expect(
      screen.queryByRole("textbox", { name: "Load text for Pull-up" }),
    ).not.toBeInTheDocument();
  });

  it("con texto, enseña su campo y guarda lo escrito al salir", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Load for Back squat" }),
      "Text…",
    );
    const text = screen.getByRole("textbox", {
      name: "Load text for Back squat",
    });
    expect(writes()).toEqual([]);
    await user.type(text, "Bodyweight");
    await user.tab();

    await waitFor(() =>
      expect(lastSavedItems()[1]).toMatchObject({
        load: { kind: "text", text: "Bodyweight" },
      }),
    );
  });

  it("el % sin marca elegida antes espera a que se escriba un porcentaje", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Load for Pull-up" }),
      "% of Back squat",
    );
    const pct = screen.getByRole("textbox", { name: "Percentage for Pull-up" });
    expect(pct).toHaveValue("");
    expect(writes()).toEqual([]);
    await user.type(pct, "70");
    await user.tab();

    await waitFor(() =>
      expect(lastSavedItems()[2]).toMatchObject({
        load: { kind: "pct", markId: MARK.id, pct: 70 },
      }),
    );
  });

  it("borra una fila con su papelera", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(screen.getByRole("button", { name: "Delete Pull-up" }));

    await waitFor(() => expect(lastSavedItems()).toHaveLength(2));
    expect(screen.queryByText("Pull-up")).not.toBeInTheDocument();
  });
});

describe("las secciones", () => {
  it("+ Add section añade una fila de título y la guarda", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(screen.getByRole("button", { name: "Add section" }));

    await waitFor(() =>
      expect(lastSavedItems().at(-1)).toEqual({
        kind: "section",
        title: "New section",
      }),
    );
    expect(
      screen.getAllByRole("textbox", { name: "Section title" }),
    ).toHaveLength(2);
  });

  it("su título se escribe y se guarda al salir", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    const title = screen.getByRole("textbox", { name: "Section title" });

    await user.clear(title);
    await user.type(title, "Warm up");
    await user.tab();

    await waitFor(() =>
      expect(lastSavedItems()[0]).toEqual({
        kind: "section",
        title: "Warm up",
      }),
    );
  });

  it("un título vacío no se guarda y vuelve al que tenía", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    const title = screen.getByRole("textbox", { name: "Section title" });

    await user.clear(title);
    await user.tab();

    expect(title).toHaveValue("Main");
    expect(writes()).toEqual([]);
  });

  it("se borra con su papelera", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(screen.getByRole("button", { name: "Delete Main" }));

    await waitFor(() => expect(lastSavedItems()).toHaveLength(2));
  });
});

describe("el orden", () => {
  it("↑ en el asa sube la fila, la guarda y deja el foco en el asa", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    const handle = screen.getByRole("button", {
      name: "Reorder Back squat, position 2 of 3",
    });

    handle.focus();
    await user.keyboard("{ArrowUp}");

    await waitFor(() =>
      expect(
        lastSavedItems().map((item) => (item as { kind: string }).kind),
      ).toEqual(["exercise", "section", "exercise"]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Reorder Back squat, position 1 of 3",
        }),
      ).toHaveFocus(),
    );
  });

  it("↓ en el asa de una sección la baja", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    screen
      .getByRole("button", { name: "Reorder Main, position 1 of 3" })
      .focus();
    await user.keyboard("{ArrowDown}");

    await waitFor(() =>
      expect(lastSavedItems()[1]).toEqual({ kind: "section", title: "Main" }),
    );
  });

  it("↑ en la primera no hace nada", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    screen
      .getByRole("button", { name: "Reorder Main, position 1 of 3" })
      .focus();
    await user.keyboard("{ArrowUp}");

    expect(writes()).toEqual([]);
  });
});

describe("un error al guardar", () => {
  it("devuelve las filas a lo que tenían y dice el error", async () => {
    failWrites = true;
    const user = userEvent.setup();
    await openStrength(user);
    const sets = screen.getByRole("textbox", { name: "Sets for Back squat" });

    await user.clear(sets);
    await user.type(sets, "9");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that change. Try again.",
    );
    expect(sets).toHaveValue("4");
  });
});

describe("borrar una rutina", () => {
  it("usada en la cuadrícula, pide confirmar con los días que pasan a descanso", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(screen.getByRole("button", { name: "Delete routine" }));

    expect(
      await screen.findByText("Used on 27 days. Those days become Rest."),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Delete anyway" }));

    await waitFor(() =>
      expect(screen.queryByText("Gym A · Strength")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      expect.objectContaining({ method: "DELETE", search: "?confirm=true" }),
    ]);
  });

  it("al cancelar no la borra", async () => {
    const user = userEvent.setup();
    await openStrength(user);

    await user.click(screen.getByRole("button", { name: "Delete routine" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByText("Used on 27 days. Those days become Rest."),
    ).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("sin usar, la borra sin preguntar", async () => {
    const user = userEvent.setup();
    await openStrength(user);
    await user.click(routineButton("Mobility"));
    await screen.findByDisplayValue("Mobility");

    await user.click(screen.getByRole("button", { name: "Delete routine" }));

    await waitFor(() =>
      expect(screen.queryByText("Mobility")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      expect.objectContaining({ method: "DELETE", search: "" }),
    ]);
  });
});

describe("en la tableta", () => {
  beforeEach(() => {
    stubScreenSize("tablet");
  });

  it("enseña la lista y el editor, con una tarjeta por fila", async () => {
    const user = userEvent.setup();

    await openStrength(user);

    expect(routineButton("Mobility")).toBeInTheDocument();
    const squat = screen
      .getByRole("button", { name: "Delete Back squat" })
      .closest("li");
    if (squat === null) {
      throw new Error("Falta la tarjeta de Back squat");
    }
    expect(within(squat).getByText("Reps / distance")).toBeInTheDocument();
  });
});

describe("en el móvil", () => {
  beforeEach(() => {
    stubScreenSize("phone");
  });

  it("enseña la lista sin editor hasta que se toca una rutina", async () => {
    const user = userEvent.setup();

    await openRoutinesTab(user);

    expect(await screen.findByText("Gym A · Strength")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Routine name" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New routine in this cycle" }),
    ).toBeInTheDocument();
  });

  it("al tocar una rutina abre el editor con ‹ Routines, el nombre y una tarjeta por fila", async () => {
    const user = userEvent.setup();
    await openRoutinesTab(user);

    await user.click(await screen.findByRole("button", { name: /^Gym A/ }));

    expect(
      await screen.findByRole("button", { name: "Routines" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("textbox", { name: "Routine name" }),
    ).toHaveValue("Gym A · Strength");
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    const squat = cards[1];
    if (squat === undefined) {
      throw new Error("Falta la tarjeta de Back squat");
    }
    for (const name of [
      "Reorder Back squat, position 2 of 3",
      "Delete Back squat",
    ]) {
      expect(within(squat).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(squat).getByText("Sets")).toBeInTheDocument();
    expect(within(squat).getByText("Reps / distance")).toBeInTheDocument();
  });

  it("‹ Routines vuelve a la lista", async () => {
    const user = userEvent.setup();
    await openRoutinesTab(user);
    await user.click(await screen.findByRole("button", { name: /^Gym A/ }));

    await user.click(await screen.findByRole("button", { name: "Routines" }));

    expect(await screen.findByText("Mobility")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Routine name" }),
    ).not.toBeInTheDocument();
  });

  it("una rutina nueva se abre directamente en el editor", async () => {
    const user = userEvent.setup();
    await openRoutinesTab(user);

    await user.click(
      await screen.findByRole("button", { name: "New routine in this cycle" }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Routine name" }),
    ).toHaveValue("New routine");
  });
});
