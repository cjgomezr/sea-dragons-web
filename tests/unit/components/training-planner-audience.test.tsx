import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import { GROUPS_PATH } from "@/lib/auth/routes";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * Para quién es cada ciclo en Planificar (#980, RF-5 y D3/D9 del PRD de
 * E38): el campo "For", la audiencia en la lista y en el selector, y la
 * confirmación de los ciclos que se archivan cuando activar o cambiar los
 * grupos choca (409 `cycle_conflicts` de la API, #978).
 */

const CYCLES_PATH = "/api/v1/training/manage/cycles";
const ROUTINES_PATH = "/api/v1/training/manage/routines";
const GROUPS_API_PATH = "/api/v1/groups";

const JUNIORS = { id: "bbbbbbbb-0000-4000-8000-000000000001", name: "Juniors" };
const MASTERS = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Masters" };

const ACTIVE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: { name: "UWR Nationals", date: "2027-04-22" },
  ownRoutines: 4,
  audience: { kind: "club" },
};

const DRAFT: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Summer base 2027",
  status: "draft",
  weeks: 8,
  startDate: "2027-06-07",
  event: null,
  ownRoutines: 1,
  audience: { kind: "club" },
};

const JUNIORS_CYCLE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000004",
  name: "Juniors block",
  status: "draft",
  weeks: 6,
  startDate: "2027-01-04",
  event: null,
  ownRoutines: 0,
  audience: { kind: "groups", groups: [JUNIORS, MASTERS] },
};

const ORPHAN_CYCLE: ManagedCycle = {
  ...JUNIORS_CYCLE,
  id: "aaaaaaaa-0000-4000-8000-000000000005",
  name: "Orphan block",
  audience: { kind: "groups", groups: [] },
};

const ARCHIVED: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Winter 2026",
  status: "archived",
  weeks: 10,
  startDate: "2026-05-04",
  event: null,
  ownRoutines: 3,
  audience: { kind: "club" },
};

/** Las 12:00 del miércoles 28 de octubre de 2026 en Melbourne. */
const NOW = new Date("2026-10-28T01:00:00.000Z");

type ApiReply = { readonly status: number; readonly body: unknown };
type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
};
type Responder = (request: ApiRequest) => ApiReply;

const requests: ApiRequest[] = [];

function ok(data: unknown): ApiReply {
  return { status: 200, body: { data } };
}

function conflictsReply(conflicts: readonly ManagedCycle[]): ApiReply {
  return {
    status: 409,
    body: {
      error: {
        code: "conflict",
        message: "x",
        reason: "cycle_conflicts",
        conflicts: conflicts.map(({ id, name }) => ({ id, name })),
      },
    },
  };
}

const SERVER_ERROR: ApiReply = {
  status: 500,
  body: { error: { code: "internal_error", message: "x" } },
};

function readRequest(input: string, init?: RequestInit): ApiRequest {
  const url = new URL(input, "http://localhost");
  return {
    method: init?.method ?? "GET",
    path: url.pathname,
    search: url.search,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

function readsReply(
  request: ApiRequest,
  cycles: readonly ManagedCycle[],
  groups: readonly { readonly id: string; readonly name: string }[],
): ApiReply {
  if (request.path === CYCLES_PATH) {
    return ok({ cycles });
  }
  if (request.path === GROUPS_API_PATH) {
    return ok({
      groups: groups.map((group) => ({ ...group, memberCount: 3 })),
    });
  }
  const cycle = cycles.find(
    (candidate) => request.path === `${CYCLES_PATH}/${candidate.id}`,
  );
  if (cycle !== undefined) {
    return ok({ cycle, weeks: [], days: [] });
  }
  return request.path === ROUTINES_PATH ? ok({ routines: [] }) : SERVER_ERROR;
}

function stubApi({
  cycles = [ACTIVE, DRAFT, JUNIORS_CYCLE, ARCHIVED],
  groups = [JUNIORS, MASTERS],
  write = () => SERVER_ERROR,
}: {
  readonly cycles?: readonly ManagedCycle[];
  readonly groups?: readonly { readonly id: string; readonly name: string }[];
  readonly write?: Responder;
} = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const request = readRequest(input, init);
      requests.push(request);
      const { status, body } =
        request.method === "GET"
          ? readsReply(request, cycles, groups)
          : write(request);
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
  // El campo For cambia de caja cuando llegan los grupos del club.
  await waitFor(() =>
    expect(
      screen.queryByText(/^(Loading the groups|Cargando los grupos)/),
    ).not.toBeInTheDocument(),
  );
}

function cycleCard(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}`) });
}

function audienceField(): HTMLElement {
  return screen.getByRole("group", { name: "For" });
}

async function openCycle(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  await user.click(cycleCard(name));
}

async function chooseGroups(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(
    await within(audienceField()).findByRole("radio", {
      name: "Specific groups",
    }),
  );
}

function conflictConfirm(): HTMLElement {
  return screen.getByRole("group", { name: /will be archived/ });
}

describe("el campo For", () => {
  it("un ciclo de todo el club lo abre con The whole club elegido", async () => {
    stubApi();

    await renderPlanner();

    const field = audienceField();
    expect(
      await within(field).findByRole("radio", { name: "The whole club" }),
    ).toBeChecked();
    expect(
      await within(field).findByRole("radio", { name: "Specific groups" }),
    ).not.toBeChecked();
    expect(within(field).queryAllByRole("checkbox")).toEqual([]);
  });

  it("un ciclo nuevo viene para todo el club", async () => {
    const created: ManagedCycle = {
      ...DRAFT,
      id: "aaaaaaaa-0000-4000-8000-000000000009",
      name: "New cycle",
    };
    stubApi({
      write: (request) =>
        request.path === CYCLES_PATH
          ? ok({ cycle: created, weeks: [], days: [] })
          : SERVER_ERROR,
    });
    const user = userEvent.setup();
    await renderPlanner();

    await user.click(screen.getByRole("button", { name: "New cycle" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Cycle name")).toHaveValue("New cycle"),
    );
    expect(
      within(audienceField()).getByRole("radio", { name: "The whole club" }),
    ).toBeChecked();
  });

  it("con Specific groups enseña los grupos del club para marcar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderPlanner();

    await chooseGroups(user);

    expect(within(audienceField()).getAllByRole("checkbox")).toHaveLength(2);
    expect(
      within(audienceField()).getByRole("checkbox", { name: "Juniors" }),
    ).not.toBeChecked();
    expect(
      within(audienceField()).getByRole("checkbox", { name: "Masters" }),
    ).not.toBeChecked();
  });

  it("un ciclo de grupos abre con sus grupos marcados", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderPlanner();

    await openCycle(user, "Juniors block");

    const field = audienceField();
    expect(
      await within(field).findByRole("radio", { name: "Specific groups" }),
    ).toBeChecked();
    expect(
      within(field).getByRole("checkbox", { name: "Juniors" }),
    ).toBeChecked();
    expect(
      within(field).getByRole("checkbox", { name: "Masters" }),
    ).toBeChecked();
  });

  it("sin grupos marcados, Save dice Choose at least one group y no envía", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderPlanner();
    await chooseGroups(user);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(audienceField()).toHaveTextContent("Choose at least one group");
    expect(writes()).toEqual([]);
  });

  it("Save manda los grupos marcados y la tarjeta los enseña", async () => {
    stubApi({
      write: () =>
        ok({
          cycle: { ...ACTIVE, audience: { kind: "groups", groups: [JUNIORS] } },
        }),
    });
    const user = userEvent.setup();
    await renderPlanner();
    await chooseGroups(user);
    await user.click(
      within(audienceField()).getByRole("checkbox", { name: "Juniors" }),
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `${CYCLES_PATH}/${ACTIVE.id}`,
          search: "",
          body: { audience: { kind: "groups", groupIds: [JUNIORS.id] } },
        },
      ]),
    );
    await waitFor(() =>
      expect(cycleCard("Road to Nationals 2027")).toHaveTextContent("Juniors"),
    );
  });

  it("volver a todo el club desde un ciclo de grupos lo manda", async () => {
    stubApi({
      write: () =>
        ok({ cycle: { ...JUNIORS_CYCLE, audience: { kind: "club" } } }),
    });
    const user = userEvent.setup();
    await renderPlanner();
    await openCycle(user, "Juniors block");

    await user.click(
      within(audienceField()).getByRole("radio", { name: "The whole club" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writes()[0]?.body).toEqual({ audience: { kind: "club" } }),
    );
  });

  it("sin cambios no ofrece Save", async () => {
    stubApi();

    await renderPlanner();

    await within(audienceField()).findByRole("radio", {
      name: "Specific groups",
    });
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("en un club sin grupos solo ofrece todo el club, con una pista y el enlace a Groups", async () => {
    stubApi({ groups: [] });

    await renderPlanner();

    const field = audienceField();
    await waitFor(() =>
      expect(field).toHaveTextContent("The club has no groups yet"),
    );
    expect(within(field).getAllByRole("radio")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Create groups in Groups" }),
    ).toHaveAttribute("href", GROUPS_PATH);
  });

  it("los de un archivado no se pueden cambiar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(screen.getByRole("button", { name: "Show archived · 1" }));

    await openCycle(user, "Winter 2026");

    expect(
      await within(audienceField()).findByRole("radio", {
        name: "The whole club",
      }),
    ).toBeDisabled();
  });
});

describe("la audiencia en la lista", () => {
  it("cada tarjeta dice su estado y para quién es", async () => {
    stubApi();

    await renderPlanner();

    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent("Active");
    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent("Whole club");
    expect(cycleCard("Juniors block")).toHaveTextContent("Draft");
    expect(cycleCard("Juniors block")).toHaveTextContent("Juniors, Masters");
  });

  it("un ciclo de grupos sin grupos avisa de que nadie lo ve", async () => {
    stubApi({ cycles: [ACTIVE, ORPHAN_CYCLE] });

    await renderPlanner();

    expect(cycleCard("Orphan block")).toHaveTextContent(
      "No groups: no member sees it",
    );
  });

  it("en el móvil, el selector lista los activos con su audiencia", async () => {
    stubScreenWidth(true);
    const juniorsActive: ManagedCycle = {
      ...JUNIORS_CYCLE,
      status: "active",
    };
    stubApi({ cycles: [ACTIVE, juniorsActive, ORPHAN_CYCLE, ARCHIVED] });

    await renderPlanner();

    const select = screen.getByRole("combobox", { name: "Cycle" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Road to Nationals 2027 · active · Whole club",
      "Juniors block · active · Juniors, Masters",
      "Orphan block · draft · No groups: no member sees it",
      "Winter 2026 · Whole club",
    ]);
  });

  it("en el móvil, el elegido dice para quién es", async () => {
    stubScreenWidth(true);
    stubApi();

    await renderPlanner();

    expect(screen.getByText("Whole club")).toBeInTheDocument();
  });
});

describe("activar con choque", () => {
  const AFTER_CONFIRM: readonly ManagedCycle[] = [
    { ...ACTIVE, status: "archived" },
    { ...DRAFT, status: "active" },
    JUNIORS_CYCLE,
    ARCHIVED,
  ];

  function activateWithConflict(request: ApiRequest): ApiReply {
    return request.search === "?confirm=true"
      ? ok({ cycles: AFTER_CONFIRM })
      : conflictsReply([ACTIVE]);
  }

  async function activateDraft(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await openCycle(user, "Summer base 2027");
    await user.click(screen.getByRole("button", { name: "Make active" }));
  }

  it("un 409 abre la confirmación con los ciclos que se archivan y enfoca Cancel", async () => {
    stubApi({ write: activateWithConflict });
    const user = userEvent.setup();
    await renderPlanner();

    await activateDraft(user);

    const confirm = await screen.findByRole("group", {
      name: /will be archived/,
    });
    expect(confirm).toHaveTextContent("Road to Nationals 2027");
    expect(
      within(confirm).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(writes()).toHaveLength(1);
  });

  it("nombra todos los que chocan", async () => {
    stubApi({ write: () => conflictsReply([ACTIVE, JUNIORS_CYCLE]) });
    const user = userEvent.setup();
    await renderPlanner();

    await activateDraft(user);

    const confirm = await screen.findByRole("group", {
      name: /will be archived/,
    });
    expect(confirm).toHaveTextContent(
      "Road to Nationals 2027, Juniors block will be archived",
    );
  });

  it("Cancel no cambia nada", async () => {
    stubApi({ write: activateWithConflict });
    const user = userEvent.setup();
    await renderPlanner();
    await activateDraft(user);
    await screen.findByRole("group", { name: /will be archived/ });

    await user.click(
      within(conflictConfirm()).getByRole("button", { name: "Cancel" }),
    );

    expect(
      screen.queryByRole("group", { name: /will be archived/ }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent("Active");
    expect(cycleCard("Summer base 2027")).toHaveTextContent("Draft");
  });

  it("Confirm envía confirm=true, lo activa y archiva los que chocaban", async () => {
    stubApi({ write: activateWithConflict });
    const user = userEvent.setup();
    await renderPlanner();
    await activateDraft(user);
    await screen.findByRole("group", { name: /will be archived/ });

    await user.click(
      within(conflictConfirm()).getByRole("button", { name: "Make active" }),
    );

    await waitFor(() =>
      expect(cycleCard("Summer base 2027")).toHaveTextContent("Active"),
    );
    expect(writes().map(({ path, search }) => path + search)).toEqual([
      `${CYCLES_PATH}/${DRAFT.id}/activate`,
      `${CYCLES_PATH}/${DRAFT.id}/activate?confirm=true`,
    ]);
    await user.click(screen.getByRole("button", { name: "Show archived · 2" }));
    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent("Archived");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Summer base 2027 is active · members see it now",
    );
  });

  it("sin choque activa sin preguntar", async () => {
    stubApi({ write: () => ok({ cycles: AFTER_CONFIRM }) });
    const user = userEvent.setup();
    await renderPlanner();

    await activateDraft(user);

    await waitFor(() =>
      expect(cycleCard("Summer base 2027")).toHaveTextContent("Active"),
    );
    expect(
      screen.queryByRole("group", { name: /will be archived/ }),
    ).not.toBeInTheDocument();
    expect(writes().map(({ search }) => search)).toEqual([""]);
  });

  it("un archivado pide volver a activarlo y después confirma lo que choca", async () => {
    stubApi({
      write: (request) =>
        request.search === "?confirm=true"
          ? ok({
              cycles: [
                { ...ACTIVE, status: "archived" },
                DRAFT,
                JUNIORS_CYCLE,
                { ...ARCHIVED, status: "active" },
              ],
            })
          : conflictsReply([ACTIVE]),
    });
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(screen.getByRole("button", { name: "Show archived · 1" }));
    await openCycle(user, "Winter 2026");
    await user.click(screen.getByRole("button", { name: "Make active" }));
    const reactivate = screen.getByRole("group", { name: /^Make "/ });

    await user.click(
      within(reactivate).getByRole("button", { name: "Make active" }),
    );

    const confirm = await screen.findByRole("group", {
      name: /will be archived/,
    });
    expect(confirm).toHaveTextContent("Road to Nationals 2027");
    await user.click(
      within(confirm).getByRole("button", { name: "Make active" }),
    );
    await waitFor(() =>
      expect(cycleCard("Winter 2026")).toHaveTextContent("Active"),
    );
  });

  it("guardar los grupos de un activo que choca pide la misma confirmación", async () => {
    const saved: ManagedCycle = {
      ...ACTIVE,
      audience: { kind: "groups", groups: [JUNIORS] },
    };
    const juniorsActive: ManagedCycle = { ...JUNIORS_CYCLE, status: "active" };
    stubApi({
      cycles: [ACTIVE, juniorsActive, DRAFT],
      write: (request) =>
        request.search === "?confirm=true"
          ? ok({ cycle: saved })
          : conflictsReply([juniorsActive]),
    });
    const user = userEvent.setup();
    await renderPlanner();
    await chooseGroups(user);
    await user.click(
      within(audienceField()).getByRole("checkbox", { name: "Juniors" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    const confirm = await screen.findByRole("group", {
      name: /will be archived/,
    });
    expect(confirm).toHaveTextContent("Juniors block");
    await user.click(within(confirm).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({
      method: "PATCH",
      path: `${CYCLES_PATH}/${ACTIVE.id}`,
      search: "?confirm=true",
      body: { audience: { kind: "groups", groupIds: [JUNIORS.id] } },
    });
    // La lista entera se vuelve a pedir: los que chocaban ya están archivados.
    await waitFor(() =>
      expect(
        requests.filter(
          (request) => request.method === "GET" && request.path === CYCLES_PATH,
        ),
      ).toHaveLength(2),
    );
  });

  it("al cancelar la de los grupos, el campo sigue con lo elegido y no envía más", async () => {
    stubApi({ write: () => conflictsReply([DRAFT]) });
    const user = userEvent.setup();
    await renderPlanner();
    await chooseGroups(user);
    await user.click(
      within(audienceField()).getByRole("checkbox", { name: "Juniors" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("group", {
      name: /will be archived/,
    });

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(writes()).toHaveLength(1);
    expect(
      within(audienceField()).getByRole("checkbox", { name: "Juniors" }),
    ).toBeChecked();
  });
});

describe("en español", () => {
  it("el campo, la audiencia y la confirmación hablan con tú", async () => {
    stubApi({
      cycles: [ACTIVE, DRAFT, ORPHAN_CYCLE],
      write: () => conflictsReply([ACTIVE]),
    });
    const user = userEvent.setup();
    await renderPlanner("es");

    const field = screen.getByRole("group", { name: "Para" });
    expect(
      await within(field).findByRole("radio", { name: "Todo el club" }),
    ).toBeChecked();
    expect(cycleCard("Road to Nationals 2027")).toHaveTextContent(
      "Todo el club",
    );
    expect(cycleCard("Orphan block")).toHaveTextContent(
      "Sin grupos: ningún miembro lo ve",
    );
    await user.click(
      await within(field).findByRole("radio", { name: "Grupos concretos" }),
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(field).toHaveTextContent("Elige al menos un grupo");

    await user.click(cycleCard("Summer base 2027"));
    await user.click(screen.getByRole("button", { name: "Activar" }));
    expect(
      await screen.findByRole("group", { name: /pasará a archivado/ }),
    ).toHaveTextContent("Road to Nationals 2027");
  });
});
