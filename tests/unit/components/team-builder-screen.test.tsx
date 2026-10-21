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
import { stubScreenWidth } from "../../support/screen-width";
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
const TEAM_LABELS_PATH = "/api/v1/club/team-labels";

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
    photoUrl: null,
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
  /** Los equipos del club (#755); por defecto, los de siempre. */
  readonly clubTeams?: () => Response;
  /** Lo que responde cada escritura; por defecto, que salió bien. */
  readonly onWrite?: Respond;
};

/** Lo que responde el cambio de los equipos del club: los que manda, sin
 * el evento, y qué pasó con su reparto (D4). */
function teamsChanged(body: unknown, eventSplit: string): Response {
  const { a, b } = body as { a: unknown; b: unknown };
  return jsonResponse(200, { data: { a, b, eventSplit } });
}

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
  if (method === "PATCH" && path === TEAM_LABELS_PATH) {
    return teamsChanged(body, "none");
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
  clubTeams = () => jsonResponse(200, { data: DEFAULT_TEAM_LABELS }),
  onWrite = savedOrPublished,
}: ClubApi = {}): void {
  stubApi((request) => {
    if (request.path === EVENTS_PATH) {
      return jsonResponse(200, { data: { events } });
    }
    if (request.method === "GET" && request.path === TEAM_LABELS_PATH) {
      return clubTeams();
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
    name: locale === "en" ? "Available · Going" : "Disponibles · Van",
  });
}

function totals(): HTMLElement {
  return screen.getByRole("group", { name: "Totals" });
}

function balanceButton(): HTMLElement {
  return screen.getByRole("button", { name: "Auto-balance" });
}

function publishButton(): HTMLElement {
  return screen.getByRole("button", { name: "Publish" });
}

const PUBLISH_QUESTION =
  "Publish teams? 3 players will be notified which team they're on.";

function publishConfirmation(): HTMLElement {
  return screen.getByRole("group", { name: /^Publish teams\?/ });
}

/** El Publicar de la confirmación, no el de la cabecera. */
async function confirmPublish(): Promise<void> {
  await userEvent.click(
    within(publishConfirmation()).getByRole("button", { name: "Publish" }),
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

  it("abre el evento pedido desde el inicio cuando es armable (#747)", async () => {
    stubClub();

    render(<TeamBuilderScreen locale="en" initialEventId={COMPETITION.id} />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Sat 26 Jun · Geelong Cup",
      }),
    ).toBeInTheDocument();
  });

  it("abre el más cercano si el evento pedido no es armable", async () => {
    stubClub();

    render(
      <TeamBuilderScreen
        locale="en"
        initialEventId="00000000-0000-4000-8000-0000000000ff"
      />,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Sat 19 Jun · Scrimmage",
      }),
    ).toBeInTheDocument();
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

    const available = region("Available · Going");
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

  it("enseña las dos columnas con sus nombres, el estado del modo y Auto-balance", async () => {
    stubClub();

    await openScreen();

    expect(region("Team Kelp")).toHaveTextContent(
      "Drag players here or use Add on the bench.",
    );
    expect(region("Team Tide")).toBeInTheDocument();
    expect(screen.getByText("Edited by hand")).toBeInTheDocument();
    expect(balanceButton()).toBeInTheDocument();
  });

  it("pinta el reparto guardado en sus columnas y los totales", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(playerNames(region("Team Kelp"))).toEqual([
      "Mateo Restrepo",
      "Daniela Vargas",
    ]);
    expect(region("Team Tide")).toHaveTextContent("Ethan Brown");
    expect(region("Available · Going")).not.toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("Team Kelp 17.0");
    expect(totals()).toHaveTextContent("5.0 Team Tide");
    expect(totals()).toHaveTextContent("12.0 apart");
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
    expect(region("Available · Going")).not.toHaveTextContent(LIAM.fullName);
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
      screen.getByRole("button", { name: "Add Mateo Restrepo to Team Kelp" }),
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
      screen.getByRole("button", { name: "Add Mateo Restrepo to Team Kelp" }),
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

    expect(
      await screen.findByRole("region", { name: "Available · Going" }),
    ).toBe(region("Available · Going"));
  });
});

describe("las fotos (#757)", () => {
  const MATEO_PHOTO = `https://storage.test/member-photos/${MATEO.userId}/thumb.webp?token=t`;
  const DANIELA_PHOTO = `https://storage.test/member-photos/${DANIELA.userId}/thumb.webp?token=t`;
  const WITH_PHOTOS = builderFor(SCRIMMAGE, {
    available: [
      { ...DANIELA, photoUrl: DANIELA_PHOTO },
      ETHAN,
      { ...MATEO, photoUrl: MATEO_PHOTO },
    ],
    split: {
      mode: "manual",
      publishedAt: null,
      assignments: [assigned({ ...MATEO, photoUrl: MATEO_PHOTO }, "a")],
    },
  });

  it("enseña la foto del jugador en su fila", async () => {
    stubClub({ builders: [WITH_PHOTOS] });

    await openScreen();

    expect(
      within(
        playerRow(region("Available · Going"), DANIELA.fullName),
      ).getByRole("presentation"),
    ).toHaveAttribute("src", DANIELA_PHOTO);
  });

  it("enseña las iniciales del jugador sin foto", async () => {
    stubClub({ builders: [WITH_PHOTOS] });

    await openScreen();

    const row = playerRow(region("Available · Going"), ETHAN.fullName);
    expect(within(row).queryByRole("presentation")).not.toBeInTheDocument();
    expect(within(row).getByText("EB")).toBeInTheDocument();
  });

  it("cae a las iniciales si la foto no carga", async () => {
    stubClub({ builders: [WITH_PHOTOS] });
    await openScreen();
    const row = playerRow(region("Available · Going"), DANIELA.fullName);

    fireEvent.error(within(row).getByRole("presentation"));

    expect(within(row).queryByRole("presentation")).not.toBeInTheDocument();
    expect(within(row).getByText("DV")).toBeInTheDocument();
  });

  it("pone en un equipo el avatar de 34 px con el anillo del color del equipo", async () => {
    stubClub({ builders: [WITH_PHOTOS] });

    await openScreen();

    const photo = within(
      playerRow(region("Team Kelp"), MATEO.fullName),
    ).getByRole("presentation");
    expect(photo).toHaveAttribute("width", "34");
    expect(photo).toHaveStyle({
      borderColor: DEFAULT_TEAM_LABELS.a.color,
    });
  });

  it("pone el anillo del equipo también en las iniciales", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(
      within(playerRow(region("Team Tide"), ETHAN.fullName)).getByText("EB"),
    ).toHaveStyle({ borderColor: DEFAULT_TEAM_LABELS.b.color });
  });

  it("pone en el banco el avatar de 32 px sin anillo", async () => {
    stubClub({ builders: [WITH_PHOTOS] });

    await openScreen();

    const photo = within(
      playerRow(region("Available · Going"), DANIELA.fullName),
    ).getByRole("presentation");
    expect(photo).toHaveAttribute("width", "32");
    expect(photo.style.borderColor).toBe("");
  });
});

describe("mover a mano", () => {
  it("mueve a un disponible a un equipo y los totales cambian al instante, sin guardar", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Add Mateo Restrepo to Team Kelp" }),
    );

    expect(region("Team Kelp")).toHaveTextContent("Mateo Restrepo");
    expect(region("Available · Going")).not.toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("Team Kelp 9.0");
    expect(totals()).toHaveTextContent("9.0 apart");
    expect(writes()).toEqual([]);
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved");
  });

  it("anuncia a qué lista fue y los nuevos totales", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Add Ethan Brown to Team Tide" }),
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
        name: "Move Mateo Restrepo to Team Tide",
      }),
    );

    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("6.0 apart");
  });

  it("devuelve a un asignado a su lista con Quitar", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Daniela Vargas from Team Kelp",
      }),
    );

    expect(region("Available · Going")).toHaveTextContent("Daniela Vargas");
    expect(totals()).toHaveTextContent("Team Kelp 9.0");
    expect(
      screen.getByText(/^Daniela Vargas moved to Available · Going\./),
    ).toBeInTheDocument();
  });

  it("mueve a un Quizás a un equipo", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Add Ruby Tan to Team Tide" }),
    );

    expect(region("Team Tide")).toHaveTextContent("Ruby Tan");
    expect(region("Maybe")).not.toHaveTextContent("Ruby Tan");
  });

  it("mueve también arrastrando entre listas", async () => {
    stubClub();
    await openScreen();
    const mateo = playerRow(region("Available · Going"), "Mateo Restrepo");
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

  it("pide el auto-balance, llena las columnas, marca a los no evaluados y pasa a Auto-equilibrado", async () => {
    stubBalancing();
    await openScreen();

    await userEvent.click(balanceButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Teams balanced and saved",
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
    expect(screen.getByText("Auto-balanced")).toBeInTheDocument();
    expect(saveButton()).toHaveAccessibleName("Save");
  });

  it("pinta también a quien dijo Sí después de abrir la pantalla", async () => {
    stubBalancing(
      jsonResponse(200, { data: { ...BALANCED, b: [DANIELA, ETHAN, LIAM] } }),
    );
    await openScreen();

    await userEvent.click(balanceButton());

    await screen.findByText("Teams balanced and saved");
    expect(region("Team Tide")).toHaveTextContent(LIAM.fullName);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Liam O'Connor from Team Tide",
      }),
    );
    expect(region("Available · Going")).toHaveTextContent(LIAM.fullName);
  });

  it("vuelve a Manual si luego se toca algo a mano", async () => {
    stubBalancing();
    await openScreen();
    await userEvent.click(balanceButton());
    await screen.findByText("Teams balanced and saved");

    await userEvent.click(
      screen.getByRole("button", { name: "Add Ruby Tan to Team Kelp" }),
    );

    expect(screen.getByText("Edited by hand")).toBeInTheDocument();
  });

  it("traduce el 422 de la escuadra vacía y conserva lo que hay", async () => {
    stubBalancing(businessRule("team_squad_empty"));
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Add Ruby Tan to Team Kelp" }),
    );

    await userEvent.click(balanceButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nobody has said Yes to this event: there is no one to balance.",
    );
    expect(region("Team Kelp")).toHaveTextContent("Ruby Tan");
    expect(screen.getByText("Edited by hand")).toBeInTheDocument();
  });
});

describe("sugerencia", () => {
  it("enseña el mejor intercambio con los dos nombres, sus equipos y qué mejora", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(region("Suggestion")).toHaveTextContent(
      "Suggestion: swap Mateo Restrepo (Team Kelp) with Ethan Brown (Team Tide) to bring the gap down to 4.0.",
    );
  });

  it("lleva la bombilla y el botón Intercambiar", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    const suggestion = region("Suggestion");
    expect(suggestion.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(suggestion).getByRole("button", { name: "Swap" }),
    ).toHaveClass("admin-secondary");
  });

  it("al pulsar Intercambiar cambia a los dos y recalcula", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      within(region("Suggestion")).getByRole("button", { name: "Swap" }),
    );

    expect(region("Team Kelp")).toHaveTextContent("Ethan Brown");
    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(totals()).toHaveTextContent("4.0 apart");
    expect(writes()).toEqual([]);
  });

  it("anuncia a los dos que cambiaron de equipo y los nuevos totales", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();

    await userEvent.click(
      within(region("Suggestion")).getByRole("button", { name: "Swap" }),
    );

    expect(
      screen.getByText(
        "Mateo Restrepo and Ethan Brown swapped teams. Team Kelp 13.0 points, Team Tide 9.0 points, difference 4.0.",
      ),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("dice que el intercambio cubre los puestos cuando cierra un hueco", async () => {
    const goalkeeper = { coverage: "goalkeeper" as const };
    const keeperOne = entry(8, "Olivia Park", { ...goalkeeper, rating: 7 });
    const keeperTwo = entry(9, "Noah Lee", { ...goalkeeper, rating: 7 });
    stubClub({
      builders: [
        builderFor(SCRIMMAGE, {
          available: [keeperOne, keeperTwo, DANIELA, RUBY],
          maybe: [],
          split: {
            mode: "manual",
            publishedAt: null,
            assignments: [
              assigned(keeperOne, "a"),
              assigned(keeperTwo, "a"),
              assigned(DANIELA, "b"),
              assigned(RUBY, "b"),
            ],
          },
        }),
      ],
    });

    await openScreen();

    expect(region("Suggestion")).toHaveTextContent(
      /^Suggestion: swap (Olivia Park|Noah Lee) \(Team Kelp\) with (Daniela Vargas|Ruby Tan) \(Team Tide\) to cover the positions on both teams\.Swap$/,
    );
  });

  it("no enseña nada cuando no hay intercambio que mejore", async () => {
    stubClub();

    await openScreen();

    expect(
      screen.queryByRole("region", { name: "Suggestion" }),
    ).not.toBeInTheDocument();
  });

  it("escribe la sugerencia en español", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen("es");

    const suggestion = screen.getByRole("region", { name: "Sugerencia" });
    expect(suggestion).toHaveTextContent(
      "Sugerencia: intercambia a Mateo Restrepo (Team Kelp) con Ethan Brown (Team Tide) para bajar la diferencia a 4,0.",
    );
    expect(
      within(suggestion).getByRole("button", { name: "Intercambiar" }),
    ).toBeInTheDocument();
  });
});

describe("el banco (#761)", () => {
  /** Todos los que van ya están en un equipo y nadie dijo quizás. */
  const ALL_PLACED = builderFor(SCRIMMAGE, {
    maybe: [],
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

  it("titula las dos columnas con cuántos hay en cada una", async () => {
    stubClub();

    await openScreen();

    expect(
      within(region("Available · Going")).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Available · Going 3");
    expect(
      within(region("Maybe")).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Maybe 1");
  });

  it("cuenta sólo a los que siguen en el banco", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(
      within(region("Available · Going")).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Available · Going 0");
  });

  it("pone en cada fila un Añadir por equipo, con su punto y su nombre corto", async () => {
    stubClub();

    await openScreen();

    const row = playerRow(region("Available · Going"), MATEO.fullName);
    const buttons = within(row).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Add Mateo Restrepo to Team Kelp",
      "Add Mateo Restrepo to Team Tide",
    ]);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Kelp",
      "Tide",
    ]);
    const dot = buttons[0]?.querySelector(".team-add-dot");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveStyle({ backgroundColor: DEFAULT_TEAM_LABELS.a.color });
  });

  it("pinta una raya en vez del OVR del no evaluado, y dice Sin evaluar al lector", async () => {
    stubClub();

    await openScreen();

    const row = playerRow(region("Available · Going"), ETHAN.fullName);
    expect(within(row).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getByText("Unrated")).toHaveClass("visually-hidden");
  });

  it("con Añadir lleva al jugador a ese equipo y lo anuncia", async () => {
    stubClub();
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Add Daniela Vargas to Team Tide" }),
    );

    expect(region("Team Tide")).toHaveTextContent("Daniela Vargas");
    expect(region("Available · Going")).not.toHaveTextContent("Daniela Vargas");
    expect(
      screen.getByText(/^Daniela Vargas moved to Team Tide\./),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("dice que todos tienen equipo y que nadie dijo quizás con las listas vacías", async () => {
    stubClub({ builders: [ALL_PLACED] });

    await openScreen();

    expect(region("Available · Going")).toHaveTextContent(
      "Everyone who said yes is on a team.",
    );
    expect(region("Maybe")).toHaveTextContent("No maybes.");
  });

  it("escribe el banco en español", async () => {
    stubClub();

    await openScreen("es");

    const available = screen.getByRole("region", {
      name: "Disponibles · Van",
    });
    expect(
      within(available).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Disponibles · Van 3");
    expect(
      within(available).getByRole("button", {
        name: "Añadir a Mateo Restrepo a Team Kelp",
      }),
    ).toHaveTextContent("Kelp");
  });

  it("dice en español las listas vacías", async () => {
    stubClub({ builders: [ALL_PLACED] });

    await openScreen("es");

    expect(
      screen.getByRole("region", { name: "Disponibles · Van" }),
    ).toHaveTextContent("Todos los que van ya tienen equipo.");
    expect(screen.getByRole("region", { name: "Quizás" })).toHaveTextContent(
      "Nadie dijo quizás.",
    );
  });
});

describe("guardar y publicar", () => {
  async function moveMateoToKelp(): Promise<void> {
    await userEvent.click(
      screen.getByRole("button", { name: "Add Mateo Restrepo to Team Kelp" }),
    );
  }

  it("guarda el borrador entero y lo confirma", async () => {
    stubClub();
    await openScreen();
    await moveMateoToKelp();

    await userEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved · not published yet",
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

    await userEvent.click(publishButton());

    expect(
      screen.getByRole("group", { name: PUBLISH_QUESTION }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("al confirmar guarda, publica y lo dice", async () => {
    stubClub();
    await openScreen();
    await moveMateoToKelp();
    await userEvent.click(publishButton());

    await confirmPublish();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Published · 3 players notified",
    );
    expect(writes().map(({ method, path }) => [method, path])).toEqual([
      ["PUT", builderPath(SCRIMMAGE.id)],
      ["POST", `${builderPath(SCRIMMAGE.id)}/publication`],
    ]);
  });

  it("sin cambios publica sin volver a guardar", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();
    await userEvent.click(publishButton());

    await confirmPublish();

    await screen.findByText("Published · 3 players notified");
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
    await userEvent.click(publishButton());
    const confirm = within(publishConfirmation()).getByRole("button", {
      name: "Publish",
    });

    await userEvent.dblClick(confirm);
    release();

    await screen.findByText("Published · 3 players notified");
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

    await screen.findByText("Saved · not published yet");
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
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved");
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
    await userEvent.click(publishButton());

    await confirmPublish();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(writes()).toHaveLength(1);
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved");
  });

  it("no deja publicar un reparto sin nadie asignado", async () => {
    stubClub();

    await openScreen();

    expect(publishButton()).toBeDisabled();
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

describe("la cabecera, la barra y los totales (#758)", () => {
  /** Daniela (8,0) contra Mateo (9,0): justo un punto de diferencia. */
  const ONE_APART = builderFor(SCRIMMAGE, {
    split: {
      mode: "manual",
      publishedAt: null,
      assignments: [assigned(DANIELA, "a"), assigned(MATEO, "b")],
    },
  });

  /** La barra es decoración, sin rol: sus dos tramos van en el `aria-hidden`
   * del grupo de totales. */
  function barSegments(): HTMLElement[] {
    const bar = totals().querySelector(':scope > [aria-hidden="true"]');
    if (bar === null) {
      throw new Error("Los totales no tienen barra.");
    }
    return Array.from(bar.children) as HTMLElement[];
  }

  it("lleva en la cabecera el rótulo Teams, el evento como H1, Guardar y Publicar", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Sat 19 Jun · Scrimmage",
    });
    const header = heading.closest("header");
    if (header === null) {
      throw new Error("El H1 no está en la cabecera.");
    }
    expect(within(header).getByText("Teams")).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Publish" }),
    ).toBeEnabled();
  });

  it("marca Guardar con Sin guardar cuando hay cambios", async () => {
    stubClub();
    await openScreen();
    expect(saveButton()).toHaveAccessibleName("Save");

    await userEvent.click(
      screen.getByRole("button", { name: "Add Ruby Tan to Team Kelp" }),
    );

    expect(saveButton()).toHaveAccessibleName("Save · Unsaved");
    expect(within(saveButton()).getByText("Unsaved")).toBeVisible();
  });

  it("ya no tiene el segmento Manual y Auto", async () => {
    stubClub();

    await openScreen();

    expect(
      screen.queryByRole("group", { name: "Mode" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manual" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /balance/i })).toEqual([
      balanceButton(),
    ]);
  });

  it("dice Auto-equilibrado al abrir un reparto guardado en automático", async () => {
    stubClub({
      builders: [
        builderFor(SCRIMMAGE, {
          split: { ...ONE_APART.split!, mode: "auto" },
        }),
      ],
    });

    await openScreen();

    expect(screen.getByText("Auto-balanced")).toBeInTheDocument();
    expect(screen.queryByText("Edited by hand")).not.toBeInTheDocument();
  });

  it("pone cada equipo con su suma a un lado y la diferencia en medio", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    expect(totals()).toHaveTextContent(
      /^Team Kelp 17\.0.*12\.0 apart.*5\.0 Team Tide$/,
    );
    expect(totals()).not.toHaveTextContent("Even");
  });

  it("dice Parejos cuando la diferencia es de un punto o menos", async () => {
    stubClub({ builders: [ONE_APART] });

    await openScreen();

    expect(totals()).toHaveTextContent("Even");
    expect(totals()).not.toHaveTextContent("apart");
  });

  it("parte la barra según la suma de cada equipo, en su color", async () => {
    stubClub({ builders: [DRAFTED] });

    await openScreen();

    const [kelp, tide] = barSegments();
    expect(kelp).toHaveStyle({
      flexGrow: "17",
      backgroundColor: DEFAULT_TEAM_LABELS.a.color,
    });
    expect(tide).toHaveStyle({
      flexGrow: "5",
      backgroundColor: DEFAULT_TEAM_LABELS.b.color,
    });
  });

  it("parte la barra a medias cuando nadie suma", async () => {
    stubClub();

    await openScreen();

    const [kelp, tide] = barSegments();
    expect(kelp).toHaveStyle({ flexGrow: "1" });
    expect(tide).toHaveStyle({ flexGrow: "1" });
  });

  it("pregunta antes de publicar con Cancelar y Publicar, y Cancelar la cierra", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen();
    await userEvent.click(publishButton());

    const confirmation = publishConfirmation();
    expect(
      within(confirmation)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Cancel", "Publish"]);

    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );

    expect(
      screen.queryByRole("group", { name: PUBLISH_QUESTION }),
    ).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("escribe en español la pregunta y los avisos", async () => {
    stubClub({ builders: [DRAFTED] });
    await openScreen("es");
    await userEvent.click(screen.getByRole("button", { name: "Publicar" }));

    const confirmation = screen.getByRole("group", {
      name: "¿Publicar equipos? Se avisará a 3 jugadores de su equipo.",
    });
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Publicar" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Publicado · 3 jugadores avisados",
    );
  });
});

describe("las columnas de equipo (#759)", () => {
  const GOALKEEPER = {
    id: "f0f0f0f0-0000-4000-8000-000000000001",
    names: { en: "Goalkeeper", es: "Portero" },
  };
  const FULL_BACK = {
    id: "f0f0f0f0-0000-4000-8000-000000000002",
    names: { en: "Full back", es: "Defensa" },
  };
  const VALENTINA = entry(6, "Valentina Gómez", {
    position: GOALKEEPER,
    coverage: "goalkeeper",
    rating: 7.4,
  });
  const ISABELLA = entry(7, "Isabella Muñoz", {
    position: FULL_BACK,
    coverage: "defender",
    rating: 7.2,
  });

  /** Kelp con portero, defensa y ataque; Tide con Ethan solo, sin portero. */
  const COVERED = builderFor(SCRIMMAGE, {
    available: [DANIELA, ETHAN, MATEO, VALENTINA, ISABELLA],
    split: {
      mode: "manual",
      publishedAt: null,
      assignments: [
        assigned(VALENTINA, "a"),
        assigned(ISABELLA, "a"),
        assigned(MATEO, "a"),
        assigned(ETHAN, "b"),
      ],
    },
  });

  function coverage(team: string): HTMLElement {
    return within(region(team)).getByRole("list", {
      name: "Position coverage",
    });
  }

  it("pone en la cabecera el nombre como título y cuántos son con su media", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen();

    const kelp = region("Team Kelp");
    expect(
      within(kelp).getByRole("heading", { level: 2, name: "Team Kelp" }),
    ).toBeInTheDocument();
    expect(within(kelp).getByText("3 players · avg 7.9")).toBeInTheDocument();
  });

  it("cuenta porteros, defensas y atacantes del equipo", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen();

    const chips = within(coverage("Team Kelp")).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "GK 11 goalkeeper",
      "DEF 11 defender",
      "ATT 11 forward",
    ]);
  });

  it("dice Sin portero con su aviso cuando el equipo tiene jugadores y ningún portero", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen();

    const chips = within(coverage("Team Tide")).getAllByRole("listitem");
    expect(chips[0]).toHaveTextContent("No goalkeeper");
    expect(chips[0]).not.toHaveTextContent("GK");
    expect(chips[0]).toHaveClass("team-coverage-missing");
    expect(
      within(coverage("Team Kelp")).queryByText("No goalkeeper"),
    ).not.toBeInTheDocument();
  });

  it("a un equipo vacío no le dice Sin portero y le explica cómo llenarlo", async () => {
    stubClub();

    await openScreen();

    const kelp = region("Team Kelp");
    expect(kelp).toHaveTextContent(
      "Drag players here or use Add on the bench.",
    );
    expect(within(kelp).queryByText("No goalkeeper")).not.toBeInTheDocument();
    expect(within(kelp).getByText("0 players")).toBeInTheDocument();
  });

  it("pinta la fila con la posición y el OVR del evaluado", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen();

    const row = playerRow(region("Team Kelp"), VALENTINA.fullName);
    expect(within(row).getByText("Goalkeeper")).toBeInTheDocument();
    expect(within(row).getByText("7.4")).toBeInTheDocument();
  });

  it("pinta una raya en vez del OVR del no evaluado, y dice Sin evaluar al lector", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen();

    const row = playerRow(region("Team Tide"), ETHAN.fullName);
    expect(within(row).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getByText("Unrated")).toHaveClass("visually-hidden");
  });

  it("lleva botones de icono que dicen a quién mueven y a dónde", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen();

    const row = playerRow(region("Team Kelp"), MATEO.fullName);
    const buttons = within(row).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Move Mateo Restrepo to Team Tide",
      "Remove Mateo Restrepo from Team Kelp",
    ]);
    for (const button of buttons) {
      expect(button).toHaveTextContent("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("anuncia a dónde fue el que se cambió con el botón de icono", async () => {
    stubClub({ builders: [COVERED] });
    await openScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Tide" }),
    );

    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(
      screen.getByText(/^Mateo Restrepo moved to Team Tide\./),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("escribe en español la cabecera, la cobertura y los nombres de los botones", async () => {
    stubClub({ builders: [COVERED] });

    await openScreen("es");

    const kelp = region("Team Kelp");
    expect(
      within(kelp).getByText("3 jugadores · media 7,9"),
    ).toBeInTheDocument();
    const chips = within(kelp)
      .getByRole("list", { name: "Cobertura de puestos" })
      .querySelectorAll("li");
    expect(Array.from(chips, (chip) => chip.textContent)).toEqual([
      "POR 11 portero",
      "DEF 11 defensa",
      "ATA 11 atacante",
    ]);
    expect(region("Team Tide")).toHaveTextContent("Sin portero");
    expect(
      screen.getByRole("button", {
        name: "Mover a Mateo Restrepo a Team Tide",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Sacar a Mateo Restrepo de Team Kelp",
      }),
    ).toBeInTheDocument();
  });

  it("le dice al equipo vacío en español cómo llenarlo", async () => {
    stubClub();

    await openScreen("es");

    expect(region("Team Kelp")).toHaveTextContent(
      "Arrastra jugadores aquí o usa Añadir en el banco.",
    );
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
      screen.getByRole("button", { name: "Auto-balance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Editado a mano")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Totales" })).toHaveTextContent(
      "12,0 de diferencia",
    );
    expect(
      screen.getByRole("button", { name: "Añadir a Ruby Tan a Team Kelp" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Quizás" })).toHaveTextContent(
      "Ruby Tan",
    );
    expect(
      screen.getByRole("button", { name: "Publicar" }),
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

describe("editar un equipo (#760)", () => {
  const EDIT_KELP = "Edit name and colour of Team Kelp";

  function editButton(name = EDIT_KELP): HTMLElement {
    return screen.getByRole("button", { name });
  }

  function editor(): HTMLElement {
    return screen.getByRole("dialog", { name: "Edit team" });
  }

  function nameField(): HTMLElement {
    return within(editor()).getByRole("textbox", { name: "Name" });
  }

  function applyButton(): HTMLElement {
    return within(editor()).getByRole("button", { name: "Apply" });
  }

  /** En el móvil el banco va en su pestaña (#762): se espera al lápiz, que
   * está en la pestaña del equipo A, la que abre. */
  async function openEditor(): Promise<void> {
    render(<TeamBuilderScreen locale="en" />);
    await userEvent.click(
      await screen.findByRole("button", { name: EDIT_KELP }),
    );
    await within(editor()).findByRole("textbox", { name: "Name" });
  }

  async function renameKelp(name: string): Promise<void> {
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), name);
  }

  it("lleva en la cabecera de cada equipo un botón de icono que dice qué edita", async () => {
    stubClub();

    await openScreen();

    for (const team of ["Team Kelp", "Team Tide"]) {
      const button = within(region(team)).getByRole("button", {
        name: `Edit name and colour of ${team}`,
      });
      expect(button).toHaveTextContent("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("abre Editar equipo con el foco en el nombre, que trae el de ahora", async () => {
    stubClub();

    await openEditor();

    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveValue("Team Kelp");
    expect(nameField()).toHaveAttribute("maxlength", "24");
  });

  it("ofrece los doce colores como un grupo de radios, con el elegido marcado y nombrado", async () => {
    stubClub();

    await openEditor();

    const colors = within(editor()).getByRole("radiogroup", {
      name: "Bib colour · Blue",
    });
    expect(within(colors).getAllByRole("radio")).toHaveLength(12);
    expect(within(colors).getByRole("radio", { name: "Blue" })).toBeChecked();
  });

  it("desactiva el color del otro equipo y dice quién lo usa", async () => {
    stubClub();

    await openEditor();

    expect(
      within(editor()).getByRole("radio", { name: "Gold (used by Team Tide)" }),
    ).toBeDisabled();
  });

  it("al elegir otro color lo nombra tras Color del peto", async () => {
    stubClub();
    await openEditor();

    await userEvent.click(within(editor()).getByRole("radio", { name: "Red" }));

    expect(
      within(editor()).getByRole("radiogroup", { name: "Bib colour · Red" }),
    ).toBeInTheDocument();
    expect(within(editor()).getByRole("radio", { name: "Red" })).toBeChecked();
  });

  it("elige el color con las flechas", async () => {
    stubClub();
    await openEditor();
    within(editor()).getByRole("radio", { name: "Blue" }).focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(within(editor()).getByRole("radio", { name: "Navy" })).toBeChecked();
  });

  it("explica el tachado y que el cambio vale desde ahora", async () => {
    stubClub();

    await openEditor();

    expect(editor()).toHaveTextContent(
      "The crossed one is the other team's colour.",
    );
    expect(editor()).toHaveTextContent(
      "Used for every event from now on. Teams already published keep their colours.",
    );
  });

  it("no deja aplicar un nombre vacío", async () => {
    stubClub();
    await openEditor();

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "   ");

    expect(applyButton()).toBeDisabled();
  });

  it("al aplicar manda los dos equipos con el evento abierto, cierra y pinta el nombre y el color nuevos", async () => {
    stubClub();
    await openEditor();
    await renameKelp("Team Reef");
    await userEvent.click(within(editor()).getByRole("radio", { name: "Red" }));

    await userEvent.click(applyButton());

    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: TEAM_LABELS_PATH,
        body: {
          a: { name: "Team Reef", color: "#D64545" },
          b: { name: "Team Tide", color: "#C99A3E" },
          eventId: SCRIMMAGE.id,
        },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(region("Team Reef")).toHaveStyle({ "--team-color": "#D64545" });
    expect(totals()).toHaveTextContent("Team Reef");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Team updated · used for every event from now on",
    );
  });

  it("con el reparto ya publicado lo deja con sus equipos y lo dice", async () => {
    stubClub({
      builders: [
        builderFor(SCRIMMAGE, {
          split: {
            mode: "manual",
            publishedAt: "2027-06-15T10:05:00.000Z",
            assignments: [assigned(DANIELA, "a"), assigned(ETHAN, "b")],
          },
        }),
        builderFor(COMPETITION),
      ],
      onWrite: ({ body }) => teamsChanged(body, "published"),
    });
    await openEditor();
    await renameKelp("Team Reef");

    await userEvent.click(applyButton());

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(region("Team Kelp")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Team Reef" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Team updated for the next events. These published teams keep their old name and colour: to use the new ones, save them again, apply the change again and publish.",
    );
  });

  it("con el reparto ya publicado lo dice también en español", async () => {
    stubClub({
      builders: [
        builderFor(SCRIMMAGE, {
          split: {
            mode: "manual",
            publishedAt: "2027-06-15T10:05:00.000Z",
            assignments: [assigned(DANIELA, "a"), assigned(ETHAN, "b")],
          },
        }),
        builderFor(COMPETITION),
      ],
      onWrite: ({ body }) => teamsChanged(body, "published"),
    });
    render(<TeamBuilderScreen locale="es" />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Editar nombre y color de Team Kelp",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Editar equipo" });
    await within(dialog).findByRole("textbox", { name: "Nombre" });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aplicar" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Equipo actualizado para los próximos eventos. El reparto publicado de este evento sigue con el nombre y el color de antes: para usar los nuevos, vuelve a guardarlo, aplica otra vez el cambio y publícalo.",
    );
  });

  it("con el reparto guardado sin publicar conserva lo movido sin guardar y sólo manda los equipos", async () => {
    stubClub({
      builders: [DRAFTED, builderFor(COMPETITION)],
      onWrite: ({ body }) => teamsChanged(body, "relabelled"),
    });
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Tide" }),
    );
    await userEvent.click(editButton());
    await within(editor()).findByRole("textbox", { name: "Name" });
    await renameKelp("Team Reef");

    await userEvent.click(applyButton());

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(region("Team Reef")).toBeInTheDocument();
    expect(region("Team Tide")).toHaveTextContent("Mateo Restrepo");
    expect(saveButton()).toHaveAccessibleName("Save · Unsaved");
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: TEAM_LABELS_PATH,
        body: {
          a: { name: "Team Reef", color: "#1C6EA4" },
          b: { name: "Team Tide", color: "#C99A3E" },
          eventId: SCRIMMAGE.id,
        },
      },
    ]);
  });

  it("mientras se guarda el reparto no cambia los equipos y lo dice", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubClub({
      builders: [DRAFTED, builderFor(COMPETITION)],
      onWrite: async (request) => {
        await held;
        return savedOrPublished(request);
      },
    });
    await openScreen();
    await userEvent.click(
      screen.getByRole("button", { name: "Move Mateo Restrepo to Team Tide" }),
    );
    await userEvent.click(saveButton());
    await userEvent.click(editButton());
    await within(editor()).findByRole("textbox", { name: "Name" });
    await renameKelp("Team Reef");

    await userEvent.click(applyButton());

    expect(await within(editor()).findByRole("alert")).toHaveTextContent(
      "The teams are still saving. Apply again once they finish.",
    );
    expect(writes().map(({ method }) => method)).toEqual(["PUT"]);
    release();
  });

  it("si el servidor responde 400 sigue abierta con el aviso y lo escrito", async () => {
    stubClub({
      onWrite: () =>
        jsonResponse(400, {
          error: { code: "validation_error", message: "No." },
        }),
    });
    await openEditor();
    await renameKelp("Team Reef");

    await userEvent.click(applyButton());

    expect(await within(editor()).findByRole("alert")).toHaveTextContent(
      "Check the name and the colour",
    );
    expect(nameField()).toHaveValue("Team Reef");
    expect(region("Team Kelp")).toBeInTheDocument();
  });

  it("si la red falla sigue abierta con el aviso y lo escrito", async () => {
    stubClub({
      onWrite: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await openEditor();
    await renameKelp("Team Reef");

    await userEvent.click(applyButton());

    expect(await within(editor()).findByRole("alert")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Team Reef");
  });

  it("Escape la cierra sin cambios y devuelve el foco al botón", async () => {
    stubClub();
    await openEditor();
    await renameKelp("Team Reef");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(editButton()).toHaveFocus();
    expect(region("Team Kelp")).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("Cancelar la cierra sin cambios y devuelve el foco al botón", async () => {
    stubClub();
    await openEditor();

    await userEvent.click(
      within(editor()).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(editButton()).toHaveFocus();
    expect(writes()).toEqual([]);
  });

  it("un clic fuera la cierra sin cambios y devuelve el foco al botón", async () => {
    stubClub();
    await openEditor();

    fireEvent.mouseDown(region("Team Tide"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(editButton()).toHaveFocus();
    expect(writes()).toEqual([]);
  });

  it("Tab no saca el foco de la ventana", async () => {
    stubClub();
    await openEditor();
    applyButton().focus();

    await userEvent.tab();

    expect(nameField()).toHaveFocus();
  });

  it("Mayúsculas+Tab desde el nombre va al último botón", async () => {
    stubClub();
    await openEditor();

    await userEvent.tab({ shift: true });

    expect(applyButton()).toHaveFocus();
  });

  it("edita los equipos del club aunque el reparto guardado lleve otros", async () => {
    const OLD_LABELS = {
      a: { name: "Old Kelp", color: "#123456" },
      b: { name: "Old Tide", color: "#654321" },
    };
    stubClub({ builders: [builderFor(SCRIMMAGE, { teams: OLD_LABELS })] });
    await openScreen();
    await userEvent.click(editButton("Edit name and colour of Old Kelp"));
    await within(editor()).findByRole("textbox", { name: "Name" });

    expect(nameField()).toHaveValue("Team Kelp");
    expect(
      within(editor()).getByRole("radio", { name: "Gold (used by Team Tide)" }),
    ).toBeDisabled();
    await userEvent.click(applyButton());

    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: TEAM_LABELS_PATH,
        body: { ...DEFAULT_TEAM_LABELS, eventId: SCRIMMAGE.id },
      },
    ]);
    expect(
      await screen.findByRole("region", { name: "Team Kelp" }),
    ).toBeInTheDocument();
  });

  it("si los equipos del club no llegan lo dice y deja cancelar", async () => {
    stubClub({
      clubTeams: () =>
        jsonResponse(403, {
          error: { code: "forbidden", message: "No." },
        }),
    });
    await openScreen();

    await userEvent.click(editButton());

    expect(await within(editor()).findByRole("alert")).toHaveTextContent(
      "Only Admins and Coaches build teams.",
    );
    await userEvent.click(
      within(editor()).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(editButton()).toHaveFocus();
  });

  it("en el móvil es una hoja inferior con Cancelar y Aplicar", async () => {
    stubScreenWidth(true);
    stubClub();

    await openEditor();

    expect(editor().tagName).toBe("DIALOG");
    expect(editor()).toHaveClass("directory-sheet");
    expect(nameField()).toHaveValue("Team Kelp");
    expect(
      within(editor()).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(applyButton()).toBeInTheDocument();
  });

  it("en el móvil aplica y cierra la hoja", async () => {
    stubScreenWidth(true);
    stubClub();
    await openEditor();
    await renameKelp("Team Reef");

    await userEvent.click(applyButton());

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(region("Team Reef")).toBeInTheDocument();
  });

  it("escribe la ventana en español", async () => {
    stubClub();
    await openScreen("es");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Editar nombre y color de Team Kelp",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Editar equipo" });
    expect(
      await within(dialog).findByRole("textbox", { name: "Nombre" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radiogroup", { name: "Color del peto · Azul" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "Dorado (lo usa Team Tide)" }),
    ).toBeDisabled();
    expect(dialog).toHaveTextContent("El tachado es el color del otro equipo.");
    expect(dialog).toHaveTextContent(
      "Se usa en todos los eventos desde ahora. Los equipos ya publicados conservan sus colores.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Aplicar" }),
    ).toBeInTheDocument();
  });

  it("avisa en español que el equipo cambió", async () => {
    stubClub();
    await openScreen("es");
    await userEvent.click(
      screen.getByRole("button", {
        name: "Editar nombre y color de Team Kelp",
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Aplicar" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Equipo actualizado · se usa en todos los eventos desde ahora",
    );
  });
});

describe("en el móvil (#762)", () => {
  /** Kelp con Mateo (Ataque, 9) y Daniela (8), Tide con Ethan (Ataque, sin
   * evaluar) y Ruby en "Quizás". */
  const ETHAN_FORWARD = { ...ETHAN, position: FORWARD };
  const PHONE_BUILDER = builderFor(SCRIMMAGE, {
    available: [DANIELA, ETHAN_FORWARD, MATEO],
    split: {
      mode: "manual",
      publishedAt: null,
      assignments: [
        assigned(DANIELA, "a"),
        assigned(ETHAN_FORWARD, "b"),
        assigned(MATEO, "a"),
      ],
    },
  });

  async function openPhoneScreen(locale: "en" | "es" = "en"): Promise<void> {
    stubScreenWidth(true);
    stubClub({ builders: [PHONE_BUILDER, builderFor(COMPETITION)] });
    render(<TeamBuilderScreen locale={locale} />);
    await screen.findByRole("tablist");
  }

  function tab(name: RegExp): HTMLElement {
    return screen.getByRole("tab", { name });
  }

  function phoneBar(): HTMLElement {
    const bar = saveButton().closest(".team-phone-bar");
    if (!(bar instanceof HTMLElement)) {
      throw new Error("Guardar no está en la barra fija del móvil.");
    }
    return bar;
  }

  function phoneRow(name: string): HTMLElement {
    return playerRow(screen.getByRole("tabpanel"), name);
  }

  it("lleva en la cabecera el título, Auto-balance como botón de icono y los totales", async () => {
    await openPhoneScreen();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Sat 19 Jun · Scrimmage");
    const header = heading.closest("header");
    if (header === null) {
      throw new Error("El título no está en la cabecera.");
    }
    expect(header).toHaveTextContent("Teams");
    expect(
      within(header).getByRole("button", { name: "Auto-balance" }),
    ).toHaveTextContent("");
    expect(
      within(header).getByRole("group", { name: "Totals" }),
    ).toHaveTextContent("Team Kelp 17.0 12.0 apart 5.0 Team Tide");
  });

  it("pone tres pestañas con el nombre corto, el banco y cuántos hay en cada una", async () => {
    await openPhoneScreen();

    const tabs = within(
      screen.getByRole("tablist", { name: "Teams and bench" }),
    ).getAllByRole("tab");

    expect(tabs[0]).toHaveAccessibleName("Kelp 2 players");
    expect(tabs[1]).toHaveAccessibleName("Tide 1 player");
    expect(tabs[2]).toHaveAccessibleName("Bench 1 player");
    expect(tabs.map((each) => each.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("enseña sólo el contenido de la pestaña elegida", async () => {
    await openPhoneScreen();
    expect(region("Team Kelp")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Team Tide" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Maybe" })).toBeNull();

    await userEvent.click(tab(/^Bench/));

    expect(tab(/^Bench/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: /^Bench/ })).toBeVisible();
    expect(region("Available · Going")).toBeInTheDocument();
    expect(region("Maybe")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Team Kelp" })).toBeNull();
  });

  it("mueve entre pestañas con las flechas, Inicio y Fin", async () => {
    await openPhoneScreen();
    tab(/^Kelp/).focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(tab(/^Tide/)).toHaveFocus();
    expect(tab(/^Tide/)).toHaveAttribute("aria-selected", "true");
    expect(region("Team Tide")).toBeInTheDocument();

    await userEvent.keyboard("{End}");
    expect(tab(/^Bench/)).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(tab(/^Kelp/)).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(tab(/^Bench/)).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(tab(/^Kelp/)).toHaveAttribute("aria-selected", "true");
  });

  it("lleva en la pestaña del equipo su tarjeta con el resumen, editar y la cobertura", async () => {
    await openPhoneScreen();

    const card = region("Team Kelp");
    expect(card).toHaveTextContent("2 players · avg 8.5");
    expect(
      within(card).getByRole("button", {
        name: "Edit name and colour of Team Kelp",
      }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("list", { name: "Position coverage" }),
    ).toBeInTheDocument();
  });

  it("escribe en cada fila la posición y el OVR, o Sin evaluar, y Cambiar y Quitar", async () => {
    await openPhoneScreen();

    const mateo = phoneRow("Mateo Restrepo");
    expect(mateo).toHaveTextContent("Forward · OVR 9.0");
    expect(phoneRow("Daniela Vargas")).toHaveTextContent("OVR 8.0");
    expect(
      within(mateo).getByRole("button", {
        name: "Move Mateo Restrepo to Team Tide",
      }),
    ).toBeInTheDocument();
    expect(
      within(mateo).getByRole("button", {
        name: "Remove Mateo Restrepo from Team Kelp",
      }),
    ).toBeInTheDocument();

    await userEvent.click(tab(/^Tide/));

    expect(phoneRow("Ethan Brown")).toHaveTextContent("Forward · Unrated");
  });

  it("da en el banco un botón por equipo con su punto y +, que dice a quién añade", async () => {
    await openPhoneScreen();
    await userEvent.click(tab(/^Bench/));

    const ruby = phoneRow("Ruby Tan");
    for (const team of ["Team Kelp", "Team Tide"]) {
      const add = within(ruby).getByRole("button", {
        name: `Add Ruby Tan to ${team}`,
      });
      expect(add).toHaveTextContent("");
      expect(add.querySelector("svg")).not.toBeNull();
    }
  });

  it("añade desde el banco sin salir de la pestaña y cambia los números", async () => {
    await openPhoneScreen();
    await userEvent.click(tab(/^Bench/));

    await userEvent.click(
      screen.getByRole("button", { name: "Add Ruby Tan to Team Kelp" }),
    );

    expect(tab(/^Bench/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Kelp/)).toHaveAccessibleName("Kelp 3 players");
    expect(tab(/^Bench/)).toHaveAccessibleName("Bench 0 players");
  });

  it("deja Guardar y Publicar en la barra fija, sin aviso mientras no hay cambios", async () => {
    await openPhoneScreen();

    expect(
      within(phoneBar()).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
    expect(
      within(phoneBar()).getByRole("button", { name: "Publish" }),
    ).toBeInTheDocument();
    expect(phoneBar()).not.toHaveClass("team-phone-bar-unsaved");
  });

  it("marca la barra y Guardar en cuanto hay cambios sin guardar", async () => {
    await openPhoneScreen();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Mateo Restrepo from Team Kelp",
      }),
    );

    expect(phoneBar()).toHaveClass("team-phone-bar-unsaved");
    expect(saveButton()).toHaveTextContent("Save · Unsaved");
  });

  it("pregunta en una hoja inferior antes de publicar, con el texto del escritorio", async () => {
    await openPhoneScreen();

    await userEvent.click(publishButton());

    const sheet = screen.getByRole("dialog", { name: PUBLISH_QUESTION });
    expect(sheet.tagName).toBe("DIALOG");
    expect(sheet).toHaveClass("directory-sheet");
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    expect(
      within(sheet).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("no deja salir el foco de la hoja con el tabulador", async () => {
    await openPhoneScreen();
    await userEvent.click(publishButton());
    const sheet = screen.getByRole("dialog", { name: PUBLISH_QUESTION });
    within(sheet).getByRole("button", { name: "Publish" }).focus();

    await userEvent.tab();

    expect(sheet).toContainElement(document.activeElement as HTMLElement);
  });

  it("publica desde la hoja y la cierra", async () => {
    await openPhoneScreen();
    await userEvent.click(publishButton());

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Publish",
      }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Published · 3 players notified",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes().map((write) => write.path)).toEqual([
      `${builderPath(SCRIMMAGE.id)}/publication`,
    ]);
  });

  it("devuelve el foco a Publicar al publicar desde la hoja", async () => {
    await openPhoneScreen();
    await userEvent.click(publishButton());

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Publish",
      }),
    );

    await screen.findByText("Published · 3 players notified");
    expect(publishButton()).toHaveFocus();
  });

  it("cierra la hoja con Cancelar sin publicar", async () => {
    await openPhoneScreen();
    await userEvent.click(publishButton());

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("nombra las pestañas en español", async () => {
    await openPhoneScreen("es");

    expect(
      screen.getByRole("tablist", { name: "Equipos y banco" }),
    ).toBeInTheDocument();
    expect(tab(/^Banco/)).toHaveAccessibleName("Banco 1 jugador");
    expect(phoneRow("Mateo Restrepo")).toHaveTextContent("Ataque · OVR 9,0");
  });

  it("en el escritorio no hay pestañas ni barra fija", async () => {
    stubClub();

    await openScreen();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(saveButton().closest(".team-phone-bar")).toBeNull();
  });
});
