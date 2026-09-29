import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamBuilderScreen } from "@/components/teams/TeamBuilderScreen";
import type { BuildableEvents } from "@/lib/teams/buildable-events";
import {
  DEFAULT_TEAM_LABELS,
  type BuilderAssignment,
  type SquadEntry,
  type TeamBuilder,
  type TeamBuilderEventSummary,
} from "@/lib/teams/team-builder";

/**
 * La pantalla de Equipos (#402, RF-9 del PRD de E10). Quién está en la
 * escuadra, qué se puede guardar y qué reparte el auto-balance lo decide el
 * servidor (#401): aquí se prueba que la pantalla pinta lo que responde la
 * API, mueve y cuenta en vivo lo que se toca, y no da por guardado lo que no
 * se guardó.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/equipos" }));

const EVENTS_PATH = "/api/v1/teams";

const SCRIMMAGE: TeamBuilderEventSummary = {
  id: "e1e1e1e1-0000-4000-8000-000000000001",
  title: "Scrimmage",
  eventType: "training",
  startsOn: "2027-06-19",
  startTime: "10:00",
};

const COMPETITION: TeamBuilderEventSummary = {
  id: "e1e1e1e1-0000-4000-8000-000000000002",
  title: "Geelong Cup",
  eventType: "competition",
  startsOn: "2027-06-26",
  startTime: "09:30",
};

const FORWARD = {
  id: "f0f0f0f0-0000-4000-8000-00000000000f",
  names: { en: "Forward", es: "Ataque" },
};

function entry(
  index: number,
  fullName: string,
  changes: Partial<SquadEntry> = {},
): SquadEntry {
  return {
    userId: `4e4e4e4e-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fullName,
    position: null,
    coverage: null,
    rating: 7,
    isUnrated: false,
    ...changes,
  };
}

const MATEO = entry(1, "Mateo Restrepo", {
  position: FORWARD,
  coverage: "forward",
  rating: 9,
});
const DANIELA = entry(2, "Daniela Vargas", { rating: 8 });
const ETHAN = entry(3, "Ethan Brown", { rating: 5, isUnrated: true });
const RUBY = entry(4, "Ruby Tan", { rating: 6.5 });
const LIAM = entry(5, "Liam O'Connor", { rating: 7.2 });

function assigned(
  player: SquadEntry,
  team: "a" | "b",
  isOutsideSquad = false,
): BuilderAssignment {
  return { ...player, team, isOutsideSquad };
}

function builderFor(
  event: TeamBuilderEventSummary,
  changes: Partial<TeamBuilder> = {},
): TeamBuilder {
  return {
    event,
    teams: DEFAULT_TEAM_LABELS,
    available: [DANIELA, ETHAN, MATEO],
    maybe: [RUBY],
    split: null,
    ...changes,
  };
}

/** Mateo y Daniela en Kelp, Ethan en Tide: cambiar a Mateo por Ethan es lo
 * que más acerca los puntajes. */
const DRAFTED = builderFor(SCRIMMAGE, {
  split: {
    mode: "manual",
    publishedAt: null,
    assignments: [
      assigned(DANIELA, "a"),
      assigned(ETHAN, "b"),
      assigned(MATEO, "a"),
    ],
  },
});

type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

type Respond = (request: RecordedRequest) => Response | Promise<Response>;

const requests: RecordedRequest[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function businessRule(reason: string): Response {
  return jsonResponse(422, {
    error: { code: "business_rule", message: "No.", reason },
  });
}

function builderPath(eventId: string): string {
  return `/api/v1/teams/${eventId}`;
}

function stubApi(respond: Respond): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const request = { method, path: url.pathname, body };
      requests.push(request);
      return respond(request);
    }),
  );
}

type ClubApi = {
  readonly events?: BuildableEvents["events"];
  readonly builders?: readonly TeamBuilder[];
  /** Lo que responde cada escritura; por defecto, que salió bien. */
  readonly onWrite?: Respond;
};

function savedOrPublished({ method, path, body }: RecordedRequest): Response {
  if (method === "PUT") {
    const { assignments } = body as { assignments: unknown[] };
    return jsonResponse(200, {
      data: {
        eventId: SCRIMMAGE.id,
        mode: "manual",
        assignedCount: assignments.length,
      },
    });
  }
  if (path.endsWith("/publication")) {
    return jsonResponse(201, {
      data: {
        eventId: SCRIMMAGE.id,
        publishedAt: "2027-06-15T10:05:00.000Z",
        assignedCount: 3,
        notifiedCount: 3,
      },
    });
  }
  throw new Error(`Escritura inesperada: ${method} ${path}`);
}

function stubClub({
  events = [SCRIMMAGE, COMPETITION],
  builders = [builderFor(SCRIMMAGE), builderFor(COMPETITION)],
  onWrite = savedOrPublished,
}: ClubApi = {}): void {
  stubApi((request) => {
    if (request.path === EVENTS_PATH) {
      return jsonResponse(200, { data: { events } });
    }
    const builder = builders.find(
      (candidate) => builderPath(candidate.event.id) === request.path,
    );
    if (request.method === "GET" && builder !== undefined) {
      return jsonResponse(200, { data: builder });
    }
    return onWrite(request);
  });
}

function writes(): RecordedRequest[] {
  return requests.filter((request) => request.method !== "GET");
}

function region(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

async function openScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<TeamBuilderScreen locale={locale} />);
  await screen.findByRole("region", {
    name: locale === "en" ? "Available" : "Disponibles",
  });
}

function totals(): HTMLElement {
  return screen.getByRole("group", { name: "Totals" });
}

function modeButton(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: "Mode" })).getByRole(
    "button",
    { name },
  );
}

/** La fila de un jugador en una lista: el elemento que se arrastra. */
function playerRow(container: HTMLElement, name: string): HTMLElement {
  const row = within(container).getByText(name).closest("li");
  if (row === null) {
    throw new Error(`La fila de ${name} no es un elemento de la lista.`);
  }
  return row;
}

/** Los nombres de una lista en orden: cada fila agrupa sus botones de mover
 * bajo el nombre del jugador, como el segmento de Asistencia. */
function playerNames(container: HTMLElement): (string | null)[] {
  return within(container)
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label"));
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Save/ });
}

afterEach(() => {
  requests.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la escuadra", () => {
  it("abre el evento más cercano, con su día en el título", async () => {
    stubClub();

    await openScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Sat 19 Jun · Scrimmage" }),
    ).toBeInTheDocument();
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ["GET", EVENTS_PATH],
      ["GET", builderPath(SCRIMMAGE.id)],
    ]);
  });

  it("ofrece en el selector los eventos armables, con el abierto elegido", async () => {
    stubClub();

    await openScreen();

    const select = screen.getByRole("combobox", { name: "Event" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Sat 19 Jun · 10:00 am · Scrimmage",
      "Sat 26 Jun · 9:30 am · Geelong Cup",
    ]);
    expect(select).toHaveValue(SCRIMMAGE.id);
  });

  it("pone los Sí en disponibles y los Quizás aparte, con posición y OVR o sin evaluar", async () => {
    stubClub();

    await openScreen();

    const available = region("Available");
    expect(playerNames(available)).toEqual([
      "Daniela Vargas",
      "Ethan Brown",
      "Mateo Restrepo",
    ]);
    const mateo = playerRow(available, "Mateo Restrepo");
    expect(within(mateo).getByText("MR")).toBeInTheDocument();
    expect(within(mateo).getByText("Forward")).toBeInTheDocument();
    expect(within(mateo).getByText("9.0")).toBeInTheDocument();
    expect(
      within(playerRow(available, "Ethan Brown")).getByText("Unrated"),
    ).toBeInTheDocument();
    expect(playerNames(region("Maybe"))).toEqual(["Ruby Tan"]);
  });

  it("enseña las dos columnas con sus nombres y el control de modo", async () => {
    stubClub();

    await openScreen();

    expect(region("Team Kelp")).toHaveTextContent("No one on this team yet.");
    expect(region("Team Tide")).toBeInTheDocument();
    expect(modeButton("Manual")).toHaveAttribute("aria-pressed", "true");
    expect(modeButton("Auto-balance")).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Balance teams" }),
    ).toBeInTheDocument();
  });

  it("pinta el reparto guardado en sus columnas y los totales", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(playerNames(region("Team Kelp"))).toEqual([
      "Mateo Restrepo",
      "Daniela Vargas",
    ]);
    expect(region("Team Tide")).toHaveTextContent("Ethan Brown");
    expect(region("Available")).not.toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("Team Kelp · 17.0 pts");
    expect(totals()).toHaveTextContent("Team Tide · 5.0 pts");
    expect(totals()).toHaveTextContent("Difference 12.0");
  });

  it("marca ya no viene al asignado que salió de la escuadra y deja quitarlo", async () => {
    stubClub({
      builders: [
        builderFor(SCRIMMAGE, {
          split: {
            mode: "manual",
            publishedAt: null,
            assignments: [assigned(LIAM, "b", true)],
          },
        }),
      ],
    });
    await openScreen();
    const liam = playerRow(region("Team Tide"), LIAM.fullName);
    expect(within(liam).getByText("No longer coming")).toBeInTheDocument();

    await userEvent.click(
      within(liam).getByRole("button", {
        name: "Remove Liam O'Connor from Team Tide",
      }),
    );

    expect(region("Team Tide")).not.toHaveTextContent(LIAM.fullName);
    expect(region("Available")).not.toHaveTextContent(LIAM.fullName);
  });

  it("cambia de evento sin preguntar cuando no hay cambios", async () => {
    stubClub();
    const confirm = vi.spyOn(window, "confirm");
    await openScreen();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Event" }),
      COMPETITION.id,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Sat 26 Jun · Geelong Cup",
      }),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("con cambios sin guardar pregunta antes de cambiar de evento, y se queda si no se acepta", async () => {
    stubClub();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Kelp" }),
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Event" }),
      COMPETITION.id,
    );

    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes on these teams. Discard them?",
    );
    expect(screen.getByRole("combobox", { name: "Event" })).toHaveValue(
      SCRIMMAGE.id,
    );
    expect(region("Team Kelp")).toHaveTextContent("Mateo Restrepo");
  });

  it("con cambios sin guardar avisa antes de cerrar la página", async () => {
    stubClub();
    await openScreen();
    const untouched = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);

    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Kelp" }),
    );
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);

    expect(leaving.defaultPrevented).toBe(true);
  });

  it("si la escuadra no se puede abrir lo dice y deja reintentar", async () => {
    let isDown = true;
    stubApi(({ path }) => {
      if (path === EVENTS_PATH) {
        return jsonResponse(200, { data: { events: [SCRIMMAGE] } });
      }
      if (isDown) {
        isDown = false;
        return businessRule("team_event_cancelled");
      }
      return jsonResponse(200, { data: builderFor(SCRIMMAGE) });
    });
    render(<TeamBuilderScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This event was cancelled: its teams can no longer be changed.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("region", { name: "Available" })).toBe(
      region("Available"),
    );
  });
});

describe("mover a mano", () => {
  it("mueve a un disponible a un equipo y los totales cambian al instante, sin guardar", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Kelp" }),
    );

    expect(region("Team Kelp")).toHaveTextContent("Mateo Restrepo");
    expect(region("Available")).not.toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("Team Kelp · 9.0 pts");
    expect(totals()).toHaveTextContent("Difference 9.0");
    expect(writes()).toEqual([]);
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved changes");
  });

  it("anuncia a qué lista fue y los nuevos totales", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Ethan Brown to Team Tide" }),
    );

    expect(
      screen.getByText(
        "Ethan Brown moved to Team Tide. Team Kelp 0.0 points, Team Tide 5.0 points, difference 5.0.",
      ),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("pasa a un asignado al otro equipo con Cambiar", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Switch Mateo Restrepo to Team Tide",
      }),
    );

    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("Difference 6.0");
  });

  it("devuelve a un asignado a su lista con Quitar", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Daniela Vargas from Team Kelp",
      }),
    );

    expect(region("Available")).toHaveTextContent("Daniela Vargas");
    expect(totals()).toHaveTextContent("Team Kelp · 9.0 pts");
    expect(
      screen.getByText(/^Daniela Vargas moved to Available\./),
    ).toBeInTheDocument();
  });

  it("mueve a un Quizás a un equipo", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Ruby Tan to Team Tide" }),
    );

    expect(region("Team Tide")).toHaveTextContent("Ruby Tan");
    expect(region("Maybe")).not.toHaveTextContent("Ruby Tan");
  });

  it("mueve también arrastrando entre listas", async () => {
    stubClub();
    await openScreen();
    const mateo = playerRow(region("Available"), "Mateo Restrepo");
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "none",
      dropEffect: "none",
    };

    fireEvent.dragStart(mateo, { dataTransfer });
    fireEvent.dragOver(region("Team Tide"), { dataTransfer });
    fireEvent.drop(region("Team Tide"), { dataTransfer });

    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(mateo).toHaveAttribute("draggable", "true");
  });
});

describe("balancear", () => {
  const BALANCED = {
    teams: DEFAULT_TEAM_LABELS,
    mode: "auto",
    a: [MATEO],
    b: [DANIELA, ETHAN],
    totals: {
      a: { playerCount: 1, combinedRating: 9, averageRating: 9 },
      b: { playerCount: 2, combinedRating: 13, averageRating: 6.5 },
      ratingDifference: 4,
    },
    suggestion: null,
    isTimeBudgetExhausted: false,
  };

  function stubBalancing(
    response: Response = jsonResponse(200, { data: BALANCED }),
  ) {
    stubClub({
      onWrite: (request) =>
        request.path.endsWith("/auto-balance")
          ? response
          : savedOrPublished(request),
    });
  }

  it("pide el auto-balance, llena las columnas, marca a los no evaluados y pasa a Auto-balance", async () => {
    stubBalancing();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Balance teams" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Teams balanced and saved as a draft.",
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `${builderPath(SCRIMMAGE.id)}/auto-balance`,
        body: null,
      },
    ]);
    expect(region("Team Kelp")).toHaveTextContent("Mateo Restrepo");
    const tide = region("Team Tide");
    expect(
      within(playerRow(tide, "Ethan Brown")).getByText("Unrated"),
    ).toBeInTheDocument();
    expect(modeButton("Auto-balance")).toHaveAttribute("aria-pressed", "true");
    expect(saveButton()).toHaveAccessibleName("Save");
  });

  it("vuelve a Manual si luego se toca algo a mano", async () => {
    stubBalancing();
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Balance teams" }),
    );
    await screen.findByText("Teams balanced and saved as a draft.");

    await userEvent.click(
      screen.getByRole("button", { name: "Move Ruby Tan to Team Kelp" }),
    );

    expect(modeButton("Manual")).toHaveAttribute("aria-pressed", "true");
  });

  it("traduce el 422 de la escuadra vacía y conserva lo que hay", async () => {
    stubBalancing(businessRule("team_squad_empty"));
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Move Ruby Tan to Team Kelp" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Balance teams" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nobody has said Yes to this event: there is no one to balance.",
    );
    expect(region("Team Kelp")).toHaveTextContent("Ruby Tan");
    expect(modeButton("Manual")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("sugerencia", () => {
  it("enseña el mejor intercambio con los dos nombres y qué mejora", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(region("Suggested swap")).toHaveTextContent(
      "Mateo Restrepo ↔ Ethan Brown, to bring the difference down to 4.0.",
    );
  });

  it("al aplicarla intercambia a los dos y recalcula", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      within(region("Suggested swap")).getByRole("button", { name: "Apply" }),
    );

    expect(region("Team Kelp")).toHaveTextContent("Ethan Brown");
    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("Difference 4.0");
    expect(writes()).toEqual([]);
  });

  it("no enseña nada cuando no hay intercambio que mejore", async () => {
    stubClub();

    await openScreen();

    expect(
      screen.queryByRole("region", { name: "Suggested swap" }),
    ).not.toBeInTheDocument();
  });
});

describe("guardar y publicar", () => {
  async function moveMateoToKelp(): Promise<void> {
    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Kelp" }),
    );
  }

  it("guarda el borrador entero y lo confirma", async () => {
    stubClub();
    await openScreen();
    await moveMateoToKelp();

    await userEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Teams saved as a draft. Nobody has been notified yet.",
    );
    expect(writes()).toEqual([
      {
        method: "PUT",
        path: builderPath(SCRIMMAGE.id),
        body: {
          teams: DEFAULT_TEAM_LABELS,
          assignments: [{ userId: MATEO.userId, team: "a" }],
        },
      },
    ]);
    expect(saveButton()).toHaveAccessibleName("Save");
  });

  it("pide confirmación diciendo cuántos recibirán aviso, y no manda nada hasta confirmar", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Publish teams" }),
    );

    expect(
      screen.getByRole("group", {
        name: "Publish the teams? 3 players will get a notification with their team.",
      }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("al confirmar guarda, publica y lo dice", async () => {
    stubClub();
    await openScreen();
    await moveMateoToKelp();
    await userEvent.click(
      screen.getByRole("button", { name: "Publish teams" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Publish and notify" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Teams published. 3 players notified.",
    );
    expect(writes().map(({ method, path }) => [method, path])).toEqual([
      ["PUT", builderPath(SCRIMMAGE.id)],
      ["POST", `${builderPath(SCRIMMAGE.id)}/publication`],
    ]);
  });

  it("sin cambios publica sin volver a guardar", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Publish teams" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Publish and notify" }),
    );

    await screen.findByText("Teams published. 3 players notified.");
    expect(writes().map(({ method }) => method)).toEqual(["POST"]);
  });

  it("un doble toque en publicar manda una sola petición", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubClub({
      builders: [DRAFTED],
      onWrite: async (request) => {
        await held;
        return savedOrPublished(request);
      },
    });
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Publish teams" }),
    );
    const confirm = screen.getByRole("button", { name: "Publish and notify" });

    await userEvent.dblClick(confirm);
    release();

    await screen.findByText("Teams published. 3 players notified.");
    expect(writes()).toHaveLength(1);
  });

  it("un doble toque en guardar manda una sola petición", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubClub({
      onWrite: async (request) => {
        await held;
        return savedOrPublished(request);
      },
    });
    await openScreen();
    await moveMateoToKelp();

    await userEvent.dblClick(saveButton());
    release();

    await screen.findByText(
      "Teams saved as a draft. Nobody has been notified yet.",
    );
    expect(writes()).toHaveLength(1);
  });

  it("si la red falla lo dice, no da nada por guardado y conserva lo que hay", async () => {
    stubClub({
      onWrite: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await openScreen();
    await moveMateoToKelp();

    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(region("Team Kelp")).toHaveTextContent("Mateo Restrepo");
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved changes");
  });

  it.each([
    [
      "team_event_past",
      "This event is over: its teams can no longer be changed.",
    ],
    [
      "team_player_outside_squad",
      "Someone on the teams is no longer coming. Remove the players marked “No longer coming” and try again.",
    ],
  ])("traduce el 422 %s al publicar", async (reason, message) => {
    stubClub({ onWrite: () => businessRule(reason) });
    await openScreen();
    await moveMateoToKelp();
    await userEvent.click(
      screen.getByRole("button", { name: "Publish teams" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Publish and notify" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(writes()).toHaveLength(1);
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved changes");
  });

  it("no deja publicar un reparto sin nadie asignado", async () => {
    stubClub();

    await openScreen();

    expect(
      screen.getByRole("button", { name: "Publish teams" }),
    ).toBeDisabled();
  });
});

describe("sin eventos", () => {
  it("dice que no hay eventos armables y enlaza al calendario", async () => {
    stubClub({ events: [] });

    render(<TeamBuilderScreen locale="en" />);

    expect(
      await screen.findByText(
        "There are no trainings or competitions coming up to build teams for.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the calendar" }),
    ).toHaveAttribute("href", "/calendario");
  });

  it("si la lista no carga lo dice y deja reintentar", async () => {
    stubApi(() => {
      throw new TypeError("Failed to fetch");
    });

    render(<TeamBuilderScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("en español", () => {
  it("escribe la pantalla en español", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "sáb 19 jun · Scrimmage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Balancear equipos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Totales" })).toHaveTextContent(
      "Diferencia 12,0",
    );
    expect(
      screen.getByRole("button", { name: "Mover a Ruby Tan a Team Kelp" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Quizás" })).toHaveTextContent(
      "Ruby Tan",
    );
    expect(
      screen.getByRole("button", { name: "Publicar equipos" }),
    ).toBeInTheDocument();
  });

  it("traduce la escuadra vacía de eventos", async () => {
    stubClub({ events: [] });

    render(<TeamBuilderScreen locale="es" />);

    expect(
      await screen.findByText(
        "No hay entrenamientos ni competiciones por delante para armar equipos.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Ir al calendario" }),
      ).toBeInTheDocument(),
    );
  });
});
