import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type { ManagedMark } from "@/lib/training/club-marks";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * Planificar → Marcas (#911, RF-11 y D11 del PRD de E35; §5.1 "Tab Marks" y
 * §5.2 del handoff): la lista de marcas con cuánto se usan, renombrar en la
 * fila, los tres casos de borrar, añadir y el pie. Qué vale y qué se guarda
 * lo decide la API (#903); aquí se prueba que la pantalla pinta lo que
 * responde y le pide lo que toca.
 */

const CYCLES_PATH = "/api/v1/training/manage/cycles";
const MARKS_PATH = "/api/v1/training/manage/marks";

const CYCLE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: null,
  ownRoutines: 4,
};

const BACK_SQUAT: ManagedMark = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: "Back squat",
  unit: "kg",
  routineRows: 1,
  membersRecorded: 12,
};

const DEADLIFT: ManagedMark = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Deadlift",
  unit: "kg",
  routineRows: 2,
  membersRecorded: 1,
};

const FRONT_SQUAT: ManagedMark = {
  id: "bbbbbbbb-0000-4000-8000-000000000003",
  name: "Front squat",
  unit: "kg",
  routineRows: 0,
  membersRecorded: 0,
};

const BENCH_PRESS: ManagedMark = {
  id: "bbbbbbbb-0000-4000-8000-000000000004",
  name: "Bench press",
  unit: "kg",
  routineRows: 0,
  membersRecorded: 3,
};

const MARKS = [BACK_SQUAT, DEADLIFT, FRONT_SQUAT, BENCH_PRESS];

type ApiReply = { readonly status: number; readonly body: unknown };
type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
};

const requests: ApiRequest[] = [];

function ok(data: unknown, status = 200): ApiReply {
  return { status, body: { data } };
}

const SERVER_ERROR: ApiReply = {
  status: 500,
  body: { error: { code: "internal_error", message: "x" } },
};

/** Los ciclos y las marcas de siempre; `write` responde lo demás. */
function stubApi(
  options: {
    readonly marks?: ApiReply;
    readonly write?: (request: ApiRequest) => ApiReply;
  } = {},
): void {
  const marksReply = options.marks ?? ok({ marks: MARKS });
  const write = options.write ?? (() => SERVER_ERROR);
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
      const reply =
        request.method !== "GET"
          ? write(request)
          : request.path === CYCLES_PATH
            ? ok({ cycles: [CYCLE] })
            : request.path === MARKS_PATH
              ? marksReply
              : SERVER_ERROR;
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function writes(): ApiRequest[] {
  return requests.filter((request) => request.method !== "GET");
}

beforeEach(() => {
  requests.length = 0;
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openMarks(
  locale: "en" | "es" = "en",
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<TrainingPlannerScreen locale={locale} />);
  await user.click(await screen.findByRole("tab", { name: /^(Marks|Marcas)/ }));
  return user;
}

function markRow(name: string): HTMLElement {
  const row = screen
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) {
    throw new Error(`no hay fila para ${name}`);
  }
  return row;
}

describe("la pestaña Marks", () => {
  it("sale junto a Cycle con cuántas marcas hay, y al pulsarla se elige", async () => {
    stubApi();

    await openMarks();

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Cycle 28 wk",
      "Exercises",
      "Marks 4",
    ]);
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Marks 4");
  });

  it("se cambia con las flechas del teclado, como manda un tablist", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<TrainingPlannerScreen locale="en" />);
    const cycleTab = await screen.findByRole("tab", { name: /^Cycle/ });

    cycleTab.focus();
    // Marks es la última (#910): ← desde la primera da la vuelta hasta ella.
    await user.keyboard("{ArrowLeft}");

    const marksTab = screen.getByRole("tab", { name: /^Marks/ });
    expect(marksTab).toHaveFocus();
    expect(marksTab).toHaveAttribute("aria-selected", "true");
  });

  it("enseña el texto de entrada, una fila por marca con su uso y el pie", async () => {
    stubApi();

    await openMarks();

    expect(
      screen.getByText(
        'The lifts your members can record (their best single lift, in kg). Routines use "% of" a mark to show each person their own kilos. Members only see marks you list here.',
      ),
    ).toBeVisible();
    expect(
      within(markRow("Back squat")).getByText(
        "Used in 1 exercise · 12 members recorded it",
      ),
    ).toBeVisible();
    expect(
      within(markRow("Deadlift")).getByText(
        "Used in 2 exercises · 1 member recorded it",
      ),
    ).toBeVisible();
    expect(
      within(markRow("Front squat")).getByText(
        "Not in any routine · Nobody recorded it yet",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Coaches and admins never see members' values. Only each member does.",
      ),
    ).toBeVisible();
  });

  it("cada fila tiene Rename y Delete con el nombre de la marca", async () => {
    stubApi();

    await openMarks();

    const row = markRow("Front squat");
    expect(
      within(row).getByRole("button", { name: "Rename Front squat" }),
    ).toBeEnabled();
    expect(
      within(row).getByRole("button", { name: "Delete Front squat" }),
    ).toBeEnabled();
  });

  it("habla en español con tú", async () => {
    stubApi();

    await openMarks("es");

    expect(
      within(markRow("Back squat")).getByText(
        "Usada en 1 ejercicio · la registraron 12 miembros",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Renombrar Back squat" }),
    ).toBeVisible();
  });

  it("si las marcas no llegan, lo dice y deja reintentar", async () => {
    stubApi({ marks: SERVER_ERROR });

    const user = await openMarks();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't load the marks.",
    );
    stubApi();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Back squat")).toBeVisible();
  });
});

describe("renombrar", () => {
  it("cambia el nombre por un campo con ✓ y ×, con la pista", async () => {
    stubApi();
    const user = await openMarks();

    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));

    const field = screen.getByRole("textbox", {
      name: "New name for Back squat",
    });
    expect(field).toHaveValue("Back squat");
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "Save name" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel rename" })).toBeVisible();
    expect(
      screen.getByText("Routines and members' values follow the new name."),
    ).toBeVisible();
  });

  it("Enter guarda el nombre nuevo y pinta la lista que responde", async () => {
    stubApi({
      write: () => ok({ marks: [{ ...BACK_SQUAT, name: "Squat" }, DEADLIFT] }),
    });
    const user = await openMarks();
    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));
    const field = screen.getByRole("textbox", {
      name: "New name for Back squat",
    });

    await user.clear(field);
    await user.type(field, "Squat{Enter}");

    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: `${MARKS_PATH}/${BACK_SQUAT.id}`,
        search: "",
        body: { name: "Squat" },
      },
    ]);
    expect(await screen.findByText("Squat")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /^New name/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Rename Squat" })).toHaveFocus();
  });

  it("Esc cancela sin mandar nada y devuelve el foco a Rename", async () => {
    stubApi();
    const user = await openMarks();
    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));

    await user.type(
      screen.getByRole("textbox", { name: "New name for Back squat" }),
      "x{Escape}",
    );

    expect(writes()).toEqual([]);
    expect(screen.getByText("Back squat")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Rename Back squat" }),
    ).toHaveFocus();
  });

  it("× cancela igual que Esc", async () => {
    stubApi();
    const user = await openMarks();
    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));

    await user.click(screen.getByRole("button", { name: "Cancel rename" }));

    expect(writes()).toEqual([]);
    expect(screen.queryByRole("textbox", { name: /^New name/ })).toBeNull();
  });

  it("guardar el mismo nombre cierra el campo sin mandar nada", async () => {
    stubApi();
    const user = await openMarks();
    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));

    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(writes()).toEqual([]);
    expect(screen.queryByRole("textbox", { name: /^New name/ })).toBeNull();
  });

  it("si el servidor ve el nombre repetido, lo dice y deja el campo abierto", async () => {
    stubApi({
      write: () => ({
        status: 409,
        body: {
          error: { code: "conflict", message: "x", reason: "mark_name_taken" },
        },
      }),
    });
    const user = await openMarks();
    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));
    const field = screen.getByRole("textbox", {
      name: "New name for Back squat",
    });

    await user.clear(field);
    await user.type(field, "Clean{Enter}");

    expect(
      await screen.findByText(`There's already a mark called "Clean".`),
    ).toBeVisible();
    expect(field).toHaveValue("Clean");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un nombre de otra marca se dice y no se manda", async () => {
    stubApi();
    const user = await openMarks();
    await user.click(screen.getByRole("button", { name: "Rename Back squat" }));
    const field = screen.getByRole("textbox", {
      name: "New name for Back squat",
    });

    await user.clear(field);
    await user.type(field, "deadlift{Enter}");

    expect(writes()).toEqual([]);
    expect(field).toHaveAccessibleDescription(
      'There\'s already a mark called "deadlift".',
    );
  });
});

describe("borrar", () => {
  it("una usada en una rutina tiene Delete desactivado y dice por qué", async () => {
    stubApi();
    const user = await openMarks();

    const remove = screen.getByRole("button", { name: "Delete Back squat" });
    await user.click(remove);

    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAccessibleDescription(
      "In use: change those routine rows first",
    );
    expect(writes()).toEqual([]);
  });

  it("una sin usar y sin valores se borra al pulsar Delete", async () => {
    stubApi({
      write: () => ok({ marks: [BACK_SQUAT, DEADLIFT, BENCH_PRESS] }),
    });
    const user = await openMarks();

    await user.click(
      screen.getByRole("button", { name: "Delete Front squat" }),
    );

    expect(writes()).toEqual([
      {
        method: "DELETE",
        path: `${MARKS_PATH}/${FRONT_SQUAT.id}`,
        search: "",
        body: undefined,
      },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Front squat deleted",
    );
    expect(screen.queryByText("Front squat")).toBeNull();
  });

  it("una sin usar que registraron 3 socios pide confirmar en línea, sin nombres ni valores", async () => {
    stubApi();
    const user = await openMarks();

    await user.click(
      screen.getByRole("button", { name: "Delete Bench press" }),
    );

    expect(writes()).toEqual([]);
    const confirm = within(markRow("Bench press")).getByRole("group", {
      name: "Delete Bench press",
    });
    expect(confirm).toHaveTextContent(
      '3 members recorded "Bench press". Their values will be deleted too. This can\'t be undone.',
    );
    expect(
      within(confirm).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(
      within(confirm).getByRole("button", { name: "Delete mark" }),
    ).toBeVisible();
    expect(within(confirm).queryByText(/kg|\d+\.\d/)).toBeNull();
  });

  it("Delete mark la borra con sus valores", async () => {
    stubApi({
      write: () => ok({ marks: [BACK_SQUAT, DEADLIFT, FRONT_SQUAT] }),
    });
    const user = await openMarks();
    await user.click(
      screen.getByRole("button", { name: "Delete Bench press" }),
    );

    await user.click(screen.getByRole("button", { name: "Delete mark" }));

    expect(writes()).toEqual([
      {
        method: "DELETE",
        path: `${MARKS_PATH}/${BENCH_PRESS.id}`,
        search: "?confirm=true",
        body: undefined,
      },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Bench press deleted",
    );
  });

  it("Cancel cierra la confirmación sin borrar", async () => {
    stubApi();
    const user = await openMarks();
    await user.click(
      screen.getByRole("button", { name: "Delete Bench press" }),
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(writes()).toEqual([]);
    expect(
      screen.queryByRole("group", { name: "Delete Bench press" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Delete Bench press" }),
    ).toHaveFocus();
  });

  it("si otra persona la puso en una rutina entretanto, lo dice", async () => {
    stubApi({
      write: () => ({
        status: 409,
        body: {
          error: { code: "conflict", message: "x", reason: "mark_in_use" },
        },
      }),
    });
    const user = await openMarks();

    await user.click(
      screen.getByRole("button", { name: "Delete Front squat" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That mark is in a routine now: change those routine rows first.",
    );
  });

  it("si la pusieron en una rutina con la confirmación abierta, la cierra", async () => {
    stubApi({
      write: () => ({
        status: 409,
        body: {
          error: { code: "conflict", message: "x", reason: "mark_in_use" },
        },
      }),
    });
    const user = await openMarks();
    await user.click(
      screen.getByRole("button", { name: "Delete Bench press" }),
    );

    await user.click(screen.getByRole("button", { name: "Delete mark" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Delete Bench press" }),
    ).toBeNull();
  });
});

describe("añadir", () => {
  it("Power clean y Enter la crean al final", async () => {
    const created: ManagedMark = {
      id: "bbbbbbbb-0000-4000-8000-000000000005",
      name: "Power clean",
      unit: "kg",
      routineRows: 0,
      membersRecorded: 0,
    };
    stubApi({ write: () => ok({ marks: [...MARKS, created] }, 201) });
    const user = await openMarks();
    const field = screen.getByRole("textbox", { name: "New mark" });
    expect(field).toHaveAttribute("placeholder", "New mark, e.g. Power clean");

    await user.type(field, "Power clean{Enter}");

    expect(writes()).toEqual([
      {
        method: "POST",
        path: MARKS_PATH,
        search: "",
        body: { name: "Power clean" },
      },
    ]);
    expect(await screen.findByText("Power clean")).toBeVisible();
    expect(field).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Power clean added");
    expect(screen.getByRole("tab", { name: "Marks 5" })).toBeVisible();
  });

  it("un nombre repetido se dice y no se crea", async () => {
    stubApi();
    const user = await openMarks();
    const field = screen.getByRole("textbox", { name: "New mark" });

    await user.type(field, "BACK SQUAT{Enter}");

    expect(writes()).toEqual([]);
    expect(field).toHaveAccessibleDescription(
      'There\'s already a mark called "BACK SQUAT".',
    );
  });

  it("si el servidor ve el nombre repetido, lo dice igual", async () => {
    stubApi({
      write: () => ({
        status: 409,
        body: {
          error: { code: "conflict", message: "x", reason: "mark_name_taken" },
        },
      }),
    });
    const user = await openMarks();
    const field = screen.getByRole("textbox", { name: "New mark" });

    await user.type(field, "Clean{Enter}");

    expect(
      await screen.findByText('There\'s already a mark called "Clean".'),
    ).toBeVisible();
    expect(field).toHaveValue("Clean");
  });

  it("no manda un nombre vacío", async () => {
    stubApi();
    const user = await openMarks();

    await user.type(
      screen.getByRole("textbox", { name: "New mark" }),
      "   {Enter}",
    );

    expect(writes()).toEqual([]);
  });
});

describe("en el móvil", () => {
  beforeEach(() => {
    stubScreenWidth(true);
  });

  it("tiene las mismas filas, la confirmación y el añadir", async () => {
    stubApi();
    const user = await openMarks();

    await user.click(
      screen.getByRole("button", { name: "Delete Bench press" }),
    );

    expect(
      screen.getByRole("button", { name: "Rename Back squat" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete mark" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "New mark" })).toBeVisible();
  });
});
