import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingScreen } from "@/components/training/TrainingScreen";
import type { MemberMark } from "@/lib/training/member-marks";
import type { TrainingMarkRef } from "@/lib/training/training-load";
import type {
  ActiveTrainingPlan,
  TrainingCycle,
  TrainingRoutine,
} from "@/lib/training/training-plan";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La tarjeta Mis marcas (#902, RF-5 y D11 del PRD de E35, §4.1 y §4.2 del
 * handoff). Las marcas las sirve y las guarda la API (#899): aquí se prueba
 * qué marcas enseña la tarjeta, que guarda al salir del campo o con Enter, que
 * lo que no vale no se guarda, y que los kilos de las filas cambian al
 * momento.
 */

const PLAN_PATH = "/api/v1/training/plan";
const MARKS_PATH = "/api/v1/training/marks/me";

const SQUAT: TrainingMarkRef = { id: "mark-squat", name: "Back squat" };
const BENCH: TrainingMarkRef = { id: "mark-bench", name: "Bench press" };
const DEADLIFT: TrainingMarkRef = { id: "mark-deadlift", name: "Deadlift" };

const CYCLE: TrainingCycle = {
  id: "cccccccc-0000-4000-8000-00000000000c",
  name: "Road to Nationals 2027",
  event: { name: "UWR Nationals", date: "2026-11-19" },
  startDate: "2026-10-12",
  endDate: "2026-11-22",
  weeks: 6,
};

const WEEK_3_DATES = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

/** El martes, hoy: sentadilla al 75 % y press de banca al 75 %. */
const GYM_A: TrainingRoutine = {
  id: "routine-gym-a",
  name: "Gym A · Strength",
  colorIndex: 1,
  items: [SQUAT, BENCH].map((ref) => ({
    kind: "exercise",
    id: `row-${ref.id}`,
    exercise: {
      id: `exercise-${ref.id}`,
      name: ref.name,
      tips: [],
      photoUrls: [],
      youtubeUrl: "https://www.youtube.com/results?search_query=x",
    },
    sets: 4,
    reps: "6",
    rest: null,
    note: null,
    load: { kind: "pct", mark: ref, pct: 75 },
  })),
};

const PLAN: ActiveTrainingPlan = {
  cycle: CYCLE,
  current: { week: 3, phase: "running", today: "2026-10-27" },
  week: {
    number: 3,
    note: null,
    dose: null,
    days: WEEK_3_DATES.map((date, weekday) => ({
      weekday,
      date,
      routines: weekday === 1 ? [GYM_A] : [],
    })),
  },
};

function mark(ref: TrainingMarkRef, value: number | null): MemberMark {
  return { ...ref, unit: "kg", value };
}

const THREE_MARKS: readonly MemberMark[] = [
  mark(SQUAT, 80),
  mark(BENCH, 55),
  mark(DEADLIFT, null),
];

/** Diez marcas: la semana solo usa la sentadilla y el press de banca. */
const TEN_MARKS: readonly MemberMark[] = [
  mark(DEADLIFT, null),
  mark(SQUAT, 80),
  ...[
    "Power clean",
    "Overhead press",
    "Bent-over row",
    "Front squat",
    "Hip thrust",
    "Push press",
  ].map((name, index) => mark({ id: `mark-extra-${index}`, name }, null)),
  mark(BENCH, 55),
  mark({ id: "mark-extra-last", name: "Snatch" }, 30),
];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type MarkWrite = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

const markWrites: MarkWrite[] = [];

/** El plan, las marcas del socio, y el guardado o borrado de una marca, que
 * responde la lista con el valor nuevo (#899). */
function stubApi(
  options: {
    readonly marks?: readonly MemberMark[];
    readonly failWrites?: boolean;
  } = {},
): void {
  let marks = options.marks ?? THREE_MARKS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === PLAN_PATH) {
        return jsonResponse(200, { data: PLAN });
      }
      if (url.pathname === MARKS_PATH) {
        return jsonResponse(200, { data: { marks } });
      }
      const written = /^\/api\/v1\/training\/marks\/([^/]+)\/me$/.exec(
        url.pathname,
      );
      if (written === null) {
        return jsonResponse(404, { error: { code: "not_found" } });
      }
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      markWrites.push({ method, path: url.pathname, body });
      if (options.failWrites === true) {
        return jsonResponse(500, { error: { code: "internal_error" } });
      }
      const value =
        method === "PUT" ? (body as { readonly value: number }).value : null;
      marks = marks.map((entry) =>
        entry.id === written[1] ? { ...entry, value } : entry,
      );
      return jsonResponse(200, { data: { marks } });
    }),
  );
}

/** La API cierra el plan con el motivo y la cabecera del ciclo (#898). */
function stubBlocked(block: string, cycle: TrainingCycle | null = CYCLE): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(403, {
        error: {
          block,
          cycle,
          code: "forbidden",
          message: "Tu membresía no está al día.",
          reason: "membership_not_current",
        },
      }),
    ),
  );
}

beforeEach(() => {
  markWrites.length = 0;
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderScreen(
  options: { readonly locale?: "en" | "es"; readonly canPlan?: boolean } = {},
): Promise<void> {
  render(
    <TrainingScreen
      locale={options.locale ?? "en"}
      canPlan={options.canPlan ?? false}
    />,
  );
  await screen.findByRole("heading", { level: 1 });
}

function marksCard(): HTMLElement {
  return screen.getByRole("region", { name: "My marks" });
}

function markInput(name: string): HTMLInputElement {
  const input = within(marksCard()).getByRole("textbox", { name });
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`${name} no es un campo`);
  }
  return input;
}

function fieldNames(): readonly string[] {
  return within(marksCard())
    .getAllByRole("textbox")
    .map((input) => input.getAttribute("id") ?? "")
    .map((id) => document.querySelector(`label[for="${id}"]`))
    .map((label) => label?.textContent ?? "");
}

async function typeAndLeave(name: string, text: string): Promise<void> {
  const input = markInput(name);
  await userEvent.clear(input);
  if (text !== "") {
    await userEvent.type(input, text);
  }
  await userEvent.tab();
}

describe("la tarjeta Mis marcas", () => {
  it("tiene el título, cuántas tienen valor, que solo las ve el socio y la ayuda", async () => {
    stubApi();

    await renderScreen();

    const card = marksCard();
    expect(
      within(card).getByRole("heading", { name: "My marks" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("2 of 3 set")).toBeInTheDocument();
    expect(within(card).getByText("Only you see these")).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Your best single lift (1RM). Routines with "% of" use it to show your kilos.',
      ),
    ).toBeInTheDocument();
  });

  it("tiene un campo por marca, con su valor y kg", async () => {
    stubApi();

    await renderScreen();

    expect(fieldNames()).toEqual(["Back squat", "Bench press", "Deadlift"]);
    expect(markInput("Back squat")).toHaveValue("80");
    expect(markInput("Deadlift")).toHaveValue("");
    expect(within(marksCard()).getAllByText("kg")).toHaveLength(3);
  });

  it("no aparece si el club no tiene marcas", async () => {
    stubApi({ marks: [] });

    await renderScreen();

    expect(
      screen.queryByRole("region", { name: "My marks" }),
    ).not.toBeInTheDocument();
  });
});

describe("con más de cuatro marcas", () => {
  it("enseña solo las de la semana, con 'this week', y el conmutador", async () => {
    stubApi({ marks: TEN_MARKS });

    await renderScreen();

    expect(fieldNames()).toEqual(["Back squat", "Bench press"]);
    expect(within(marksCard()).getAllByText("this week")).toHaveLength(2);
    expect(within(marksCard()).getByText("3 of 10 set")).toBeInTheDocument();
    expect(
      within(marksCard()).getByRole("button", { name: "Show all 10 marks" }),
    ).toBeInTheDocument();
  });

  it("enseña todas con 'Show all' y vuelve con 'Show only this week's marks'", async () => {
    stubApi({ marks: TEN_MARKS });
    await renderScreen();

    await userEvent.click(
      within(marksCard()).getByRole("button", { name: "Show all 10 marks" }),
    );

    expect(fieldNames()).toHaveLength(10);
    expect(within(marksCard()).getAllByText("this week")).toHaveLength(2);

    await userEvent.click(
      within(marksCard()).getByRole("button", {
        name: "Show only this week's marks",
      }),
    );

    expect(fieldNames()).toEqual(["Back squat", "Bench press"]);
  });
});

describe("guardar una marca", () => {
  it("guarda un valor con coma como decimal al salir del campo", async () => {
    stubApi();
    await renderScreen();

    await typeAndLeave("Deadlift", "82,5");

    await waitFor(() => {
      expect(markWrites).toEqual([
        {
          method: "PUT",
          path: "/api/v1/training/marks/mark-deadlift/me",
          body: { value: 82.5 },
        },
      ]);
    });
    expect(within(marksCard()).getByText("3 of 3 set")).toBeInTheDocument();
  });

  it("guarda con Enter, una sola vez aunque luego salga del campo", async () => {
    stubApi();
    await renderScreen();

    const input = markInput("Deadlift");
    await userEvent.type(input, "100{Enter}");
    await userEvent.tab();

    await waitFor(() => {
      expect(markWrites).toHaveLength(1);
    });
    expect(markWrites[0]?.body).toEqual({ value: 100 });
  });

  it("no guarda a cada tecla", async () => {
    stubApi();
    await renderScreen();

    await userEvent.type(markInput("Deadlift"), "120");

    expect(markWrites).toEqual([]);
  });

  it.each(["0", "-5", "500.5", "82.25"])(
    "no guarda %j: vuelve al último valor y dice por qué",
    async (text) => {
      stubApi();
      await renderScreen();

      await typeAndLeave("Back squat", text);

      expect(markWrites).toEqual([]);
      expect(markInput("Back squat")).toHaveValue("80");
      expect(markInput("Back squat")).toHaveAttribute("aria-invalid", "true");
      expect(within(marksCard()).getByRole("alert")).toHaveTextContent(
        "Write a number above 0 and up to 500, with one decimal at most.",
      );
    },
  );

  it("deja la marca sin valor cuando se vacía el campo", async () => {
    stubApi();
    await renderScreen();

    await typeAndLeave("Back squat", "");

    await waitFor(() => {
      expect(markWrites).toEqual([
        {
          method: "DELETE",
          path: "/api/v1/training/marks/mark-squat/me",
          body: null,
        },
      ]);
    });
    expect(within(marksCard()).getByText("1 of 3 set")).toBeInTheDocument();
  });

  it("cambia al momento los kilos de las filas que usan la marca", async () => {
    stubApi();
    await renderScreen();
    const routine = screen.getByRole("region", { name: "Gym A · Strength" });
    expect(within(routine).getByText("60 kg")).toBeInTheDocument();

    await typeAndLeave("Back squat", "100");

    expect(await within(routine).findByText("75 kg")).toBeInTheDocument();
    expect(within(routine).queryByText("60 kg")).not.toBeInTheDocument();
  });

  it("avisa si no se pudo guardar y vuelve al último valor", async () => {
    stubApi({ failWrites: true });
    await renderScreen();

    await typeAndLeave("Back squat", "90");

    expect(await within(marksCard()).findByRole("alert")).toHaveTextContent(
      "We couldn't save your mark. Try again.",
    );
    expect(markInput("Back squat")).toHaveValue("80");
  });
});

describe("Mis marcas en el móvil", () => {
  it("va al final, después de la rutina del día", async () => {
    stubScreenWidth(true);
    stubApi();

    await renderScreen();

    const routine = screen.getByRole("region", { name: "Gym A · Strength" });
    expect(
      routine.compareDocumentPosition(marksCard()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("la pantalla bloqueada", () => {
  it.each([
    ["pending", "Activate your membership to see your plan"],
    ["past_due", "Your last payment failed. Update your card to see your plan"],
    ["cancelled", "Your membership is cancelled. Renew to see your plan"],
  ])(
    "enseña la cabecera del ciclo y la tarjeta con el motivo %s",
    async (block, title) => {
      stubBlocked(block);

      await renderScreen();

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Road to Nationals 2027",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("UWR Nationals · Thu 19 Nov 2026"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: title }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Renew membership" }),
      ).toHaveAttribute("href", "/pagos");
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "My marks" }),
      ).not.toBeInTheDocument();
    },
  );

  it("sin ciclo activo, enseña el título de la sección y la tarjeta", async () => {
    stubBlocked("pending", null);

    await renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Training" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Renew membership" }),
    ).toBeInTheDocument();
  });

  it("trata como un fallo un 403 que no es el de la membresía", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, {
          error: { code: "forbidden", message: "No.", reason: "other" },
        }),
      ),
    );

    render(<TrainingScreen locale="en" canPlan={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the training plan.",
    );
    expect(
      screen.queryByRole("link", { name: "Renew membership" }),
    ).not.toBeInTheDocument();
  });

  it("trata como un fallo las marcas cerradas con el plan abierto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        new URL(input, "http://localhost").pathname === PLAN_PATH
          ? jsonResponse(200, { data: PLAN })
          : jsonResponse(403, {
              error: {
                block: "pending",
                code: "forbidden",
                message: "Tu membresía no está al día.",
                reason: "membership_not_current",
              },
            }),
      ),
    );

    render(<TrainingScreen locale="en" canPlan={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the training plan.",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Renew membership" }),
    ).not.toBeInTheDocument();
  });

  it("habla de tú en español", async () => {
    stubBlocked("past_due");

    await renderScreen({ locale: "es" });

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Tu último pago falló. Actualiza tu tarjeta para ver tu plan",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Renovar membresía" }),
    ).toHaveAttribute("href", "/pagos");
  });

  it("no la ve un Admin o un Coach sin la membresía al día: ve el plan", async () => {
    // La API sirve el plan a quien planifica aunque no esté al día (D3).
    stubApi();

    await renderScreen({ canPlan: true });

    expect(
      screen.queryByRole("link", { name: "Renew membership" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Gym A · Strength" }),
    ).toBeInTheDocument();
  });
});

describe("Mis marcas en español", () => {
  it("habla de tú", async () => {
    stubApi();

    await renderScreen({ locale: "es" });

    const card = screen.getByRole("region", { name: "Mis marcas" });
    expect(within(card).getByText("2 de 3 anotadas")).toBeInTheDocument();
    expect(within(card).getByText("Solo tú las ves")).toBeInTheDocument();
  });
});
