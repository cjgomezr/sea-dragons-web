import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type { ManagedExercise } from "@/lib/training/club-exercises";
import type { LastDose, ManagedRoutine } from "@/lib/training/club-routines";
import { type ScreenSize, stubScreenSize } from "../../support/screen-width";

/**
 * La fila de añadir del editor de rutinas (#909, RF-9 del PRD de E35; §5.1
 * "Add row" y §5.2 del handoff): busca en la biblioteca y en el club, añade
 * con la última dosis del club o crea el ejercicio con el nombre escrito.
 * Lo que casa y lo que se guarda lo decide la API (#903, #905); aquí se
 * prueba que la pantalla pinta lo que responde y le pide lo que toca.
 */

const API = "/api/v1/training/manage";
const CYCLES_PATH = `${API}/cycles`;
const ROUTINES_PATH = `${API}/routines`;
const MARKS_PATH = `${API}/marks`;
const EXERCISES_PATH = `${API}/exercises`;

const MARK = {
  id: "1b2c3d4e-0000-4000-8000-000000000001",
  name: "Back squat",
};

const ACTIVE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: null,
  ownRoutines: 1,
};

const STRENGTH: ManagedRoutine = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: "Gym A · Strength",
  cycleId: ACTIVE.id,
  colorIndex: 1,
  itemCount: 0,
  daysUsed: 0,
};

function exercise(
  index: number,
  name: string,
  source: ManagedExercise["source"] = "library",
): ManagedExercise {
  return {
    id: `e0e0e0e0-0000-4000-8000-00000000000${index}`,
    name,
    source,
    tips: [],
    youtube: null,
    thumbnailUrl: index === 1 ? "https://img.test/squat.jpg" : null,
    photoUrls: { start: null, end: null },
    routines: [],
  };
}

const SQUATS: readonly ManagedExercise[] = [
  exercise(1, "Back squat"),
  exercise(2, "Front squat"),
  exercise(3, "Goblet squat", "club"),
  exercise(4, "Split squat"),
  exercise(5, "Box squat"),
  exercise(6, "Overhead squat"),
  exercise(7, "Pistol squat"),
  exercise(8, "Zercher squat"),
];

const SQUAT_DOSE: LastDose = {
  sets: 4,
  reps: "6",
  rest: "2:00",
  load: { kind: "pct", markId: MARK.id, pct: 75 },
};

const CREATED_ID = "e0e0e0e0-0000-4000-8000-000000000099";

type ApiReply = { readonly status: number; readonly body: unknown };
type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly body: unknown;
};

const requests: ApiRequest[] = [];
let failSearch: boolean;
let failLastDose: boolean;
let isNameTaken: boolean;

function ok(data: unknown, status = 200): ApiReply {
  return { status, body: { data } };
}

const SERVER_ERROR: ApiReply = {
  status: 500,
  body: { error: { code: "internal_error", message: "x" } },
};

function searchExercises(params: URLSearchParams): ApiReply {
  if (failSearch) {
    return SERVER_ERROR;
  }
  const text = (params.get("q") ?? "").toLowerCase();
  const found = SQUATS.filter((candidate) =>
    candidate.name.toLowerCase().includes(text),
  );
  return ok({
    exercises: found,
    counts: { library: found.length, club: 0 },
    nextOffset: null,
  });
}

const NAME_TAKEN: ApiReply = {
  status: 409,
  body: {
    error: { code: "conflict", message: "x", reason: "exercise_name_taken" },
  },
};

function createExercise(body: unknown): ApiReply {
  if (isNameTaken) {
    return NAME_TAKEN;
  }
  const { name } = body as { name: string };
  return ok({ ...exercise(9, name, "club"), id: CREATED_ID }, 201);
}

function lastDose(path: string): ApiReply {
  if (failLastDose) {
    return SERVER_ERROR;
  }
  const isSquat = path.includes(SQUATS[0]?.id ?? "");
  return ok({ dose: isSquat ? SQUAT_DOSE : null });
}

function reply(request: ApiRequest): ApiReply {
  const { method, path } = request;
  if (path === CYCLES_PATH) {
    return ok({ cycles: [ACTIVE] });
  }
  if (path === MARKS_PATH) {
    return ok({ marks: [MARK] });
  }
  if (path === ROUTINES_PATH) {
    return ok({ routines: [STRENGTH] });
  }
  if (path === EXERCISES_PATH) {
    return method === "POST"
      ? createExercise(request.body)
      : searchExercises(request.params);
  }
  if (path.endsWith("/last-dose")) {
    return lastDose(path);
  }
  if (method === "PUT") {
    const saved = (request.body as { items: unknown[] }).items;
    return ok({ routine: { ...STRENGTH, itemCount: saved.length } });
  }
  return ok({ routine: STRENGTH, items: [] });
}

function readBody(body: RequestInit["body"]): unknown {
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  return body instanceof FormData ? Object.fromEntries(body) : undefined;
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const request = {
        method: init?.method ?? "GET",
        path: url.pathname,
        params: url.searchParams,
        body: readBody(init?.body),
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

/** Las búsquedas con texto: la pestaña Ejercicios pide su lista sin él. */
function searches(): ApiRequest[] {
  return requests.filter(
    (request) =>
      request.method === "GET" &&
      request.path === EXERCISES_PATH &&
      request.params.get("q") !== "",
  );
}

function savedItems(): unknown[] {
  const last = requests.filter((request) => request.method === "PUT").at(-1);
  if (last === undefined) {
    throw new Error("No se guardó ninguna fila");
  }
  return (last.body as { items: unknown[] }).items;
}

beforeEach(() => {
  requests.length = 0;
  failSearch = false;
  failLastDose = false;
  isNameTaken = false;
  stubApi();
  stubScreenSize("desktop");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Con la rutina de fuerza, vacía, abierta en el editor. */
async function openEditor(
  user: ReturnType<typeof userEvent.setup>,
  size: ScreenSize = "desktop",
): Promise<HTMLElement> {
  stubScreenSize(size);
  render(<TrainingPlannerScreen locale="en" />);
  await user.click(await screen.findByRole("tab", { name: "Routines" }));
  if (size === "phone") {
    await user.click(
      await screen.findByRole("button", { name: /^Gym A · Strength/ }),
    );
  }
  return screen.findByRole("combobox", { name: "Add exercise" });
}

async function search(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  size: ScreenSize = "desktop",
): Promise<HTMLElement> {
  const field = await openEditor(user, size);
  await user.type(field, text);
  return field;
}

describe("buscar", () => {
  it("enseña hasta 6 resultados con miniatura, nombre y origen", async () => {
    const user = userEvent.setup();

    await search(user, "squat");

    const results = await screen.findByRole("listbox", {
      name: "Add exercise",
    });
    const options = within(results).getAllByRole("option");
    expect(options).toHaveLength(6);
    expect(options[0]).toHaveTextContent("Back squatLibrary");
    expect(options[2]).toHaveTextContent("Goblet squatClub");
    expect(options[0]?.querySelector("img")).toHaveAttribute(
      "src",
      "https://img.test/squat.jpg",
    );
    expect(
      screen.getByRole("combobox", { name: "Add exercise" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("espera a que se deje de escribir para buscar una sola vez", async () => {
    const user = userEvent.setup();

    await search(user, "squat");

    await screen.findByRole("listbox", { name: "Add exercise" });
    expect(searches().map((request) => request.params.get("q"))).toEqual([
      "squat",
    ]);
  });

  it("en el escritorio, el desplegable cuelga del campo", async () => {
    const user = userEvent.setup();

    await search(user, "squat");

    const results = await screen.findByRole("listbox", {
      name: "Add exercise",
    });
    expect(results.closest("[data-placement]")).toHaveAttribute(
      "data-placement",
      "popover",
    );
  });

  it("si la búsqueda falla, lo dice", async () => {
    failSearch = true;
    const user = userEvent.setup();

    await search(user, "squat");

    expect(
      await screen.findByText("We couldn't search the exercises."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Create/ }),
    ).not.toBeInTheDocument();
  });
});

describe("elegir un resultado", () => {
  it("añade la fila con la última dosis que el club usó", async () => {
    const user = userEvent.setup();
    await search(user, "squat");

    await user.click(
      await screen.findByRole("option", { name: /^Back squat/ }),
    );

    await waitFor(() =>
      expect(savedItems()).toEqual([
        {
          kind: "exercise",
          exerciseId: SQUATS[0]?.id,
          sets: 4,
          reps: "6",
          rest: "2:00",
          note: null,
          load: { kind: "pct", markId: MARK.id, pct: 75 },
        },
      ]),
    );
    expect(
      await screen.findByRole("combobox", { name: "Load for Back squat" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add exercise" })).toHaveValue(
      "",
    );
  });

  it("deja la fila vacía si el club nunca lo usó", async () => {
    const user = userEvent.setup();
    await search(user, "squat");

    await user.click(
      await screen.findByRole("option", { name: /^Front squat/ }),
    );

    await waitFor(() =>
      expect(savedItems()).toEqual([
        {
          kind: "exercise",
          exerciseId: SQUATS[1]?.id,
          sets: null,
          reps: null,
          rest: null,
          note: null,
          load: { kind: "none" },
        },
      ]),
    );
  });

  it("si no llega la última dosis, no añade la fila y lo dice", async () => {
    failLastDose = true;
    const user = userEvent.setup();
    await search(user, "squat");

    await user.click(
      await screen.findByRole("option", { name: /^Back squat/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that change. Try again.",
    );
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });
});

describe("sin resultados", () => {
  it('dice que no hay ninguno y ofrece Create "{q}"', async () => {
    const user = userEvent.setup();

    await search(user, "Sled push");

    expect(
      await screen.findByText('No exercise called "Sled push".'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'Create "Sled push"' }),
    ).toBeInTheDocument();
  });

  it("Create crea el ejercicio del club, lo añade y lo dice", async () => {
    const user = userEvent.setup();
    await search(user, "Sled push");

    await user.click(
      await screen.findByRole("button", { name: 'Create "Sled push"' }),
    );

    await waitFor(() =>
      expect(savedItems()).toEqual([
        expect.objectContaining({ exerciseId: CREATED_ID, sets: null }),
      ]),
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: EXERCISES_PATH,
        body: expect.objectContaining({ name: "Sled push" }),
      }),
    );
    expect(
      await screen.findByText(
        '"Sled push" created as a club exercise and added. Add tips or a photo in Exercises.',
      ),
    ).toBeInTheDocument();
  });
});

describe("crear sin resultados", () => {
  it("añade la fila vacía sin pedir la última dosis", async () => {
    const user = userEvent.setup();
    await search(user, "Sled push");

    await user.click(
      await screen.findByRole("button", { name: 'Create "Sled push"' }),
    );

    await waitFor(() =>
      expect(savedItems()).toEqual([
        {
          kind: "exercise",
          exerciseId: CREATED_ID,
          sets: null,
          reps: null,
          rest: null,
          note: null,
          load: { kind: "none" },
        },
      ]),
    );
    expect(
      requests.some((request) => request.path.endsWith("/last-dose")),
    ).toBe(false);
  });

  it("si el nombre ya existe, lo dice, no añade la fila y deja lo escrito", async () => {
    isNameTaken = true;
    const user = userEvent.setup();
    const field = await search(user, "Sled push");

    await user.click(
      await screen.findByRole("button", { name: 'Create "Sled push"' }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "There is already an exercise with that name.",
    );
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
    expect(field).toHaveValue("Sled push");
  });
});

describe("el teclado", () => {
  it("↓ y Enter eligen el resultado marcado", async () => {
    const user = userEvent.setup();
    const field = await search(user, "squat");
    await screen.findByRole("listbox", { name: "Add exercise" });

    await user.keyboard("{ArrowDown}");
    const marked = screen.getByRole("option", { name: /^Front squat/ });
    expect(field).toHaveAttribute("aria-activedescendant", marked.id);
    expect(marked).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(savedItems()).toEqual([
        expect.objectContaining({ exerciseId: SQUATS[1]?.id }),
      ]),
    );
  });

  it("↑ desde el primero va al último", async () => {
    const user = userEvent.setup();
    const field = await search(user, "squat");
    await screen.findByRole("listbox", { name: "Add exercise" });

    await user.keyboard("{ArrowUp}");

    expect(field).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /^Overhead squat/ }).id,
    );
  });

  it("Esc cierra el desplegable", async () => {
    const user = userEvent.setup();
    const field = await search(user, "squat");
    await screen.findByRole("listbox", { name: "Add exercise" });

    await user.keyboard("{Escape}");

    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("listbox", { name: "Add exercise" }),
    ).not.toBeInTheDocument();
  });
});

describe("en el móvil", () => {
  it("los resultados van en línea y siguen a la vista sin el foco", async () => {
    const user = userEvent.setup();
    const field = await search(user, "squat", "phone");

    const results = await screen.findByRole("listbox", {
      name: "Add exercise",
    });
    field.blur();

    expect(results.closest("[data-placement]")).toHaveAttribute(
      "data-placement",
      "inline",
    );
    expect(
      screen.getByRole("listbox", { name: "Add exercise" }),
    ).toBeInTheDocument();
  });

  it("sin resultados, enseña la fila de Create", async () => {
    const user = userEvent.setup();

    await search(user, "Sled push", "phone");

    expect(
      await screen.findByRole("button", { name: 'Create "Sled push"' }),
    ).toBeInTheDocument();
  });
});
