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
import type { EvaluationRosterEntry } from "@/lib/evaluations/evaluation-roster";
import type {
  EvaluationRating,
  MemberEvaluation,
} from "@/lib/evaluations/member-evaluation";

/**
 * La pantalla de Evaluaciones (#322, RF-6 del PRD de E9): la lista de
 * miembros con su OVR, la ficha de quien se elija y la edición de sus
 * valoraciones. La API es un doble: lo que se prueba es qué pide la pantalla
 * y qué enseña con lo que le responden.
 */

const ROSTER_PATH = "/api/v1/evaluations";
const READ_AT = "2026-09-27T01:02:03.123456+00:00";
const SAVED_AT = "2026-09-27T01:05:00.654321+00:00";

const CAMILA: EvaluationRosterEntry = {
  status: "evaluated",
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Camila Ortiz",
  overallRating: 7.5,
};

const MATEO: EvaluationRosterEntry = {
  status: "not_evaluated",
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Mateo Ruiz",
};

const FITNESS_ID = "ca7e0000-0000-4000-8000-000000000001";
const SPEED_ID = "ca7e0000-0000-4000-8000-000000000002";

const CAMILA_RATINGS: readonly EvaluationRating[] = [
  { categoryId: FITNESS_ID, name: "Fitness", rating: 8, isRetired: false },
  { categoryId: SPEED_ID, name: "Speed", rating: 7, isRetired: false },
];

function evaluated(
  memberId: string,
  ratings: readonly EvaluationRating[],
  updatedAt = READ_AT,
): MemberEvaluation {
  const sum = ratings.reduce((total, entry) => total + entry.rating, 0);
  return {
    status: "evaluated",
    memberId,
    updatedAt,
    overallRating: Math.round((sum * 10) / ratings.length) / 10,
    ratings,
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

/** Lo que responde un club con Camila evaluada y Mateo sin evaluar. */
function clubApi(overrides: Partial<Record<string, Responder>> = {}): void {
  stubApi((call) => {
    const override = overrides[`${call.method} ${call.url}`];
    if (override !== undefined) {
      return override(call);
    }
    if (call.url === ROSTER_PATH) {
      return jsonResponse(200, { data: { members: [CAMILA, MATEO] } });
    }
    if (call.url === `${ROSTER_PATH}/${CAMILA.userId}`) {
      return jsonResponse(200, {
        data: evaluated(CAMILA.userId, CAMILA_RATINGS),
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

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<EvaluationsScreen locale={locale} />);
  await screen.findByRole("list", { name: /members|miembros/i });
}

function memberButton(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

async function openMember(name: RegExp): Promise<HTMLElement> {
  await userEvent.click(memberButton(name));
  return screen.findByRole("region", { name: /evaluation of|evaluación de/i });
}

async function openCamila(): Promise<HTMLElement> {
  const sheet = await openMember(/camila ortiz/i);
  await within(sheet).findByRole("list", { name: /skill ratings/i });
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lista de evaluaciones", () => {
  it("enseña a cada miembro con su OVR y marca a quien está sin evaluar", async () => {
    clubApi();

    await renderScreen();

    const camila = memberButton(/camila ortiz/i);
    expect(camila).toHaveTextContent("7.5");
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent(/not evaluated/i);
  });

  it("marca con su propio texto una evaluación sin categorías, sin inventar un OVR", async () => {
    const ruby: EvaluationRosterEntry = {
      status: "evaluated",
      userId: "cccccccc-0000-4000-8000-00000000000c",
      fullName: "Ruby Walsh",
      overallRating: null,
    };
    stubApi(() => jsonResponse(200, { data: { members: [ruby] } }));

    render(<EvaluationsScreen locale="en" />);

    const button = await screen.findByRole("button", { name: /ruby walsh/i });
    expect(button).toHaveTextContent(/no ratings yet/i);
    expect(button).not.toHaveTextContent(/ovr/i);
  });

  it("filtra por nombre, sin distinguir acentos", async () => {
    clubApi();
    await renderScreen();

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search/i }),
      "mateo",
    );

    expect(screen.queryByRole("button", { name: /camila/i })).toBeNull();
    expect(memberButton(/mateo ruiz/i)).toBeInTheDocument();
  });

  it("dice que nadie coincide cuando la búsqueda no encuentra a nadie", async () => {
    clubApi();
    await renderScreen();

    await userEvent.type(
      screen.getByRole("searchbox", { name: /search/i }),
      "zzz",
    );

    expect(screen.getByText(/no member matches/i)).toBeInTheDocument();
  });

  it("explica que no hay nadie que evaluar con la lista vacía", async () => {
    stubApi(() => jsonResponse(200, { data: { members: [] } }));

    render(<EvaluationsScreen locale="en" />);

    expect(
      await screen.findByText(/nobody in the club to evaluate/i),
    ).toBeInTheDocument();
  });

  it("deja reintentar cuando la lista no se puede leer", async () => {
    let attempts = 0;
    stubApi(() => {
      attempts += 1;
      return attempts === 1
        ? errorResponse(500, "internal_error")
        : jsonResponse(200, { data: { members: [CAMILA] } });
    });
    render(<EvaluationsScreen locale="en" />);

    await userEvent.click(
      await screen.findByRole("button", { name: /try again/i }),
    );

    expect(
      await screen.findByRole("button", { name: /camila ortiz/i }),
    ).toBeInTheDocument();
  });
});

describe("ficha de evaluación", () => {
  it("enseña cada categoría con su valoración y el OVR destacado", async () => {
    clubApi();
    await renderScreen();

    const sheet = await openCamila();

    const ratings = within(sheet).getByRole("list", { name: /skill ratings/i });
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
      await within(sheet).findByRole("button", { name: /create evaluation/i }),
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
    expect(callsTo("GET")).toHaveLength(2);
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
      await within(sheet).findByRole("button", { name: /create evaluation/i }),
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
    await renderScreen("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "Evaluaciones" }),
    ).toBeInTheDocument();
    expect(memberButton(/mateo ruiz/i)).toHaveTextContent(/sin evaluar/i);
    const sheet = await openMember(/camila ortiz/i);
    const ratings = await within(sheet).findByRole("list", {
      name: /valoraciones/i,
    });
    expect(within(ratings).getAllByRole("listitem")[0]).toHaveTextContent(
      "Fitness8 de 10",
    );
    expect(
      within(sheet).getByRole("button", { name: /editar valoraciones/i }),
    ).toBeInTheDocument();
  });
});

describe("permisos", () => {
  it("dice que no tiene acceso si la API responde 403", async () => {
    stubApi(() => errorResponse(403, "forbidden"));

    render(<EvaluationsScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only coaches and admins/i,
    );
  });
});
