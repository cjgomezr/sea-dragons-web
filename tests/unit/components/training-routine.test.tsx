import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingScreen } from "@/components/training/TrainingScreen";
import type { MemberMark } from "@/lib/training/member-marks";
import type {
  RoutineLoad,
  TrainingMarkRef,
  WeekDose,
} from "@/lib/training/training-load";
import type {
  ActiveTrainingPlan,
  TrainingCycle,
  TrainingRoutine,
  TrainingRoutineItem,
} from "@/lib/training/training-plan";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * La rutina del día con sus kilos (#901, RF-4, D9 y D10 del PRD de E35). La
 * API sirve la carga tal como la planificó el entrenador y las marcas del
 * socio por separado (#898, #899): aquí se prueba que cada fila las junta en
 * la pantalla, que se abre con sus fotos, consejos y YouTube, y que la marca
 * escrita en la fila se guarda y cambia los kilos al momento.
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
const WEEK_6_DATES = [
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
  "2026-11-22",
];

type ExerciseOptions = {
  readonly name: string;
  readonly load?: RoutineLoad;
  readonly sets?: number | null;
  readonly reps?: string | null;
  readonly rest?: string | null;
  readonly note?: string | null;
  readonly tips?: readonly string[];
  readonly photoUrls?: readonly string[];
  readonly youtubeUrl?: string;
};

function exercise(options: ExerciseOptions): TrainingRoutineItem {
  return {
    kind: "exercise",
    id: `row-${options.name}`,
    exercise: {
      id: `exercise-${options.name}`,
      name: options.name,
      tips: options.tips ?? [],
      photoUrls: options.photoUrls ?? [],
      youtubeUrl:
        options.youtubeUrl ??
        `https://www.youtube.com/results?search_query=${encodeURIComponent(options.name)}`,
    },
    sets: options.sets === undefined ? 3 : options.sets,
    reps: options.reps === undefined ? "8" : options.reps,
    rest: options.rest ?? null,
    note: options.note ?? null,
    load: options.load ?? { kind: "none" },
  };
}

const SQUAT_PHOTOS = [
  "https://cdn.example/back-squat-start.jpg",
  "https://cdn.example/back-squat-end.jpg",
];

const GYM_A: TrainingRoutine = {
  id: "routine-gym-a",
  name: "Gym A · Strength",
  colorIndex: 1,
  items: [
    { kind: "section", id: "section-main", title: "Main 1" },
    exercise({
      name: "Back squat",
      load: { kind: "pct", mark: SQUAT, pct: 75 },
      sets: 4,
      reps: "6",
      rest: "2:00",
      tips: [
        "Bar on your upper back, feet shoulder-width.",
        "Drive up through the whole foot.",
      ],
      photoUrls: SQUAT_PHOTOS,
      youtubeUrl: "https://www.youtube.com/watch?v=back-squat",
    }),
    exercise({
      name: "Front squat",
      load: { kind: "pct", mark: SQUAT, pct: 70 },
    }),
    exercise({ name: "Bench press", load: { kind: "week", mark: BENCH } }),
    exercise({
      name: "Romanian deadlift",
      load: { kind: "pct", mark: DEADLIFT, pct: 60 },
      note: "Slow on the way down",
    }),
    exercise({
      name: "Deadlift",
      load: { kind: "pct", mark: DEADLIFT, pct: 80 },
    }),
    exercise({
      name: "Pull-up",
      load: { kind: "text", text: "Bodyweight" },
      reps: "max",
      rest: "1:30",
      photoUrls: ["https://cdn.example/pull-up-start.jpg"],
    }),
    exercise({ name: "Band pull-apart", sets: null, reps: "15" }),
  ],
};

const POOL: TrainingRoutine = {
  id: "routine-pool",
  name: "Pool · Endurance",
  colorIndex: 0,
  items: [exercise({ name: "Front crawl", sets: null, reps: "400 m" })],
};

const EMPTY_ROUTINE: TrainingRoutine = {
  id: "routine-empty",
  name: "Mobility",
  colorIndex: 4,
  items: [],
};

const PCT_DOSE: WeekDose = {
  sets: 4,
  reps: "5",
  intensity: { kind: "pct", pct: 80 },
};
const TEXT_DOSE: WeekDose = {
  sets: 3,
  reps: "6",
  intensity: { kind: "text", text: "RPE 7" },
};

/** Semana 3: el martes (hoy) Gym A y Pool, el miércoles una rutina vacía, el
 * jueves descanso. */
function week3Plan(dose: WeekDose | null = PCT_DOSE): ActiveTrainingPlan {
  const routinesByDay: Readonly<Record<number, TrainingRoutine[]>> = {
    1: [GYM_A, POOL],
    2: [EMPTY_ROUTINE],
  };
  return {
    cycle: CYCLE,
    current: { week: 3, phase: "running", today: "2026-10-27" },
    week: {
      number: 3,
      note: null,
      dose,
      days: WEEK_3_DATES.map((date, weekday) => ({
        weekday,
        date,
        routines: routinesByDay[weekday] ?? [],
      })),
    },
  };
}

/** Semana 6, la del evento: el lunes Pool y desde el jueves el evento. */
function week6Plan(): ActiveTrainingPlan {
  return {
    cycle: CYCLE,
    current: { week: 6, phase: "running", today: "2026-11-16" },
    week: {
      number: 6,
      note: null,
      dose: null,
      days: WEEK_6_DATES.map((date, weekday) => ({
        weekday,
        date,
        routines: weekday === 0 ? [POOL] : [],
      })),
    },
  };
}

function mark(ref: TrainingMarkRef, value: number | null): MemberMark {
  return { ...ref, unit: "kg", value };
}

const DEFAULT_MARKS: readonly MemberMark[] = [
  mark(SQUAT, 80),
  mark(BENCH, 55),
  mark(DEADLIFT, null),
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
 * responde la lista con el valor nuevo (#899). `failWrites` lo hace fallar. */
function stubApi(
  plan: ActiveTrainingPlan,
  options: {
    readonly marks?: readonly MemberMark[];
    readonly failWrites?: boolean;
  } = {},
): void {
  let marks = options.marks ?? DEFAULT_MARKS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === PLAN_PATH) {
        return jsonResponse(200, { data: plan });
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

beforeEach(() => {
  markWrites.length = 0;
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<TrainingScreen locale={locale} canPlan={false} />);
  await screen.findByRole("heading", { level: 1 });
}

function routinePanel(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function row(name: string): HTMLElement {
  return within(routinePanel("Gym A · Strength")).getByRole("button", {
    name: new RegExp(`^${name}`),
  });
}

async function openRow(name: string): Promise<HTMLElement> {
  const button = row(name);
  await userEvent.click(button);
  const panelId = button.getAttribute("aria-controls");
  const panel = panelId === null ? null : document.getElementById(panelId);
  if (panel === null) {
    throw new Error(`La fila ${name} no controla ningún panel`);
  }
  return panel;
}

function dayButton(index: number): HTMLElement {
  const days = within(
    screen.getByRole("list", { name: /^Days of week/ }),
  ).getAllByRole("button");
  const day = days[index];
  if (day === undefined) {
    throw new Error(`No hay día ${index}`);
  }
  return day;
}

describe("una fila de ejercicio", () => {
  it("tiene la miniatura, el nombre y la dosis con el descanso", async () => {
    stubApi(week3Plan());

    await renderScreen();

    const squat = row("Back squat");
    expect(squat).toHaveTextContent("Back squat");
    expect(squat).toHaveTextContent("4 × 6 · rest 2:00");
    expect(squat.querySelector("img")).toHaveAttribute("src", SQUAT_PHOTOS[0]);
  });

  it("dice sólo las repeticiones cuando no hay series, sin descanso", async () => {
    stubApi(week3Plan());

    await renderScreen();

    const band = row("Band pull-apart");
    expect(band).toHaveTextContent(/15$/);
    expect(band).not.toHaveTextContent("×");
    expect(band).not.toHaveTextContent("rest");
  });

  it("enseña la nota debajo cuando la hay", async () => {
    stubApi(week3Plan());

    await renderScreen();

    expect(row("Romanian deadlift")).toHaveTextContent("Slow on the way down");
  });

  it("enseña el icono genérico sin foto y cuando la foto no carga", async () => {
    stubApi(week3Plan());
    await renderScreen();

    expect(row("Band pull-apart").querySelector("img")).toBeNull();
    const thumbnail = row("Back squat").querySelector("img");
    if (thumbnail === null) {
      throw new Error("Back squat no tiene miniatura");
    }
    fireEvent.error(thumbnail);

    expect(row("Back squat").querySelector("img")).toBeNull();
    expect(row("Back squat").querySelector("svg")).not.toBeNull();
  });
});

describe("la carga de una fila", () => {
  it("con % de una marca que el socio tiene, dice los kilos y de dónde salen", async () => {
    stubApi(week3Plan());

    await renderScreen();

    expect(row("Back squat")).toHaveTextContent("60 kg");
    expect(row("Back squat")).toHaveTextContent("75% of back squat 80");
    expect(row("Front squat")).toHaveTextContent("55 kg");
  });

  it("con la dosis de la semana al 80%, toma las series y los kilos de la semana", async () => {
    stubApi(week3Plan(PCT_DOSE));

    await renderScreen();

    const bench = row("Bench press");
    expect(bench).toHaveTextContent("4 × 5");
    expect(bench).toHaveTextContent("45 kg");
    expect(bench).toHaveTextContent("80% of bench press 55");
  });

  it("con la dosis de la semana en RPE, dice el RPE", async () => {
    stubApi(week3Plan(TEXT_DOSE));

    await renderScreen();

    const bench = row("Bench press");
    expect(bench).toHaveTextContent("3 × 6");
    expect(bench).toHaveTextContent("RPE 7");
    expect(bench).not.toHaveTextContent("kg");
  });

  it("con la dosis de la semana en una semana sin dosis, dice la dosis de la fila sin kilos", async () => {
    stubApi(week3Plan(null));

    await renderScreen();

    const bench = row("Bench press");
    expect(bench).toHaveTextContent("3 × 8");
    expect(bench).not.toHaveTextContent("kg");
    expect(bench).not.toHaveTextContent("%");
  });

  it("con % y sin la marca, pide la marca en aviso y lo repite bajo la lista", async () => {
    stubApi(week3Plan());

    await renderScreen();

    const deadlift = row("Romanian deadlift");
    expect(within(deadlift).getByText("60%")).toHaveClass(
      "training-load-warning",
    );
    expect(deadlift).toHaveTextContent("of deadlift · add your mark");
    expect(
      within(routinePanel("Gym A · Strength")).getAllByText(
        "Open the row to add your deadlift, or use My marks.",
      ),
    ).toHaveLength(1);
  });

  it("con texto, dice el texto tal cual", async () => {
    stubApi(week3Plan());

    await renderScreen();

    expect(row("Pull-up")).toHaveTextContent("Bodyweight");
  });

  it("sin carga, no dice nada a la derecha", async () => {
    stubApi(week3Plan());

    await renderScreen();

    expect(row("Band pull-apart")).not.toHaveTextContent("kg");
  });
});

describe("abrir una fila", () => {
  it("se abre y se cierra con aria-expanded", async () => {
    stubApi(week3Plan());
    await renderScreen();

    expect(row("Back squat")).toHaveAttribute("aria-expanded", "false");
    await openRow("Back squat");
    expect(row("Back squat")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(row("Back squat"));

    expect(row("Back squat")).toHaveAttribute("aria-expanded", "false");
  });

  it("enseña las dos fotos con START y END, los consejos y YouTube con su enlace", async () => {
    stubApi(week3Plan());
    await renderScreen();

    const panel = await openRow("Back squat");

    const photos = within(panel).getAllByRole("img");
    expect(photos.map((photo) => photo.getAttribute("src"))).toEqual(
      SQUAT_PHOTOS,
    );
    expect(within(panel).getByText("Start")).toBeInTheDocument();
    expect(within(panel).getByText("End")).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((tip) => tip.textContent),
    ).toEqual([
      "Bar on your upper back, feet shoulder-width.",
      "Drive up through the whole foot.",
    ]);
    const youtube = within(panel).getByRole("link", {
      name: /Watch on YouTube/,
    });
    expect(youtube).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=back-squat",
    );
    expect(youtube).toHaveAttribute("target", "_blank");
    expect(youtube.getAttribute("rel")).toContain("noopener");
  });

  it("con una foto, la enseña sola", async () => {
    stubApi(week3Plan());
    await renderScreen();

    const panel = await openRow("Pull-up");

    expect(within(panel).getAllByRole("img")).toHaveLength(1);
  });

  it("sin fotos ni consejos, sólo YouTube con la búsqueda", async () => {
    stubApi(week3Plan());
    await renderScreen();

    const panel = await openRow("Band pull-apart");

    expect(within(panel).queryByRole("img")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("list")).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: /Watch on YouTube/ }),
    ).toHaveAttribute(
      "href",
      "https://www.youtube.com/results?search_query=Band%20pull-apart",
    );
  });

  it("con % de una marca que tiene, el campo de la fila lleva su valor", async () => {
    stubApi(week3Plan());
    await renderScreen();

    const panel = await openRow("Back squat");

    expect(
      within(panel).getByRole("textbox", { name: "Your back squat best lift" }),
    ).toHaveValue("80");
  });

  it("sin marca de la que salgan kilos, no tiene campo", async () => {
    stubApi(week3Plan());
    await renderScreen();

    const panel = await openRow("Pull-up");

    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("escribir la marca en la fila", () => {
  it("la guarda y cambia los kilos de todas las filas que la usan", async () => {
    stubApi(week3Plan());
    await renderScreen();
    const panel = await openRow("Romanian deadlift");

    await userEvent.type(
      within(panel).getByRole("textbox", { name: "Your deadlift best lift" }),
      "100{Enter}",
    );

    await waitFor(() => {
      expect(row("Romanian deadlift")).toHaveTextContent("60 kg");
    });
    expect(row("Romanian deadlift")).toHaveTextContent("60% of deadlift 100");
    expect(row("Deadlift")).toHaveTextContent("80 kg");
    expect(
      within(panel).getByRole("textbox", { name: "Your deadlift best lift" }),
    ).toHaveFocus();
    expect(
      screen.queryByText("Open the row to add your deadlift, or use My marks."),
    ).not.toBeInTheDocument();
    expect(markWrites).toEqual([
      {
        method: "PUT",
        path: "/api/v1/training/marks/mark-deadlift/me",
        body: { value: 100 },
      },
    ]);
  });

  it("entiende la coma decimal y guarda al salir del campo", async () => {
    stubApi(week3Plan());
    await renderScreen();
    const panel = await openRow("Romanian deadlift");

    await userEvent.type(
      within(panel).getByRole("textbox", { name: "Your deadlift best lift" }),
      "102,5",
    );
    await userEvent.tab();

    await waitFor(() => {
      expect(markWrites).toEqual([
        {
          method: "PUT",
          path: "/api/v1/training/marks/mark-deadlift/me",
          body: { value: 102.5 },
        },
      ]);
    });
  });

  it("no guarda un valor que no vale, lo dice y vuelve al anterior", async () => {
    stubApi(week3Plan());
    await renderScreen();
    const panel = await openRow("Back squat");
    const field = within(panel).getByRole("textbox", {
      name: "Your back squat best lift",
    });

    await userEvent.clear(field);
    await userEvent.type(field, "600{Enter}");

    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Write a number above 0 and up to 500, with one decimal at most.",
    );
    expect(field).toHaveValue("80");
    expect(markWrites).toEqual([]);
    expect(row("Back squat")).toHaveTextContent("60 kg");
  });

  it("vaciado, deja la marca sin valor", async () => {
    stubApi(week3Plan());
    await renderScreen();
    const panel = await openRow("Back squat");

    await userEvent.clear(
      within(panel).getByRole("textbox", { name: "Your back squat best lift" }),
    );
    await userEvent.tab();

    await waitFor(() => {
      expect(row("Back squat")).toHaveTextContent(
        "of back squat · add your mark",
      );
    });
    expect(markWrites).toEqual([
      {
        method: "DELETE",
        path: "/api/v1/training/marks/mark-squat/me",
        body: null,
      },
    ]);
  });

  it("si no se guarda, lo dice y deja los kilos como estaban", async () => {
    stubApi(week3Plan(), { failWrites: true });
    await renderScreen();
    const panel = await openRow("Back squat");
    const field = within(panel).getByRole("textbox", {
      name: "Your back squat best lift",
    });

    await userEvent.clear(field);
    await userEvent.type(field, "100{Enter}");

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "We couldn't save your mark. Try again.",
    );
    expect(row("Back squat")).toHaveTextContent("60 kg");
    expect(field).toHaveValue("80");
  });
});

describe("una fila sin series ni repeticiones", () => {
  it("dice sólo el descanso, sin separador delante", async () => {
    const plan = week3Plan();
    const restOnly: TrainingRoutine = {
      ...POOL,
      items: [
        exercise({
          name: "Recovery swim",
          sets: null,
          reps: null,
          rest: "1:00",
        }),
      ],
    };
    stubApi({
      ...plan,
      week: {
        ...plan.week,
        days: plan.week.days.map((day) =>
          day.weekday === 1 ? { ...day, routines: [restOnly] } : day,
        ),
      },
    });

    await renderScreen();

    expect(
      within(routinePanel("Pool · Endurance")).getByRole("button", {
        name: /^Recovery swim/,
      }),
    ).toHaveTextContent(/^Recovery swimrest 1:00$/);
  });
});

describe("las filas de la rutina", () => {
  it("una sección es un título que separa y no se abre", async () => {
    stubApi(week3Plan());

    await renderScreen();

    const panel = routinePanel("Gym A · Strength");
    expect(
      within(panel).getByRole("heading", { level: 4, name: "Main 1" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /Main 1/ }),
    ).not.toBeInTheDocument();
  });

  it("un día con dos rutinas las enseña una debajo de la otra, cada una con su cabecera y sus filas", async () => {
    stubApi(week3Plan());

    await renderScreen();

    const regions = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"))
      .map((id) =>
        id === null ? "" : document.getElementById(id)?.textContent,
      )
      // Mis marcas (#902) también es una región, en la otra columna.
      .filter((name) => name !== "My marks");
    expect(regions).toEqual(["Gym A · Strength", "Pool · Endurance"]);
    expect(
      within(routinePanel("Pool · Endurance")).getByRole("button", {
        name: /^Front crawl/,
      }),
    ).toHaveTextContent("400 m");
  });

  it("una rutina sin filas dice que todavía no hay nada", async () => {
    stubApi(week3Plan());
    await renderScreen();

    await userEvent.click(dayButton(2));

    expect(routinePanel("Mobility")).toHaveTextContent("Nothing here yet");
  });

  it("un día de descanso lo dice", async () => {
    stubApi(week3Plan());
    await renderScreen();

    await userEvent.click(dayButton(3));

    expect(screen.getByRole("region", { name: "Rest day" })).toHaveTextContent(
      "Nothing planned. Recover well.",
    );
  });

  it("un día del evento le desea suerte", async () => {
    stubApi(week6Plan());
    await renderScreen();

    await userEvent.click(dayButton(3));

    expect(
      screen.getByRole("region", { name: "UWR Nationals" }),
    ).toHaveTextContent("Good luck out there.");
  });
});

describe("en español", () => {
  it("traduce la dosis, la carga y el aviso de la marca", async () => {
    stubApi(week3Plan());

    await renderScreen("es");

    const squat = within(routinePanel("Gym A · Strength")).getByRole("button", {
      name: /^Back squat/,
    });
    expect(squat).toHaveTextContent("4 × 6 · descanso 2:00");
    expect(squat).toHaveTextContent("75 % de back squat 80");
    expect(
      screen.getByText(
        "Abre la fila para añadir tu deadlift, o usa Mis marcas.",
      ),
    ).toBeInTheDocument();
  });
});

describe("cuando las marcas no cargan", () => {
  it("avisa del fallo en vez de pedir marcas que a lo mejor ya tiene", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        new URL(input, "http://localhost").pathname === MARKS_PATH
          ? jsonResponse(500, { error: { code: "internal_error" } })
          : jsonResponse(200, { data: week3Plan() }),
      ),
    );

    render(<TrainingScreen locale="en" canPlan={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the training plan.",
    );
    expect(screen.queryByText(/add your mark/)).not.toBeInTheDocument();
  });
});
