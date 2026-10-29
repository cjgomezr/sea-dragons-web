import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPlannerScreen } from "@/components/training/TrainingPlannerScreen";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type {
  ExerciseCounts,
  ManagedExercise,
} from "@/lib/training/club-exercises";
import { stubScreenWidth } from "../../support/screen-width";

/**
 * Planificar → Ejercicios (#910, RF-10 y D13 del PRD de E35; §5.1 "Tab
 * Exercises" y §5.2 del handoff): la lista con su búsqueda y sus fichas, el
 * formulario del ejercicio del club con dos fotos, abrir uno del club para
 * cambiarlo o borrarlo y uno de la biblioteca para leerlo. Qué vale y qué se
 * guarda lo decide la API (#903, #910); aquí se prueba que la pantalla pinta
 * lo que responde y le pide lo que toca.
 */

const CYCLES_PATH = "/api/v1/training/manage/cycles";
const EXERCISES_PATH = "/api/v1/training/manage/exercises";
const CDN = "https://cdn.example.test/";
const MEGABYTE = 1024 * 1024;

const CYCLE: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Road to Nationals 2027",
  status: "active",
  weeks: 28,
  startDate: "2026-10-12",
  event: null,
  ownRoutines: 4,
};

const BACK_SQUAT: ManagedExercise = {
  id: "e0e0e0e0-0000-4000-8000-000000000001",
  name: "Back squat",
  source: "library",
  tips: ["Keep your chest up.", "Push the knees out."],
  youtube: null,
  thumbnailUrl: `${CDN}library/Back_Squat/0.jpg`,
  photoUrls: {
    start: `${CDN}library/Back_Squat/0.jpg`,
    end: `${CDN}library/Back_Squat/1.jpg`,
  },
  routines: ["Gym A", "Strength"],
};

const TURN_AND_PUSH: ManagedExercise = {
  id: "e0e0e0e0-0000-4000-8000-000000000002",
  name: "Turn and push-off",
  source: "club",
  tips: ["Tuck tight.", "Push with both feet."],
  youtube: { kind: "search", query: "flip turn drill" },
  thumbnailUrl: null,
  photoUrls: { start: null, end: null },
  routines: [],
};

const FIN_KICK: ManagedExercise = {
  id: "e0e0e0e0-0000-4000-8000-000000000003",
  name: "Fin kick",
  source: "club",
  tips: [],
  youtube: { kind: "link", url: "https://youtu.be/fin" },
  thumbnailUrl: `${CDN}club/c/fin/0.jpg`,
  photoUrls: { start: `${CDN}club/c/fin/0.jpg`, end: null },
  routines: ["Pool skills"],
};

const EXERCISES = [BACK_SQUAT, FIN_KICK, TURN_AND_PUSH];
const COUNTS: ExerciseCounts = { library: 17, club: 5 };

type ApiReply = { readonly status: number; readonly body: unknown };
type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly form: FormData | null;
};

const requests: ApiRequest[] = [];

function ok(data: unknown, status = 200): ApiReply {
  return { status, body: { data } };
}

function failure(status: number, reason: string): ApiReply {
  return {
    status,
    body: { error: { code: "conflict", message: "x", reason } },
  };
}

const SERVER_ERROR: ApiReply = {
  status: 500,
  body: { error: { code: "internal_error", message: "x" } },
};

function page(
  exercises: readonly ManagedExercise[] = EXERCISES,
  nextOffset: number | null = null,
  counts: ExerciseCounts = COUNTS,
): ApiReply {
  return ok({ exercises, counts, nextOffset });
}

/** Los ciclos de siempre; `list` responde cada lista de ejercicios y
 * `write` lo demás. */
function stubApi(
  options: {
    readonly list?: (request: ApiRequest) => ApiReply | Promise<ApiReply>;
    readonly write?: (request: ApiRequest) => ApiReply;
  } = {},
): void {
  const list = options.list ?? (() => page());
  const write = options.write ?? (() => SERVER_ERROR);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const request = {
        method: init?.method ?? "GET",
        path: url.pathname,
        params: url.searchParams,
        form: init?.body instanceof FormData ? init.body : null,
      };
      requests.push(request);
      const reply = await (request.method !== "GET"
        ? write(request)
        : request.path === CYCLES_PATH
          ? ok({ cycles: [CYCLE] })
          : request.path === EXERCISES_PATH
            ? list(request)
            : SERVER_ERROR);
      return new Response(
        reply.status === 204 ? null : JSON.stringify(reply.body),
        {
          status: reply.status,
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );
}

/** Una respuesta que llega cuando la prueba la suelta. */
function deferred(
  keep: (release: (reply: ApiReply) => void) => void,
): Promise<ApiReply> {
  return new Promise((resolve) => keep(resolve));
}

function listRequests(): ApiRequest[] {
  return requests.filter(
    (request) => request.method === "GET" && request.path === EXERCISES_PATH,
  );
}

function lastListRequest(): ApiRequest {
  const last = listRequests().at(-1);
  if (last === undefined) {
    throw new Error("no se pidió ninguna lista");
  }
  return last;
}

function writes(): ApiRequest[] {
  return requests.filter((request) => request.method !== "GET");
}

function photoFile(options: {
  readonly name: string;
  readonly type: string;
  readonly bytes?: number;
}): File {
  const file = new File(["foto"], options.name, { type: options.type });
  if (options.bytes !== undefined) {
    Object.defineProperty(file, "size", { value: options.bytes });
  }
  return file;
}

beforeEach(() => {
  requests.length = 0;
  stubScreenWidth(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openExercises(
  locale: "en" | "es" = "en",
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<TrainingPlannerScreen locale={locale} />);
  await user.click(
    await screen.findByRole("tab", { name: /^(Exercises|Ejercicios)/ }),
  );
  await screen.findByRole("button", { name: /^Back squat/ });
  return user;
}

function exerciseList(): HTMLElement {
  return screen.getByRole("list", { name: "Exercises" });
}

function form(): HTMLElement {
  return screen.getByRole("form");
}

describe("la pestaña Exercises", () => {
  it("sale entre Cycle y Marks con cuántos ejercicios hay", async () => {
    stubApi();

    await openExercises();

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Cycle 28 wk",
      "Exercises 22",
      "Marks",
    ]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });

  it("tiene la búsqueda y las fichas All, Library y Club's own con su número", async () => {
    stubApi();

    await openExercises();

    expect(
      screen.getByRole("searchbox", { name: "Search exercises" }),
    ).toBeInTheDocument();
    const chips = within(screen.getByRole("group", { name: "Show" }));
    expect(
      chips.getAllByRole("button").map((chip) => chip.textContent),
    ).toEqual(["All 22", "Library 17", "Club's own 5"]);
    expect(chips.getByRole("button", { name: "All 22" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pinta cada fila con su miniatura, su nombre, sus rutinas y su origen", async () => {
    stubApi();

    await openExercises();

    const rows = within(exerciseList()).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Back squatIn Gym A · StrengthLibrary",
      "Fin kickIn Pool skillsClub",
      "Turn and push-offNot in any routine yetClub",
    ]);
    expect(rows[0]?.querySelector("img")).toHaveAttribute(
      "src",
      BACK_SQUAT.thumbnailUrl,
    );
    expect(rows[2]?.querySelector("img")).toBeNull();
  });

  it("termina con el crédito de las fotos de la biblioteca", async () => {
    stubApi();

    await openExercises();

    expect(
      screen.getByText("Library photos: free-exercise-db (public domain)."),
    ).toBeInTheDocument();
  });

  it("busca lo que se escribe", async () => {
    stubApi();
    const user = await openExercises();

    await user.type(
      screen.getByRole("searchbox", { name: "Search exercises" }),
      "squat",
    );

    await waitFor(() =>
      expect(lastListRequest().params.get("q")).toBe("squat"),
    );
  });

  it("con una ficha pide sólo ese origen y la marca como elegida", async () => {
    stubApi();
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: "Club's own 5" }));

    await waitFor(() =>
      expect(lastListRequest().params.get("source")).toBe("club"),
    );
    expect(
      screen.getByRole("button", { name: "Club's own 5" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("no pinta la biblioteca entera: pide la página siguiente con Show more", async () => {
    stubApi({
      list: (request) =>
        request.params.get("offset") === "20"
          ? page([TURN_AND_PUSH])
          : page([BACK_SQUAT, FIN_KICK], 20),
    });
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(
      await screen.findByRole("button", { name: /^Turn and push-off/ }),
    ).toBeInTheDocument();
    expect(within(exerciseList()).getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });

  it("mientras llega la página siguiente, Show more no se puede volver a pulsar", async () => {
    let releasePage: (reply: ApiReply) => void = () => undefined;
    stubApi({
      list: (request) =>
        request.params.get("offset") === "20"
          ? deferred((release) => (releasePage = release))
          : page([BACK_SQUAT, FIN_KICK], 20),
    });
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getByRole("button", { name: "Show more" })).toBeDisabled();
    releasePage(page([TURN_AND_PUSH]));
    expect(
      await screen.findByRole("button", { name: /^Turn and push-off/ }),
    ).toBeInTheDocument();
  });

  it("la página de un filtro viejo no pisa la lista del nuevo", async () => {
    let releasePage: (reply: ApiReply) => void = () => undefined;
    stubApi({
      list: (request) => {
        if (request.params.get("offset") === "20") {
          return deferred((release) => (releasePage = release));
        }
        return request.params.get("source") === "club"
          ? page([FIN_KICK, TURN_AND_PUSH])
          : page([BACK_SQUAT], 20);
      },
    });
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: "Show more" }));
    await user.click(screen.getByRole("button", { name: "Club's own 5" }));
    await screen.findByRole("button", { name: /^Turn and push-off/ });
    await act(async () => {
      releasePage(page([{ ...BACK_SQUAT, id: "otro", name: "Bench press" }]));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(
      within(exerciseList())
        .getAllByRole("listitem")
        .map(
          (row) => row.querySelector(".training-exercises-name")?.textContent,
        ),
    ).toEqual(["Fin kick", "Turn and push-off"]);
  });

  it("si la página siguiente no llega, lo dice", async () => {
    stubApi({
      list: (request) =>
        request.params.get("offset") === "20"
          ? SERVER_ERROR
          : page([BACK_SQUAT, FIN_KICK], 20),
    });
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load more exercises. Try again.",
    );
    expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled();
  });

  it("dice que no hay nada cuando la búsqueda no encuentra", async () => {
    stubApi({
      list: (request) =>
        request.params.get("q") === "zzz"
          ? page([], null, { library: 0, club: 0 })
          : page(),
    });
    const user = await openExercises();

    await user.type(
      screen.getByRole("searchbox", { name: "Search exercises" }),
      "zzz",
    );

    expect(
      await screen.findByText('No exercise called "zzz".'),
    ).toBeInTheDocument();
  });

  it("si la lista no llega lo dice y deja reintentar", async () => {
    let attempts = 0;
    stubApi({
      list: () => {
        attempts += 1;
        return attempts === 1 ? SERVER_ERROR : page();
      },
    });
    const user = userEvent.setup();
    render(<TrainingPlannerScreen locale="en" />);
    await user.click(await screen.findByRole("tab", { name: /^Exercises/ }));

    expect(
      await screen.findByText("We couldn't load the exercises."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("button", { name: /^Back squat/ }),
    ).toBeInTheDocument();
  });
});

describe("New club exercise", () => {
  it("crea uno con nombre, consejos, YouTube y las dos fotos, y avisa", async () => {
    const created: ManagedExercise = {
      ...TURN_AND_PUSH,
      id: "e0e0e0e0-0000-4000-8000-000000000009",
      name: "Barrel roll",
    };
    stubApi({ write: () => ok({ ...created }, 201) });
    const user = await openExercises();

    await user.type(within(form()).getByLabelText("Name"), "Barrel roll");
    await user.type(
      within(form()).getByLabelText("How to do it · optional"),
      "Roll fast{enter}Keep the ball close",
    );
    await user.type(
      within(form()).getByLabelText("YouTube link or search · optional"),
      "barrel roll uwr",
    );
    const start = photoFile({ name: "start.jpg", type: "image/jpeg" });
    const end = photoFile({ name: "end.png", type: "image/png" });
    await user.upload(within(form()).getByLabelText(/^Start photo/), start);
    await user.upload(within(form()).getByLabelText(/^End photo/), end);
    await user.click(
      screen.getByRole("button", { name: "Add to club exercises" }),
    );

    expect(
      await screen.findByText(
        "Barrel roll added. It shows up in routine search right away.",
      ),
    ).toBeInTheDocument();
    const [post] = writes();
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe(EXERCISES_PATH);
    expect(post?.form?.get("name")).toBe("Barrel roll");
    expect(post?.form?.get("tips")).toBe("Roll fast\nKeep the ball close");
    expect(post?.form?.get("youtube")).toBe("barrel roll uwr");
    expect(post?.form?.get("startPhoto")).toBe(start);
    expect(post?.form?.get("endPhoto")).toBe(end);
    expect(within(form()).getByLabelText("Name")).toHaveValue("");
    expect(listRequests().length).toBeGreaterThan(1);
  });

  it("sin nombre no deja añadirlo", async () => {
    stubApi();
    await openExercises();

    expect(
      screen.getByRole("button", { name: "Add to club exercises" }),
    ).toBeDisabled();
  });

  it("con un nombre repetido lo dice junto al campo", async () => {
    stubApi({ write: () => failure(409, "exercise_name_taken") });
    const user = await openExercises();

    await user.type(within(form()).getByLabelText("Name"), "back SQUAT");
    await user.click(
      screen.getByRole("button", { name: "Add to club exercises" }),
    );

    const name = within(form()).getByLabelText("Name");
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription(
        "There is already an exercise with that name.",
      ),
    );
    expect(name).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    {
      case: "de más de 5 MB",
      file: photoFile({
        name: "big.jpg",
        type: "image/jpeg",
        bytes: 5 * MEGABYTE + 1,
      }),
      message: "That photo is over 5 MB. Choose a smaller one.",
    },
    {
      case: "de otro formato",
      file: photoFile({ name: "move.gif", type: "image/gif" }),
      message: "Use a JPEG, PNG or WebP photo.",
    },
  ])("una foto $case lo dice y no la sube", async ({ file, message }) => {
    stubApi({ write: () => ok({ ...TURN_AND_PUSH }, 201) });
    const user = userEvent.setup({ applyAccept: false });
    render(<TrainingPlannerScreen locale="en" />);
    await user.click(await screen.findByRole("tab", { name: /^Exercises/ }));
    await screen.findByRole("button", { name: /^Back squat/ });

    const startField = within(form()).getByLabelText(/^Start photo/);
    await user.upload(startField, file);

    expect(startField).toHaveAccessibleDescription(message);
    await user.type(within(form()).getByLabelText("Name"), "Barrel roll");
    await user.click(
      screen.getByRole("button", { name: "Add to club exercises" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.form?.get("startPhoto")).toBeNull();
  });
});

describe("un ejercicio abierto", () => {
  it("uno del club se abre con lo que tiene y se cambia todo", async () => {
    stubApi({
      write: () => ok({ ...TURN_AND_PUSH, name: "Turn and glide" }),
    });
    const user = await openExercises();

    await user.click(
      screen.getByRole("button", { name: /^Turn and push-off/ }),
    );

    expect(
      screen.getByRole("heading", { name: "Turn and push-off" }),
    ).toBeInTheDocument();
    const name = within(form()).getByLabelText("Name");
    expect(name).toHaveValue("Turn and push-off");
    expect(
      within(form()).getByLabelText("How to do it · optional"),
    ).toHaveValue("Tuck tight.\nPush with both feet.");
    expect(
      within(form()).getByLabelText("YouTube link or search · optional"),
    ).toHaveValue("flip turn drill");

    await user.clear(name);
    await user.type(name, "Turn and glide");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Turn and glide saved")).toBeInTheDocument();
    const [patch] = writes();
    expect(patch?.method).toBe("PATCH");
    expect(patch?.path).toBe(`${EXERCISES_PATH}/${TURN_AND_PUSH.id}`);
    expect(patch?.form?.get("name")).toBe("Turn and glide");
  });

  it("quitar la foto que tenía la manda quitar", async () => {
    stubApi({ write: () => ok({ ...FIN_KICK }) });
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: /^Fin kick/ }));
    await user.click(
      within(form()).getByRole("button", { name: "Remove start photo" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.form?.get("removeStartPhoto")).toBe("true");
    expect(writes()[0]?.form?.get("removeEndPhoto")).toBeNull();
  });

  it("uno del club sin usar se borra", async () => {
    stubApi({ write: () => ({ status: 204, body: null }) });
    const user = await openExercises();

    await user.click(
      screen.getByRole("button", { name: /^Turn and push-off/ }),
    );
    await user.click(screen.getByRole("button", { name: "Delete exercise" }));

    expect(
      await screen.findByText("Turn and push-off deleted"),
    ).toBeInTheDocument();
    const [deletion] = writes();
    expect(deletion?.method).toBe("DELETE");
    expect(deletion?.path).toBe(`${EXERCISES_PATH}/${TURN_AND_PUSH.id}`);
    expect(
      screen.getByRole("heading", { name: "New club exercise" }),
    ).toBeInTheDocument();
  });

  it("uno del club en una rutina no se puede borrar y dice por qué", async () => {
    stubApi();
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: /^Fin kick/ }));

    const remove = screen.getByRole("button", { name: "Delete exercise" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAccessibleDescription(
      "It's in Pool skills. Take it out of those routines to delete it.",
    );
  });

  it("si alguien lo puso en una rutina entretanto, lo dice", async () => {
    stubApi({ write: () => failure(409, "exercise_in_use") });
    const user = await openExercises();

    await user.click(
      screen.getByRole("button", { name: /^Turn and push-off/ }),
    );
    await user.click(screen.getByRole("button", { name: "Delete exercise" }));

    expect(
      await screen.findByText(
        "That exercise is in a routine now. Take it out of the routine first.",
      ),
    ).toBeInTheDocument();
  });

  it("uno de la biblioteca es de lectura", async () => {
    stubApi();
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: /^Back squat/ }));

    const panel = screen.getByRole("region", { name: "Back squat" });
    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Delete exercise" }),
    ).not.toBeInTheDocument();
    expect(
      within(panel).getByText("From the library. You can't change it."),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Keep your chest up.")).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByRole("img")
        .map((img) => img.getAttribute("src")),
    ).toEqual([BACK_SQUAT.photoUrls.start, BACK_SQUAT.photoUrls.end]);
  });

  it("New club exercise vuelve al formulario vacío", async () => {
    stubApi();
    const user = await openExercises();

    await user.click(screen.getByRole("button", { name: /^Back squat/ }));
    await user.click(screen.getByRole("button", { name: "New club exercise" }));

    expect(within(form()).getByLabelText("Name")).toHaveValue("");
  });
});

describe("en el móvil", () => {
  it("pinta la lista y después el formulario", async () => {
    stubScreenWidth(true);
    stubApi();

    await openExercises();

    const list = exerciseList();
    expect(
      list.compareDocumentPosition(form()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("en español", () => {
  it("la pestaña y las fichas salen traducidas", async () => {
    stubApi();

    await openExercises("es");

    expect(screen.getByRole("tab", { name: "Ejercicios 22" })).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: "Mostrar" }))
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Todos 22", "Biblioteca 17", "Del club 5"]);
  });
});
