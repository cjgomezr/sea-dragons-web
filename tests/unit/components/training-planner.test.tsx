import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * Planificar → Ciclo (#906, RF-7 y D5 del PRD de E35): las tarjetas de los
 * ciclos, el ciclo elegido con sus acciones y sus campos, y la línea que
 * dice cuándo empieza. Lo que vale y lo que se guarda lo decide la API
 * (#904); aquí se prueba que la pantalla pinta lo que responde y le pide lo
 * que toca.
 */

const CYCLES_PATH = "/api/v1/training/manage/cycles";

const ACTIVE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: { name: "UWR Nationals", date: "2027-04-22" },
  ownRoutines: 4,
};

const DRAFT: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Summer base 2027",
  status: "draft",
  weeks: 8,
  startDate: "2027-06-07",
  event: null,
  ownRoutines: 1,
};

const ARCHIVED: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Winter 2026",
  status: "archived",
  weeks: 10,
  startDate: "2026-05-04",
  event: null,
  ownRoutines: 3,
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

const requests: ApiRequest[] = [];
let replyTo: (request: ApiRequest) => ApiReply | Promise<ApiReply>;

function ok(data: unknown, status = 200): ApiReply {
  return { status, body: { data } };
}

function detailOf(cycle: ManagedCycle): unknown {
  return { cycle, weeks: [], days: [] };
}

/** La lista de siempre; cada prueba cambia lo demás. */
function listReply(cycles: readonly ManagedCycle[]): ApiReply {
  return ok({ cycles });
}

function stubApi(
  reply: (request: ApiRequest) => ApiReply | Promise<ApiReply>,
): void {
  replyTo = reply;
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
      const { status, body } = await replyTo(request);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function stubCycles(
  cycles: readonly ManagedCycle[] = [ACTIVE, DRAFT, ARCHIVED],
  other: (request: ApiRequest) => ApiReply | Promise<ApiReply> = () => ({
    status: 500,
    body: { error: { code: "internal_error", message: "x" } },
  }),
): void {
  stubApi((request) =>
    request.method === "GET" && request.path === CYCLES_PATH
      ? listReply(cycles)
      : other(request),
  );
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

async function renderPlanner(locale: "en" | "es" = "en"): Promise<void> {
  render(<TrainingPlannerScreen locale={locale} />);
  await screen.findByRole("tabpanel");
}

function cycleCard(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}`) });
}

function field(name: string | RegExp): HTMLInputElement {
  const input = screen.getByLabelText(name);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`${String(name)} no es un campo`);
  }
  return input;
}

async function replaceValue(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await user.clear(input);
  await user.type(input, value);
  await user.tab();
}

describe("la cabecera y las pestañas", () => {
  it("enseña el antetítulo, el título y a quién llega el plan", async () => {
    stubCycles();

    await renderPlanner();

    expect(screen.getByText("Training · Manage")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Plan training" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Members with an active membership see it."),
    ).toBeInTheDocument();
  });

  it("solo tiene la pestaña Ciclo, elegida, con las semanas del ciclo", async () => {
    stubCycles();

    await renderPlanner();

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveAccessibleName("Cycle 28 wk");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Cycle 28 wk");
  });

  it("habla en español con tú", async () => {
    stubCycles();

    await renderPlanner("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "Planificar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Lo ven los miembros con la membresía activa."),
    ).toBeInTheDocument();
  });
});

describe("las tarjetas de los ciclos en el escritorio", () => {
  it("enseña el activo y el borrador con su estado, sus semanas, sus fechas y sus rutinas", async () => {
    stubCycles();

    await renderPlanner();

    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent(
      "Active28 weeks · 12 Oct – 25 Apr · 4 routines",
    );
    expect(cycleCard("Summer base 2027")).toHaveTextContent(
      "Draft8 weeks · 7 Jun – 1 Aug · 1 routine",
    );
    expect(screen.getByRole("button", { name: "New cycle" })).toBeVisible();
  });

  it("deja los archivados detrás de Show archived, con cuántos son", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();
    expect(
      screen.queryByRole("button", { name: /^Winter 2026/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show archived · 1" }));

    expect(cycleCard("Winter 2026")).toHaveTextContent(
      "Archived10 weeks · 4 May – 12 Jul · 3 routines",
    );
  });

  it("elige el activo al abrir y otro al pulsar su tarjeta", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();
    expect(cycleCard("Road to Nationals 2027")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(cycleCard("Summer base 2027"));

    expect(cycleCard("Summer base 2027")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/^Editing/)).toHaveTextContent(
      "Editing Summer base 2027",
    );
  });
});

describe("las acciones según el estado", () => {
  it("al activo le ofrece Duplicate y Archive, no Make active", async () => {
    stubCycles();

    await renderPlanner();

    expect(screen.getByText(/^Editing/)).toHaveTextContent(
      "Editing Road to Nationals 2027",
    );
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Make active" }),
    ).not.toBeInTheDocument();
  });

  it("al borrador le ofrece también Make active", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(cycleCard("Summer base 2027"));

    expect(screen.getByRole("button", { name: "Make active" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
  });

  it("al archivado solo le ofrece Duplicate, y sus campos son de lectura", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "Show archived · 1" }));
    await user.click(cycleCard("Winter 2026"));

    expect(screen.getByRole("button", { name: "Duplicate" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make active" }),
    ).not.toBeInTheDocument();
    expect(field("Cycle name")).toHaveAttribute("readonly");
  });
});

describe("los campos y la línea calculada", () => {
  it("enseña el nombre, el evento, su fecha y las semanas", async () => {
    stubCycles();

    await renderPlanner();

    expect(field("Cycle name")).toHaveValue("Road to Nationals 2027");
    expect(field("Target event · optional")).toHaveValue("UWR Nationals");
    expect(field("Event first day")).toHaveValue("2027-04-22");
    expect(field("Weeks")).toHaveValue(28);
  });

  it("sin evento pide la fecha de inicio", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(cycleCard("Summer base 2027"));

    expect(field("Target event · optional")).toHaveValue("");
    expect(field("Start date")).toHaveValue("2027-06-07");
  });

  it("dice del activo cuándo empieza, la semana del evento y en cuál están hoy", async () => {
    stubCycles();

    await renderPlanner();

    expect(
      screen.getByText(
        "Week 1 starts Mon 12 Oct · week 28 is event week. Members are in week 3 today.",
      ),
    ).toBeInTheDocument();
  });

  it("dice del borrador cuándo empezaría y que nadie lo ve", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(cycleCard("Summer base 2027"));

    expect(
      screen.getByText(
        "Week 1 would start Mon 7 Jun · draft: members don't see it until you make it active.",
      ),
    ).toBeInTheDocument();
  });

  it("dice del archivado cuándo corrió", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "Show archived · 1" }));
    await user.click(cycleCard("Winter 2026"));

    expect(
      screen.getByText(
        "Ran 4 May – 12 Jul · archived. Duplicate it to reuse it.",
      ),
    ).toBeInTheDocument();
  });

  it("guarda el nombre al salir del campo y pinta lo que responde", async () => {
    const renamed = { ...ACTIVE, name: "Road to Worlds" };
    stubCycles(undefined, () => ok(detailOf(renamed)));
    const user = userEvent.setup();
    await renderPlanner();

    await replaceValue(user, field("Cycle name"), "Road to Worlds");

    expect(await screen.findByText(/^Editing/)).toHaveTextContent(
      "Editing Road to Worlds",
    );
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: `${CYCLES_PATH}/${ACTIVE.id}`,
        body: { name: "Road to Worlds" },
      },
    ]);
  });

  it("no guarda si sale del campo sin cambiarlo", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(field("Cycle name"));
    await user.tab();

    expect(writes()).toEqual([]);
  });

  it("al cambiar la fecha del evento la manda con el evento y actualiza la línea", async () => {
    const moved = {
      ...ACTIVE,
      startDate: "2026-10-19",
      event: { name: "UWR Nationals", date: "2027-04-29" },
    };
    stubCycles(undefined, () => ok(detailOf(moved)));
    const user = userEvent.setup();
    await renderPlanner();

    await replaceValue(user, field("Event first day"), "2027-04-29");

    expect(
      await screen.findByText(
        "Week 1 starts Mon 19 Oct · week 28 is event week. Members are in week 2 today.",
      ),
    ).toBeInTheDocument();
    expect(writes()[0]?.body).toEqual({
      schedule: {
        kind: "event",
        eventName: "UWR Nationals",
        eventDate: "2027-04-29",
      },
    });
  });

  it("al quitar el evento deja el ciclo donde empezaba", async () => {
    stubCycles(undefined, () => ok(detailOf({ ...ACTIVE, event: null })));
    const user = userEvent.setup();
    await renderPlanner();

    await user.clear(field("Target event · optional"));
    await user.tab();

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      schedule: { kind: "start", startDate: "2026-10-12" },
    });
  });

  it("al poner un evento a un ciclo sin él, el evento cae en su última semana", async () => {
    stubCycles(undefined, () =>
      ok(
        detailOf({
          ...DRAFT,
          event: { name: "State Cup", date: "2027-07-26" },
        }),
      ),
    );
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(cycleCard("Summer base 2027"));

    await replaceValue(user, field("Target event · optional"), "State Cup");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      schedule: {
        kind: "event",
        eventName: "State Cup",
        eventDate: "2027-07-26",
      },
    });
  });
});

describe("guardar mientras se escribe en otro campo", () => {
  it("no le quita el foco ni lo escrito al campo siguiente", async () => {
    let resolveSave: (reply: ApiReply) => void = () => {};
    stubCycles(
      undefined,
      () =>
        new Promise<ApiReply>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const user = userEvent.setup();
    await renderPlanner();

    await replaceValue(user, field("Cycle name"), "Road to Worlds");
    await user.clear(field("Target event · optional"));
    await user.type(field("Target event · optional"), "Worlds");
    await act(async () => {
      resolveSave(ok(detailOf({ ...ACTIVE, name: "Road to Worlds" })));
    });

    expect(await screen.findByText(/^Editing/)).toHaveTextContent(
      "Editing Road to Worlds",
    );
    expect(field("Target event · optional")).toHaveFocus();
    expect(field("Target event · optional")).toHaveValue("Worlds");
    expect(field("Cycle name")).toHaveValue("Road to Worlds");
  });

  it("deja abierta la confirmación de las semanas si se guarda otro campo", async () => {
    stubCycles(undefined, (request) => {
      const body = request.body as { readonly weeks?: number };
      return body.weeks === undefined
        ? ok(detailOf({ ...ACTIVE, name: "Road to Worlds" }))
        : {
            status: 409,
            body: {
              error: {
                daysRemoved: 5,
                code: "conflict",
                message: "x",
                reason: "cycle_days_would_be_removed",
              },
            },
          };
    });
    const user = userEvent.setup();
    await renderPlanner();
    await replaceValue(user, field("Weeks"), "20");
    await screen.findByRole("button", { name: "Remove 5 days" });

    await replaceValue(user, field("Cycle name"), "Road to Worlds");

    expect(await screen.findByText(/^Editing/)).toHaveTextContent(
      "Editing Road to Worlds",
    );
    expect(
      screen.getByRole("button", { name: "Remove 5 days" }),
    ).toBeInTheDocument();
    expect(field("Weeks")).toHaveValue(20);
  });

  it("no guarda un nombre que solo cambia en los espacios de los bordes", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.type(field("Cycle name"), " ");
    await user.tab();

    expect(writes()).toEqual([]);
  });
});

describe("bajar las semanas", () => {
  const DAYS_WOULD_BE_REMOVED = {
    status: 409,
    body: {
      error: {
        daysRemoved: 5,
        code: "conflict",
        message: "Bajar las semanas quitaría 5 días con rutina.",
        reason: "cycle_days_would_be_removed",
      },
    },
  };

  function stubWeeksConfirm(): void {
    stubCycles(undefined, (request) => {
      const body = request.body as { readonly confirmRemoval?: boolean };
      return body.confirmRemoval === true
        ? ok(detailOf({ ...ACTIVE, weeks: 20 }))
        : DAYS_WOULD_BE_REMOVED;
    });
  }

  it("pide confirmar diciendo cuántos días se pierden, y al confirmar los quita", async () => {
    stubWeeksConfirm();
    const user = userEvent.setup();
    await renderPlanner();

    await replaceValue(user, field("Weeks"), "20");
    const confirm = await screen.findByRole("group", {
      name: "Going down to 20 weeks removes 5 planned days. This can't be undone.",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Remove 5 days" }),
    );

    await waitFor(() => expect(field("Weeks")).toHaveValue(20));
    expect(writes().map((request) => request.body)).toEqual([
      { weeks: 20 },
      { weeks: 20, confirmRemoval: true },
    ]);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("al cancelar deja las semanas como estaban", async () => {
    stubWeeksConfirm();
    const user = userEvent.setup();
    await renderPlanner();

    await replaceValue(user, field("Weeks"), "20");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(field("Weeks")).toHaveValue(28);
    expect(writes()).toHaveLength(1);
  });
});

describe("un error al guardar", () => {
  it("devuelve el campo a lo que tenía y dice el error", async () => {
    stubCycles(undefined, () => ({
      status: 400,
      body: {
        error: {
          code: "validation_error",
          message: "x",
          reason: "name_required",
        },
      },
    }));
    const user = userEvent.setup();
    await renderPlanner();

    await user.clear(field("Cycle name"));
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Give the cycle a name.",
    );
    expect(field("Cycle name")).toHaveValue("Road to Nationals 2027");
  });

  it("dice un error general si no sabe cuál fue", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await replaceValue(user, field("Weeks"), "30");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that change. Try again.",
    );
    expect(field("Weeks")).toHaveValue(28);
  });
});

describe("las acciones y su aviso", () => {
  const COPY: ManagedCycle = {
    ...ACTIVE,
    id: "aaaaaaaa-0000-4000-8000-000000000004",
    name: "Road to Nationals 2027 (copy)",
    status: "draft",
  };

  function stubDuplicate(): void {
    stubCycles(undefined, () =>
      ok({
        cycles: [ACTIVE, DRAFT, ARCHIVED, COPY],
        duplicatedCycleId: COPY.id,
        routinesCopied: 4,
      }),
    );
  }

  it("duplicar avisa cuántas rutinas copió y abre la copia", async () => {
    stubDuplicate();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Duplicated as a draft · rename it and set the dates · 4 routines copied",
      ),
    );
    expect(screen.getByText(/^Editing/)).toHaveTextContent(
      "Editing Road to Nationals 2027 (copy)",
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `${CYCLES_PATH}/${ACTIVE.id}/duplicate`,
        body: undefined,
      },
    ]);
  });

  it("el aviso se va solo a los 3 segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    stubDuplicate();
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    await renderPlanner();
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    await screen.findByText(/^Duplicated as a draft/);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(
      screen.queryByText(/^Duplicated as a draft/),
    ).not.toBeInTheDocument();
  });

  it("activar un borrador lo pasa a activo y archiva el anterior", async () => {
    stubCycles(undefined, () =>
      ok({
        cycles: [
          { ...ACTIVE, status: "archived" },
          { ...DRAFT, status: "active" },
          ARCHIVED,
        ],
      }),
    );
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(cycleCard("Summer base 2027"));

    await user.click(screen.getByRole("button", { name: "Make active" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Summer base 2027 is active · members see it now",
      ),
    );
    expect(cycleCard("Summer base 2027")).toHaveTextContent("Active");
    expect(
      screen.getByRole("button", { name: "Show archived · 2" }),
    ).toBeVisible();
    expect(writes()[0]?.path).toBe(`${CYCLES_PATH}/${DRAFT.id}/activate`);
  });

  it("archivar deja el ciclo elegido a la vista y lo avisa", async () => {
    stubCycles(undefined, () =>
      ok({ cycles: [{ ...ACTIVE, status: "archived" }, DRAFT, ARCHIVED] }),
    );
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Road to Nationals 2027 archived",
      ),
    );
    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent("Archived");
  });

  it("New cycle crea un borrador y lo abre", async () => {
    const created: ManagedCycle = {
      id: "aaaaaaaa-0000-4000-8000-000000000005",
      name: "New cycle",
      status: "draft",
      weeks: 8,
      startDate: "2026-10-26",
      event: null,
      ownRoutines: 0,
    };
    stubCycles(undefined, () => ok(detailOf(created), 201));
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "New cycle" }));

    expect(await screen.findByText(/^Editing/)).toHaveTextContent(
      "Editing New cycle",
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: CYCLES_PATH,
        body: {
          name: "New cycle",
          weeks: 8,
          schedule: { kind: "start", startDate: "2026-10-28" },
        },
      },
    ]);
  });

  it("dice el error si una acción falla", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that change. Try again.",
    );
  });
});

describe("sin ciclos y sin respuesta", () => {
  it("sin ciclos, invita a crear el primero", async () => {
    stubCycles([]);

    await renderPlanner();

    expect(screen.getByText("No cycles yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New cycle" })).toBeVisible();
  });

  it("si la lista no llega, lo dice y deja reintentar", async () => {
    stubApi(() => ({
      status: 500,
      body: { error: { code: "internal_error", message: "x" } },
    }));
    render(<TrainingPlannerScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the cycles.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("en el móvil", () => {
  beforeEach(() => {
    stubScreenWidth(true);
  });

  function cycleSelect(): HTMLSelectElement {
    const select = screen.getByRole("combobox", { name: "Cycle" });
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("Cycle no es un selector");
    }
    return select;
  }

  it("elige el ciclo con un selector: activo y borradores, y luego los archivados", async () => {
    stubCycles();

    await renderPlanner();

    const select = cycleSelect();
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Road to Nationals 2027 · active",
      "Summer base 2027 · draft",
      "Winter 2026",
    ]);
    expect(
      within(select).getByRole("group", { name: "Archived" }),
    ).toContainElement(
      within(select).getByRole("option", { name: "Winter 2026" }),
    );
    expect(select).toHaveValue(ACTIVE.id);
    expect(
      screen.queryByRole("button", { name: /^Road to Nationals 2027/ }),
    ).not.toBeInTheDocument();
  });

  it("enseña el estado y las semanas, fechas y rutinas del elegido", async () => {
    stubCycles();

    await renderPlanner();

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByText("28 weeks · 12 Oct – 25 Apr · 4 routines"),
    ).toBeInTheDocument();
  });

  it("los campos del activo esperan detrás de Edit name and dates", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();
    expect(screen.queryByLabelText("Cycle name")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Edit name and dates" }),
    );

    expect(field("Cycle name")).toHaveValue("Road to Nationals 2027");
    expect(
      screen.getByRole("button", { name: "Edit name and dates" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("los campos del borrador están siempre a la vista, con Make active", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.selectOptions(cycleSelect(), DRAFT.id);

    expect(field("Cycle name")).toHaveValue("Summer base 2027");
    expect(
      screen.queryByRole("button", { name: "Edit name and dates" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make active" })).toBeVisible();
  });

  it("los del archivado son de lectura y no se pueden archivar", async () => {
    stubCycles();
    const user = userEvent.setup();
    await renderPlanner();

    await user.selectOptions(cycleSelect(), ARCHIVED.id);

    expect(field("Cycle name")).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });

  it("tiene Duplicate, Archive, + para un ciclo nuevo y la línea calculada", async () => {
    stubCycles();

    await renderPlanner();

    expect(screen.getByRole("button", { name: "Duplicate" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New cycle" })).toBeVisible();
    expect(
      screen.getByText(
        "Week 1 starts Mon 12 Oct · week 28 is event week. Members are in week 3 today.",
      ),
    ).toBeInTheDocument();
  });
});
