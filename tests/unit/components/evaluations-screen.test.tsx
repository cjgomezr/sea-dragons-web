import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationsScreen } from "@/components/evaluations/EvaluationsScreen";
import type { ScreenRosterEntry } from "@/components/evaluations/evaluations-client";
import type { EvaluationsTab } from "@/lib/evaluations/evaluations-address";
import type {
  EvaluationRating,
  MemberEvaluation,
} from "@/lib/evaluations/member-evaluation";
import {
  DEFAULT_ROSTER_VIEW,
  type RosterView,
} from "@/lib/evaluations/roster-view";

/**
 * La pantalla de Evaluaciones (#322, RF-6 del PRD de E9; #818, RF-2 del de
 * E31): las pestañas, la tabla de jugadores con su búsqueda, sus filtros y su
 * orden, la ficha de quien se elija y la edición de sus valoraciones. La API
 * es un doble: lo que se prueba es qué pide la pantalla y qué enseña con lo
 * que le responden.
 */

const SCREEN_PATH = "/evaluaciones";
const ROSTER_PATH = "/api/v1/evaluations";
const CATEGORIES_PATH = "/api/v1/evaluations/categories";
const READ_AT = "2026-09-27T01:02:03.123456+00:00";
const SAVED_AT = "2026-09-27T01:05:00.654321+00:00";

const FORWARD = {
  id: "90510000-0000-4000-8000-000000000001",
  names: { en: "Forward", es: "Delantero" },
} as const;
const CENTRE = {
  id: "90510000-0000-4000-8000-000000000002",
  names: { en: "Centre", es: "Centro" },
} as const;

const CAMILA: ScreenRosterEntry = {
  status: "evaluated",
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Camila Ortiz",
  position: FORWARD,
  photoUrl: null,
  overall: 7.5,
  updatedAt: READ_AT,
  updatedBy: "Carla Coach",
};

const MATEO: ScreenRosterEntry = {
  status: "not_evaluated",
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Mateo Ruiz",
  position: CENTRE,
  photoUrl: null,
};

const JOSE: ScreenRosterEntry = {
  status: "evaluated",
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "José Peña",
  position: FORWARD,
  photoUrl: null,
  overall: 6.2,
  updatedAt: "2026-06-03T02:00:00+00:00",
  updatedBy: null,
};

const ROSTER = [CAMILA, JOSE, MATEO] as const;

const CATEGORIES = [
  {
    id: "ca7e0000-0000-4000-8000-000000000001",
    name: "Fitness",
    isActive: true,
  },
  { id: "ca7e0000-0000-4000-8000-000000000002", name: "Speed", isActive: true },
  { id: "ca7e0000-0000-4000-8000-000000000003", name: "Old", isActive: false },
] as const;

const FITNESS_ID = "ca7e0000-0000-4000-8000-000000000001";
const SPEED_ID = "ca7e0000-0000-4000-8000-000000000002";

const CAMILA_RATINGS: readonly EvaluationRating[] = [
  { categoryId: FITNESS_ID, name: "Fitness", rating: 8, isRetired: false },
  { categoryId: SPEED_ID, name: "Speed", rating: 7, isRetired: false },
];

const JOSE_RATINGS: readonly EvaluationRating[] = [
  { categoryId: FITNESS_ID, name: "Fitness", rating: 7, isRetired: false },
  { categoryId: SPEED_ID, name: "Speed", rating: 5, isRetired: false },
];

function evaluated(
  memberId: string,
  ratings: readonly EvaluationRating[],
  updatedAt = READ_AT,
  isCurrent = true,
): MemberEvaluation {
  const sum = ratings.reduce((total, entry) => total + entry.rating, 0);
  return {
    status: "evaluated",
    memberId,
    updatedAt,
    overallRating: Math.round((sum * 10) / ratings.length) / 10,
    ratings,
    isCurrent,
  };
}

type Call = { readonly method: string; readonly url: string; body: unknown };

type Responder = (call: Call) => Response | Promise<Response>;

const calls: Call[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  reason?: string,
): Response {
  return jsonResponse(status, { error: { code, message: "x", reason } });
}

function stubApi(respond: Responder): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      return respond(call);
    }),
  );
}

const JOSE_UPDATED_AT = "2026-06-03T02:00:00+00:00";

/** El resumen de la plantilla de siempre (#817): Speed es la más baja y José
 * lleva más tiempo sin revisar. */
const SUMMARY = {
  evaluatedCount: 2,
  playerCount: 3,
  categoryAverages: [
    {
      categoryId: "ca7e0000-0000-4000-8000-000000000001",
      name: "Fitness",
      average: 7.5,
    },
    {
      categoryId: "ca7e0000-0000-4000-8000-000000000002",
      name: "Speed",
      average: 6.1,
    },
  ],
  averageOverall: 6.9,
  longestUnreviewed: [
    {
      userId: "dddddddd-0000-4000-8000-00000000000d",
      fullName: "José Peña",
      updatedAt: JOSE_UPDATED_AT,
    },
    {
      userId: "aaaaaaaa-0000-4000-8000-00000000000a",
      fullName: "Camila Ortiz",
      updatedAt: READ_AT,
    },
  ],
};

function rosterResponse(
  members: readonly ScreenRosterEntry[],
  summary: unknown = SUMMARY,
): Response {
  return jsonResponse(200, { data: { members, summary } });
}

/** Lo que responde un club con Camila y José evaluados, Mateo sin evaluar y
 * dos categorías activas. */
function clubApi(overrides: Partial<Record<string, Responder>> = {}): void {
  stubApi((call) => {
    const override = overrides[`${call.method} ${call.url}`];
    if (override !== undefined) {
      return override(call);
    }
    if (call.url === ROSTER_PATH) {
      return rosterResponse(ROSTER);
    }
    if (call.url === CATEGORIES_PATH) {
      return jsonResponse(200, { data: { categories: CATEGORIES } });
    }
    if (call.url === `${ROSTER_PATH}/${CAMILA.userId}`) {
      return jsonResponse(200, {
        data: evaluated(CAMILA.userId, CAMILA_RATINGS),
      });
    }
    if (call.url === `${ROSTER_PATH}/${JOSE.userId}`) {
      return jsonResponse(200, {
        data: evaluated(JOSE.userId, JOSE_RATINGS, JOSE_UPDATED_AT),
      });
    }
    if (call.url === `${ROSTER_PATH}/${MATEO.userId}`) {
      return jsonResponse(200, {
        data: { status: "not_evaluated", memberId: MATEO.userId },
      });
    }
    throw new Error(`Petición inesperada: ${call.method} ${call.url}`);
  });
}

/** Una plantilla propia, con las categorías de siempre. */
function rosterApi(members: readonly ScreenRosterEntry[]): void {
  clubApi({ [`GET ${ROSTER_PATH}`]: () => rosterResponse(members) });
}

function savedWith(call: Call): Response {
  const body = call.body as {
    ratings: { categoryId: string; rating: number }[];
  };
  const ratings = CAMILA_RATINGS.map((entry) => ({
    ...entry,
    rating:
      body.ratings.find((change) => change.categoryId === entry.categoryId)
        ?.rating ?? entry.rating,
  }));
  return jsonResponse(200, {
    data: evaluated(CAMILA.userId, ratings, SAVED_AT),
  });
}

function callsTo(method: string): readonly Call[] {
  return calls.filter((call) => call.method === method);
}

/** Las lecturas de la plantilla y de las fichas, sin las de categorías. */
function evaluationReads(): readonly Call[] {
  return callsTo("GET").filter((call) => call.url !== CATEGORIES_PATH);
}

type ScreenOptions = {
  readonly locale?: "en" | "es";
  readonly initialMemberId?: string | null;
  readonly initialTab?: EvaluationsTab;
  readonly initialView?: Partial<RosterView>;
  readonly canOpenMemberRecords?: boolean;
};

/** Pinta la pantalla como la deja la dirección `/evaluaciones` con lo que
 * diga `options`, igual que la página tras recargar. */
function mountScreen({
  locale = "en",
  initialMemberId = null,
  initialTab = "players",
  initialView = {},
  canOpenMemberRecords = true,
}: ScreenOptions = {}): void {
  render(
    <EvaluationsScreen
      locale={locale}
      initialMemberId={initialMemberId}
      initialTab={initialTab}
      initialView={{ ...DEFAULT_ROSTER_VIEW, ...initialView }}
      canOpenMemberRecords={canOpenMemberRecords}
    />,
  );
}

async function renderScreen(options: ScreenOptions = {}): Promise<void> {
  mountScreen(options);
  await screen.findByRole("list", { name: /^(players|jugadores)$/i });
}

const RATINGS_LIST = /^ratings · 1–10$/i;

/** La fila de la tabla: el resumen también lleva botones con nombres. */
function memberButton(name: RegExp): HTMLElement {
  const list = screen.getByRole("list", { name: /^(players|jugadores)$/i });
  return within(list).getByRole("button", { name });
}

/** Los nombres de las filas, en el orden en que salen. */
function rowNames(): readonly string[] {
  const list = screen.getByRole("list", { name: /^(players|jugadores)$/i });
  return within(list)
    .getAllByRole("button")
    .map(
      (row) =>
        row.querySelector(".evaluation-row-name")?.textContent ??
        "(sin nombre)",
    );
}

function addressParams(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

async function openMember(name: RegExp): Promise<HTMLElement> {
  await userEvent.click(memberButton(name));
  return screen.findByRole("region", { name: /evaluation of|evaluación de/i });
}

async function openCamila(): Promise<HTMLElement> {
  const sheet = await openMember(/camila ortiz/i);
  await within(sheet).findByRole("list", { name: RATINGS_LIST });
  return sheet;
}

async function startEditing(sheet: HTMLElement): Promise<void> {
  await userEvent.click(
    within(sheet).getByRole("button", { name: /edit ratings/i }),
  );
}

function setSlider(sheet: HTMLElement, category: string, value: number): void {
  fireEvent.change(within(sheet).getByRole("slider", { name: category }), {
    target: { value: String(value) },
  });
}

beforeEach(() => {
  calls.length = 0;
  window.history.replaceState(null, "", SCREEN_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pestañas", () => {
  it("lleva el título, la entradilla y las pestañas con su número", async () => {
    clubApi();

    await renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Evaluations" }),
    ).toBeInTheDocument();
    const tabs = screen.getByRole("tablist");
    const players = within(tabs).getByRole("tab", { name: /players/i });
    expect(players).toHaveAttribute("aria-selected", "true");
    expect(players).toHaveTextContent("3");
    const categories = within(tabs).getByRole("tab", { name: /categories/i });
    expect(categories).toHaveAttribute("aria-selected", "false");
    await waitFor(() => expect(categories).toHaveTextContent("2"));
    expect(
      screen.getByRole("tabpanel", { name: /players/i }),
    ).toBeInTheDocument();
  });

  it("abre Categorías, enseña su contenido y lo deja en la dirección", async () => {
    clubApi();
    await renderScreen();

    await userEvent.click(screen.getByRole("tab", { name: /categories/i }));

    const panel = screen.getByRole("tabpanel", { name: /categories/i });
    expect(
      await within(panel).findByRole("heading", { name: "Active categories" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Players" })).toBeNull();
    expect(addressParams()).toEqual({ tab: "categories" });
  });

  it("vuelve a Jugadores y quita la pestaña de la dirección", async () => {
    clubApi();
    window.history.replaceState(null, "", `${SCREEN_PATH}?tab=categories`);
    mountScreen({ initialTab: "categories" });

    await userEvent.click(screen.getByRole("tab", { name: /players/i }));

    expect(
      await screen.findByRole("list", { name: "Players" }),
    ).toBeInTheDocument();
    expect(addressParams()).toEqual({});
  });

  it("se mueve entre pestañas con las flechas", async () => {
    clubApi();
    await renderScreen();

    screen.getByRole("tab", { name: /players/i }).focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: /categories/i })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /categories/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("tabla de jugadores", () => {
  it("lleva la cabecera de columnas y cada fila con su posición, OVR y fecha", async () => {
    clubApi();

    await renderScreen();

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
    const camila = memberButton(/camila ortiz/i);
    expect(camila).toHaveTextContent("Forward");
    expect(camila).toHaveTextContent("7.5");
    expect(camila).toHaveTextContent(/27 Sep/);
    const mateo = memberButton(/mateo ruiz/i);
    expect(mateo).toHaveTextContent("Centre");
    expect(mateo).toHaveTextContent("—");
    expect(mateo).toHaveTextContent(/not evaluated/i);
  });

  it("pone la raya de vacío a una evaluación sin categorías, sin inventar un OVR", async () => {
    const ruby: ScreenRosterEntry = {
      status: "evaluated",
      userId: "cccccccc-0000-4000-8000-00000000000c",
      fullName: "Ruby Walsh",
      position: null,
      photoUrl: null,
      overall: null,
      updatedAt: READ_AT,
      updatedBy: null,
    };
    rosterApi([ruby]);

    await renderScreen();

    const button = memberButton(/ruby walsh/i);
    expect(button).toHaveTextContent("—");
    expect(button).toHaveTextContent(/27 Sep/);
    expect(button).not.toHaveTextContent(/not evaluated/i);
  });

  it("ordena por nombre por defecto", async () => {
    clubApi();

    await renderScreen();

    expect(rowNames()).toEqual(["Camila Ortiz", "José Peña", "Mateo Ruiz"]);
  });

  it("dice cuántos enseña de cuántos y la regla del OVR al pie", async () => {
    clubApi();

    await renderScreen();

    expect(screen.getByText("3 of 3 players")).toBeInTheDocument();
    expect(
      screen.getByText("OVR = average of the categories in each evaluation"),
    ).toBeInTheDocument();
  });

  it("explica que no hay nadie que evaluar con la lista vacía", async () => {
    rosterApi([]);

    mountScreen();

    expect(
      await screen.findByText(/nobody in the club to evaluate/i),
    ).toBeInTheDocument();
  });

  it("deja reintentar cuando la lista no se puede leer", async () => {
    let attempts = 0;
    clubApi({
      [`GET ${ROSTER_PATH}`]: () => {
        attempts += 1;
        return attempts === 1
          ? errorResponse(500, "internal_error")
          : rosterResponse([CAMILA]);
      },
    });
    mountScreen();

    await userEvent.click(
      await screen.findByRole("button", { name: /try again/i }),
    );

    await screen.findByRole("list", { name: "Players" });
    expect(memberButton(/camila ortiz/i)).toBeInTheDocument();
  });
});

describe("buscar y filtrar", () => {
  it("busca por nombre sin tildes y lo deja en la dirección", async () => {
    clubApi();
    await renderScreen();

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by name/i }),
      "jose",
    );

    expect(rowNames()).toEqual(["José Peña"]);
    expect(addressParams()).toEqual({ q: "jose" });
    expect(screen.getByText("1 of 3 players")).toBeInTheDocument();
  });

  it("busca también con tildes y mayúsculas", async () => {
    clubApi();
    await renderScreen();

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by name/i }),
      "PEÑA",
    );

    expect(rowNames()).toEqual(["José Peña"]);
  });

  it("lleva las fichas Todos y Sin evaluar con su número", async () => {
    clubApi();

    await renderScreen();

    const all = screen.getByRole("button", { name: /^all/i });
    expect(all).toHaveTextContent("3");
    expect(all).toHaveAttribute("aria-pressed", "true");
    const pending = screen.getByRole("button", { name: /^not evaluated/i });
    expect(pending).toHaveTextContent("1");
    expect(pending).toHaveAttribute("aria-pressed", "false");
  });

  it("con Sin evaluar deja sólo a quien no tiene evaluación", async () => {
    clubApi();
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: /^not evaluated/i }),
    );

    expect(rowNames()).toEqual(["Mateo Ruiz"]);
    expect(
      screen.getByRole("button", { name: /^not evaluated/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(addressParams()).toEqual({ filtro: "sin-evaluar" });
  });

  it("filtra por posición entre las del club", async () => {
    clubApi();
    await renderScreen();
    const position = screen.getByRole("combobox", { name: "Position" });

    expect(
      within(position)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All positions", "Centre", "Forward"]);
    await userEvent.selectOptions(position, "Forward");

    expect(rowNames()).toEqual(["Camila Ortiz", "José Peña"]);
    expect(addressParams()).toEqual({ posicion: FORWARD.id });
  });

  it("ordena por OVR de mayor a menor con los sin evaluar al final", async () => {
    clubApi();
    await renderScreen();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sort by" }),
      "OVR high → low",
    );

    expect(rowNames()).toEqual(["Camila Ortiz", "José Peña", "Mateo Ruiz"]);
    expect(addressParams()).toEqual({ orden: "ovr-desc" });
  });

  it("ordena por OVR de menor a mayor con los sin evaluar al final", async () => {
    clubApi();
    await renderScreen();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sort by" }),
      "OVR low → high",
    );

    expect(rowNames()).toEqual(["José Peña", "Camila Ortiz", "Mateo Ruiz"]);
  });

  it("ordena por la evaluación más antigua con los sin evaluar primero", async () => {
    clubApi();
    await renderScreen();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sort by" }),
      "Oldest evaluation first",
    );

    expect(rowNames()).toEqual(["Mateo Ruiz", "José Peña", "Camila Ortiz"]);
    expect(addressParams()).toEqual({ orden: "antigua" });
  });

  it("sin resultados lo dice y Borrar filtros los quita", async () => {
    clubApi();
    await renderScreen();
    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by name/i }),
      "zzz",
    );

    expect(screen.getByText("No player matches.")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" }),
    );

    expect(rowNames()).toEqual(["Camila Ortiz", "José Peña", "Mateo Ruiz"]);
    expect(screen.getByRole("searchbox", { name: /search/i })).toHaveValue("");
    expect(addressParams()).toEqual({});
  });

  it("arranca con la vista que trae la dirección, como tras recargar", async () => {
    clubApi();

    await renderScreen({
      initialView: { filter: "not_evaluated", sort: "oldest" },
    });

    expect(rowNames()).toEqual(["Mateo Ruiz"]);
    expect(
      screen.getByRole("button", { name: /^not evaluated/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue(
      "oldest",
    );
  });
});

describe("posición que nadie tiene", () => {
  it("con una posición de la dirección que nadie tiene enseña a todos", async () => {
    clubApi();

    await renderScreen({
      initialView: { positionId: "90510000-0000-4000-8000-0000000000ff" },
    });

    expect(rowNames()).toEqual(["Camila Ortiz", "José Peña", "Mateo Ruiz"]);
    expect(screen.getByRole("combobox", { name: "Position" })).toHaveValue("");
  });
});

describe("fila elegida", () => {
  it("marca la fila abierta con aria-current", async () => {
    clubApi();
    await renderScreen();

    await openCamila();

    expect(memberButton(/camila ortiz/i)).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(memberButton(/mateo ruiz/i)).not.toHaveAttribute("aria-current");
  });

  it("pulsarla otra vez la suelta y cierra la ficha", async () => {
    clubApi();
    await renderScreen();
    await openCamila();

    await userEvent.click(memberButton(/camila ortiz/i));

    expect(memberButton(/camila ortiz/i)).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("region", { name: /evaluation of/i })).toBeNull();
  });
});

describe("en español", () => {
  it("sale la cabecera, las fichas, los selectores y el pie en español", async () => {
    clubApi();

    await renderScreen({ locale: "es" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Evaluaciones" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /jugadores/i })).toBeVisible();
    expect(screen.getByRole("tab", { name: /categorías/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^todos/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^sin evaluar/i })).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Buscar por nombre" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("combobox", { name: "Posición" })).getByRole(
        "option",
        { name: "Todas las posiciones" },
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("combobox", { name: "Ordenar por" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Nombre A–Z",
      "OVR de mayor a menor",
      "OVR de menor a mayor",
      "Evaluación más antigua",
    ]);
    expect(screen.getByText("Jugador")).toBeInTheDocument();
    expect(screen.getByText("Actualizada")).toBeInTheDocument();
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent(/sin evaluar/i);
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent("Centro");
    expect(screen.getByText("3 de 3 jugadores")).toBeInTheDocument();
    expect(
      screen.getByText("OVR = media de las categorías de cada evaluación"),
    ).toBeInTheDocument();
  });

  it("dice en español que nadie coincide", async () => {
    clubApi();
    await renderScreen({ locale: "es" });

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Buscar por nombre" }),
      "zzz",
    );

    expect(screen.getByText("Ningún jugador coincide.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Borrar filtros" }),
    ).toBeVisible();
  });
});
describe("ficha de evaluación", () => {
  it("enseña cada categoría con su valoración y el OVR destacado", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openCamila();

    const ratings = within(sheet).getByRole("list", { name: RATINGS_LIST });
    const items = within(ratings).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Fitness8 out of 10",
      "Speed7 out of 10",
    ]);
    expect(
      within(sheet).getByRole("heading", { name: /camila ortiz/i }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("7.5")).toBeInTheDocument();
  });

  it("ofrece crear la evaluación que falta y la enseña con todas las categorías en 5", async () => {
    const created = evaluated(MATEO.userId, [
      { ...CAMILA_RATINGS[0]!, rating: 5 },
      { ...CAMILA_RATINGS[1]!, rating: 5 },
    ]);
    clubApi({
      [`POST ${ROSTER_PATH}/${MATEO.userId}`]: () =>
        jsonResponse(201, { data: created }),
    });
    await renderScreen();
    const sheet = await openMember(/mateo ruiz/i);

    await userEvent.click(
      await within(sheet).findByRole("button", { name: /start evaluation/i }),
    );

    expect(
      await within(sheet).findByRole("slider", { name: "Fitness" }),
    ).toHaveValue("5");
    expect(within(sheet).getByRole("slider", { name: "Speed" })).toHaveValue(
      "5",
    );
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent("5");
    expect(memberButton(/mateo ruiz/i)).not.toHaveTextContent(/not evaluated/i);
  });

  it("guarda lo ajustado y actualiza el OVR sin recargar", async () => {
    clubApi({ [`PUT ${ROSTER_PATH}/${CAMILA.userId}`]: savedWith });
    await renderScreen();
    const sheet = await openCamila();
    await startEditing(sheet);

    setSlider(sheet, "Fitness", 10);
    await userEvent.click(
      within(sheet).getByRole("button", { name: /save ratings/i }),
    );

    expect(await within(sheet).findByText("8.5")).toBeInTheDocument();
    expect(callsTo("PUT")[0]?.body).toEqual({
      expectedUpdatedAt: READ_AT,
      ratings: [
        { categoryId: FITNESS_ID, rating: 10 },
        { categoryId: SPEED_ID, rating: 7 },
      ],
    });
    expect(memberButton(/camila ortiz/i)).toHaveTextContent("8.5");
    expect(evaluationReads()).toHaveLength(2);
  });

  it("no manda una segunda petición al pulsar guardar dos veces seguidas", async () => {
    clubApi({ [`PUT ${ROSTER_PATH}/${CAMILA.userId}`]: savedWith });
    await renderScreen();
    const sheet = await openCamila();
    await startEditing(sheet);
    const save = within(sheet).getByRole("button", { name: /save ratings/i });

    fireEvent.click(save);
    fireEvent.click(save);

    await within(sheet).findByRole("button", { name: /edit ratings/i });
    expect(callsTo("PUT")).toHaveLength(1);
  });

  it("avisa de un fallo de red y deja reintentar sin perder lo ajustado", async () => {
    let attempts = 0;
    clubApi({
      [`PUT ${ROSTER_PATH}/${CAMILA.userId}`]: (call) => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return savedWith(call);
      },
    });
    await renderScreen();
    const sheet = await openCamila();
    await startEditing(sheet);
    setSlider(sheet, "Fitness", 10);

    await userEvent.click(
      within(sheet).getByRole("button", { name: /save ratings/i }),
    );

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(within(sheet).getByRole("slider", { name: "Fitness" })).toHaveValue(
      "10",
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: /save ratings/i }),
    );
    expect(await within(sheet).findByText("8.5")).toBeInTheDocument();
  });

  it("avisa de que alguien más la cambió y ofrece recargarla", async () => {
    let reads = 0;
    clubApi({
      [`PUT ${ROSTER_PATH}/${CAMILA.userId}`]: () =>
        errorResponse(409, "conflict", "evaluation_changed"),
      [`GET ${ROSTER_PATH}/${CAMILA.userId}`]: () => {
        reads += 1;
        const ratings =
          reads === 1
            ? CAMILA_RATINGS
            : [{ ...CAMILA_RATINGS[0]!, rating: 3 }, CAMILA_RATINGS[1]!];
        return jsonResponse(200, {
          data: evaluated(CAMILA.userId, ratings, SAVED_AT),
        });
      },
    });
    await renderScreen();
    const sheet = await openCamila();
    await startEditing(sheet);
    setSlider(sheet, "Fitness", 10);

    await userEvent.click(
      within(sheet).getByRole("button", { name: /save ratings/i }),
    );
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      /someone else changed/i,
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: /reload/i }),
    );

    expect(await within(sheet).findByText("5.0")).toBeInTheDocument();
    expect(within(sheet).queryByRole("slider")).toBeNull();
    expect(memberButton(/camila ortiz/i)).toHaveTextContent("5.0");
  });

  it("si alguien más la creó antes, avisa y ofrece recargarla en vez de reintentar", async () => {
    let reads = 0;
    clubApi({
      [`POST ${ROSTER_PATH}/${MATEO.userId}`]: () =>
        errorResponse(409, "conflict", "evaluation_exists"),
      [`GET ${ROSTER_PATH}/${MATEO.userId}`]: () => {
        reads += 1;
        return jsonResponse(200, {
          data:
            reads === 1
              ? { status: "not_evaluated", memberId: MATEO.userId }
              : evaluated(MATEO.userId, CAMILA_RATINGS),
        });
      },
    });
    await renderScreen();
    const sheet = await openMember(/mateo ruiz/i);

    await userEvent.click(
      await within(sheet).findByRole("button", { name: /start evaluation/i }),
    );
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      /someone else just created/i,
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: /reload/i }),
    );

    expect(await within(sheet).findByText("7.5")).toBeInTheDocument();
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent("7.5");
    expect(callsTo("POST")).toHaveLength(1);
  });

  it("vuelve a la lista con el botón de volver", async () => {
    clubApi();
    await renderScreen();
    const sheet = await openCamila();

    await userEvent.click(
      within(sheet).getByRole("button", { name: /all members/i }),
    );

    expect(screen.queryByRole("region", { name: /evaluation of/i })).toBeNull();
    await waitFor(() => expect(memberButton(/camila ortiz/i)).toHaveFocus());
  });

  it("sale entera en español", async () => {
    clubApi();
    await renderScreen({ locale: "es" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Evaluaciones" }),
    ).toBeInTheDocument();
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent(/sin evaluar/i);
    const sheet = await openMember(/camila ortiz/i);
    const ratings = await within(sheet).findByRole("list", {
      name: /^notas/i,
    });
    expect(within(ratings).getAllByRole("listitem")[0]).toHaveTextContent(
      "Fitness8 de 10",
    );
    expect(
      within(sheet).getByRole("button", { name: /editar notas/i }),
    ).toBeInTheDocument();
  });
});

describe("poner al día una evaluación", () => {
  const BREATH_HOLD_ID = "ca7e0000-0000-4000-8000-000000000011";
  const REFRESH_PATH = `POST ${ROSTER_PATH}/${CAMILA.userId}/refresh`;
  const OUTDATED_RATINGS: readonly EvaluationRating[] = [
    CAMILA_RATINGS[0]!,
    { ...CAMILA_RATINGS[1]!, isRetired: true },
  ];
  const REFRESHED_RATINGS: readonly EvaluationRating[] = [
    CAMILA_RATINGS[0]!,
    {
      categoryId: BREATH_HOLD_ID,
      name: "Breath hold",
      rating: 5,
      isRetired: false,
    },
  ];

  function refreshedResponse(): Response {
    return jsonResponse(200, {
      data: {
        outcome: { kind: "refreshed", addedCount: 1, removedCount: 1 },
        evaluation: evaluated(CAMILA.userId, REFRESHED_RATINGS, SAVED_AT),
      },
    });
  }

  /** El club desactivó Speed y añadió Breath hold después de evaluarla. */
  const CHANGED_CATEGORIES = [
    CATEGORIES[0],
    { id: BREATH_HOLD_ID, name: "Breath hold", isActive: true },
    { ...CATEGORIES[1], isActive: false },
    CATEGORIES[2],
  ];

  function outdatedApi(refresh: Responder): void {
    clubApi({
      [`GET ${CATEGORIES_PATH}`]: () =>
        jsonResponse(200, { data: { categories: CHANGED_CATEGORIES } }),
      [`GET ${ROSTER_PATH}/${CAMILA.userId}`]: () =>
        jsonResponse(200, {
          data: evaluated(CAMILA.userId, OUTDATED_RATINGS, READ_AT, false),
        }),
      [REFRESH_PATH]: refresh,
    });
  }

  function refreshButton(sheet: HTMLElement): HTMLElement {
    return within(sheet).getByRole("button", {
      name: /update to the current categories/i,
    });
  }

  it("la ofrece cuando el conjunto cambió y, al usarla, enseña el conjunto nuevo y el OVR recalculado", async () => {
    outdatedApi(refreshedResponse);
    await renderScreen();
    const sheet = await openCamila();

    await userEvent.click(refreshButton(sheet));

    expect(await within(sheet).findByText("6.5")).toBeInTheDocument();
    const ratings = within(sheet).getByRole("list", { name: RATINGS_LIST });
    expect(
      within(ratings)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Fitness8 out of 10", "Breath hold5 out of 10"]);
    expect(within(sheet).getByRole("status")).toHaveTextContent(
      /now uses the current categories/i,
    );
    expect(
      within(sheet).queryByRole("button", {
        name: /update to the current categories/i,
      }),
    ).toBeNull();
    expect(memberButton(/camila ortiz/i)).toHaveTextContent("6.5");
    expect(callsTo("POST")).toHaveLength(1);
  });

  it("no la ofrece a una evaluación ya al día", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openCamila();

    expect(
      within(sheet).queryByRole("button", {
        name: /update to the current categories/i,
      }),
    ).toBeNull();
  });

  it("no la ofrece mientras se editan las valoraciones", async () => {
    outdatedApi(refreshedResponse);
    await renderScreen();
    const sheet = await openCamila();

    await startEditing(sheet);

    expect(
      within(sheet).queryByRole("button", {
        name: /update to the current categories/i,
      }),
    ).toBeNull();
  });

  it("avisa de un fallo de red y deja reintentar", async () => {
    let attempts = 0;
    outdatedApi(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return refreshedResponse();
    });
    await renderScreen();
    const sheet = await openCamila();

    await userEvent.click(refreshButton(sheet));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(refreshButton(sheet));

    expect(await within(sheet).findByText("6.5")).toBeInTheDocument();
  });

  it("sale en español", async () => {
    outdatedApi(refreshedResponse);
    await renderScreen({ locale: "es" });

    const sheet = await openMember(/camila ortiz/i);

    expect(
      await within(sheet).findByRole("button", {
        name: /poner al día con las categorías actuales/i,
      }),
    ).toBeInTheDocument();
  });
});

describe("abrir la ficha desde el directorio (#324)", () => {
  it("abre ya la ficha del miembro que se pide", async () => {
    clubApi();

    await renderScreen({ initialMemberId: MATEO.userId });

    const sheet = await screen.findByRole("region", {
      name: /evaluation of mateo ruiz/i,
    });
    expect(
      await within(sheet).findByRole("button", { name: /start evaluation/i }),
    ).toBeVisible();
  });

  it("se queda en la lista si el miembro pedido no está en ella", async () => {
    clubApi();

    await renderScreen({
      initialMemberId: "cccccccc-0000-4000-8000-00000000000c",
    });

    expect(screen.queryByRole("region", { name: /evaluation of/i })).toBeNull();
    expect(memberButton(/camila ortiz/i)).toBeVisible();
  });
});

describe("permisos", () => {
  it("dice que no tiene acceso si la API responde 403", async () => {
    stubApi(() => errorResponse(403, "forbidden"));

    mountScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only coaches and admins/i,
    );
  });
});

function overviewPanel(): HTMLElement {
  return screen.getByRole("region", { name: /squad overview/i });
}

function sheetRegion(name: RegExp): Promise<HTMLElement> {
  return screen.findByRole("region", { name });
}

describe("resumen de la plantilla (#819)", () => {
  it("sin nadie elegido dice cuántos están evaluados y ofrece evaluar a los pendientes", async () => {
    clubApi();

    await renderScreen();

    const overview = overviewPanel();
    expect(overview).toHaveTextContent("2 of 3 players evaluated");
    expect(
      within(overview).getByRole("button", { name: "Evaluate the 1 pending" }),
    ).toBeVisible();
  });

  it("con todos evaluados lo dice y no ofrece evaluar a nadie", async () => {
    rosterApi([CAMILA, JOSE]);

    await renderScreen();

    const overview = overviewPanel();
    expect(overview).toHaveTextContent("2 of 2 players evaluated");
    expect(
      within(overview).getByText("✓ Everyone has an evaluation."),
    ).toBeVisible();
    expect(
      within(overview).queryByRole("button", { name: /^evaluate the/i }),
    ).toBeNull();
  });

  it("enseña la media de cada categoría y la de los OVR, con la más baja en aviso", async () => {
    clubApi();

    await renderScreen();

    const overview = overviewPanel();
    const averages = within(overview).getByRole("list", {
      name: /squad average by category/i,
    });
    const rows = within(averages).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Fitness7.5",
      "Speed6.1",
    ]);
    expect(rows[1]).toHaveAttribute("data-lowest", "true");
    expect(rows[0]).not.toHaveAttribute("data-lowest");
    expect(overview).toHaveTextContent("6.9");
    expect(overview).toHaveTextContent(
      "Lowest: Speed, something to work on in training.",
    );
  });

  it("Evaluar a los pendientes deja el filtro en Sin evaluar, ordena por nombre y abre al primero", async () => {
    clubApi();
    window.history.replaceState(
      null,
      "",
      `${SCREEN_PATH}?q=cam&posicion=${FORWARD.id}&orden=ovr-desc`,
    );
    await renderScreen({
      initialView: {
        search: "cam",
        positionId: FORWARD.id,
        sort: "overall_desc",
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Evaluate the 1 pending" }),
    );

    expect(rowNames()).toEqual(["Mateo Ruiz"]);
    expect(screen.getByRole("searchbox", { name: /search/i })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue(
      "name",
    );
    expect(addressParams()).toEqual({ filtro: "sin-evaluar" });
    expect(await sheetRegion(/evaluation of mateo ruiz/i)).toBeInTheDocument();
  });

  it("Más tiempo sin revisar lista a los más antiguos con su fecha y los abre", async () => {
    clubApi();
    await renderScreen();
    const longest = within(overviewPanel()).getByRole("list", {
      name: /longest without review/i,
    });
    const rows = within(longest).getAllByRole("button");
    expect(rows[0]).toHaveTextContent(/José Peña.*3 Jun/);
    expect(rows[1]).toHaveTextContent(/Camila Ortiz.*27 Sep/);

    await userEvent.click(rows[0]!);

    expect(await sheetRegion(/evaluation of josé peña/i)).toBeInTheDocument();
    expect(memberButton(/josé peña/i)).toHaveAttribute("aria-current", "true");
  });

  it("vuelve al resumen al soltar la fila elegida", async () => {
    clubApi();
    await renderScreen();
    await openCamila();

    await userEvent.click(memberButton(/camila ortiz/i));

    expect(overviewPanel()).toBeInTheDocument();
  });

  it("sale en español", async () => {
    clubApi();

    await renderScreen({ locale: "es" });

    const overview = screen.getByRole("region", {
      name: /resumen de la plantilla/i,
    });
    expect(overview).toHaveTextContent("2 de 3 jugadores evaluados");
    expect(
      within(overview).getByRole("button", { name: /^evaluar a/i }),
    ).toBeVisible();
    expect(overview).toHaveTextContent(
      "Más baja: Speed, algo para trabajar en el entrenamiento.",
    );
    expect(
      within(overview).getByRole("list", { name: /más tiempo sin revisar/i }),
    ).toBeInTheDocument();
  });
});

describe("ficha en lectura (#819)", () => {
  const BREATH_HOLD = {
    id: "ca7e0000-0000-4000-8000-000000000011",
    name: "Breath hold",
    isActive: true,
  } as const;

  it("lleva la identidad con la posición y el OVR, y las notas en el orden de Categorías", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openCamila();

    expect(
      within(sheet).getByRole("heading", { level: 2, name: "Camila Ortiz" }),
    ).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Forward");
    expect(within(sheet).getByText("7.5")).toBeInTheDocument();
    const ratings = within(sheet).getByRole("list", { name: RATINGS_LIST });
    expect(
      within(ratings)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Fitness8 out of 10", "Speed7 out of 10"]);
  });

  it("una categoría activa que la evaluación no tiene sale como nueva sin nota, en su sitio", async () => {
    clubApi({
      [`GET ${CATEGORIES_PATH}`]: () =>
        jsonResponse(200, {
          data: {
            categories: [
              CATEGORIES[0],
              BREATH_HOLD,
              CATEGORIES[1],
              CATEGORIES[2],
            ],
          },
        }),
    });
    await renderScreen();

    const sheet = await openCamila();

    const ratings = within(sheet).getByRole("list", { name: RATINGS_LIST });
    await waitFor(() =>
      expect(
        within(ratings)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        "Fitness8 out of 10",
        "Breath holdnew · not rated—",
        "Speed7 out of 10",
      ]),
    );
    expect(within(sheet).getByText("7.5")).toBeInTheDocument();
  });

  it("el pie dice cuándo y quién la actualizó y lleva Editar notas", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openCamila();

    expect(sheet).toHaveTextContent(/Updated 27 Sep.* by Carla Coach/);
    expect(
      within(sheet).getByRole("button", { name: "Edit ratings" }),
    ).toBeVisible();
  });

  it("sin quién la actualizó, el pie dice sólo la fecha", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openMember(/josé peña/i);

    await within(sheet).findByRole("list", { name: RATINGS_LIST });
    expect(sheet).toHaveTextContent(/Updated 3 Jun/);
    expect(sheet).not.toHaveTextContent(/ by /);
  });

  it("a un jugador sin evaluar le ofrece empezar la evaluación", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openMember(/mateo ruiz/i);

    expect(
      await within(sheet).findByText("Mateo Ruiz hasn't been evaluated yet"),
    ).toBeVisible();
    expect(sheet).toHaveTextContent(
      "Every category starts at 5. Until then, Teams counts them as 5.",
    );
    expect(
      within(sheet).getByRole("button", { name: "Start evaluation" }),
    ).toBeVisible();
  });

  it("enlaza al perfil del socio si quien mira puede abrir su ficha", async () => {
    clubApi();
    await renderScreen({ canOpenMemberRecords: true });

    const sheet = await openCamila();

    expect(
      within(sheet).getByRole("link", { name: "Profile" }),
    ).toHaveAttribute("href", `/directorio/${CAMILA.userId}`);
  });

  it("no enlaza al perfil si quien mira no puede abrir la ficha", async () => {
    clubApi();
    await renderScreen({ canOpenMemberRecords: false });

    const sheet = await openCamila();

    expect(within(sheet).queryByRole("link", { name: "Profile" })).toBeNull();
  });

  it("cerrar vuelve al resumen", async () => {
    clubApi();
    await renderScreen();
    const sheet = await openCamila();

    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("region", { name: /evaluation of/i })).toBeNull();
    expect(overviewPanel()).toBeInTheDocument();
  });

  it("sale en español", async () => {
    clubApi();
    await renderScreen({ locale: "es" });

    const sheet = await openMember(/camila ortiz/i);

    expect(
      await within(sheet).findByRole("list", { name: "Notas · 1–10" }),
    ).toBeInTheDocument();
    expect(sheet).toHaveTextContent(/Actualizada 27 sept.* por Carla Coach/);
    expect(sheet).toHaveTextContent("1 de 3 en esta lista");
    expect(within(sheet).getByRole("link", { name: "Perfil" })).toBeVisible();
  });
});

describe("anterior y siguiente (#819)", () => {
  function previousButton(sheet: HTMLElement): HTMLElement {
    return within(sheet).getByRole("button", { name: "Previous player" });
  }

  function nextButton(sheet: HTMLElement): HTMLElement {
    return within(sheet).getByRole("button", { name: "Next player" });
  }

  it("recorren la lista y se deshabilitan en los extremos", async () => {
    clubApi();
    await renderScreen();
    const camila = await openCamila();
    expect(camila).toHaveTextContent("1 of 3 in this list");
    expect(previousButton(camila)).toBeDisabled();

    await userEvent.click(nextButton(camila));
    const jose = await sheetRegion(/evaluation of josé peña/i);
    expect(jose).toHaveTextContent("2 of 3 in this list");
    expect(memberButton(/josé peña/i)).toHaveAttribute("aria-current", "true");

    await userEvent.click(nextButton(jose));
    const mateo = await sheetRegion(/evaluation of mateo ruiz/i);
    expect(mateo).toHaveTextContent("3 of 3 in this list");
    expect(nextButton(mateo)).toBeDisabled();
    expect(previousButton(mateo)).toBeEnabled();
  });

  it("siguen la lista filtrada", async () => {
    clubApi();
    await renderScreen({ initialView: { positionId: FORWARD.id } });
    const camila = await openCamila();
    expect(camila).toHaveTextContent("1 of 2 in this list");

    await userEvent.click(nextButton(camila));

    const jose = await sheetRegion(/evaluation of josé peña/i);
    expect(jose).toHaveTextContent("2 of 2 in this list");
    expect(nextButton(jose)).toBeDisabled();
  });

  it("dice que el jugador abierto no está en el filtro y siguiente lleva al primero de la lista", async () => {
    clubApi();
    await renderScreen();
    const camila = await openCamila();

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search by name/i }),
      "mateo",
    );

    expect(camila).toHaveTextContent("Not in the current filter");
    await userEvent.click(nextButton(camila));
    expect(await sheetRegion(/evaluation of mateo ruiz/i)).toBeInTheDocument();
  });
});

describe("?miembro= en la dirección (#819, D8)", () => {
  it("abre el panel de ese jugador en vez del resumen", async () => {
    clubApi();

    await renderScreen({ initialMemberId: CAMILA.userId });

    expect(
      await sheetRegion(/evaluation of camila ortiz/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /squad overview/i }),
    ).toBeNull();
  });

  it("con un id que no está en la lista enseña el resumen", async () => {
    clubApi();

    await renderScreen({
      initialMemberId: "cccccccc-0000-4000-8000-00000000000c",
    });

    expect(overviewPanel()).toBeInTheDocument();
  });
});
