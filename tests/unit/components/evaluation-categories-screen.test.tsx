import type { DndContextProps } from "@dnd-kit/core";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationCategoriesManager } from "@/components/evaluations/EvaluationCategoriesScreen";
import type { EvaluationCategory } from "@/lib/evaluations/evaluation-categories";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { type CapturedDndContext, dropOn } from "../helpers/dnd-kit-drag";

const dndContext = vi.hoisted((): CapturedDndContext => ({ props: null }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      dndContext.props = props;
      return <actual.DndContext {...props} />;
    },
  };
});

/**
 * La pestaña Categorías de Evaluaciones (#821, RF-5 del PRD de E31): una
 * tabla con las activas en su orden, que se reordena arrastrando por el asa
 * o con ↑ y ↓ sobre ella, se renombra en la misma fila y se amplía con la
 * fila de añadir. Las desactivadas van plegadas debajo. El servidor es un
 * doble que guarda el catálogo en memoria; el nombre repetido lo comprueba
 * también la pestaña antes de mandar nada.
 */

const CATEGORIES_PATH = "/api/v1/evaluations/categories";
const ORDER_PATH = `${CATEGORIES_PATH}/order`;

const FITNESS: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000001",
  name: "Fitness",
  isActive: true,
};
const SPEED: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000002",
  name: "Speed",
  isActive: true,
};
const TEAMWORK: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000003",
  name: "Teamwork",
  isActive: true,
};
const EXPERIENCE: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000004",
  name: "Experiência",
  isActive: false,
};
const NEW_CATEGORY_ID = "ca7e0000-0000-4000-8000-000000000005";

type Request = { readonly method: string; readonly url: string; body: unknown };

let catalog: EvaluationCategory[];
let requests: Request[];
/** La respuesta de la próxima escritura o de la próxima carga, si no es la
 * del doble. */
let nextWriteResponse: (() => Response | Promise<Response>) | null;
let nextLoadResponse: (() => Response) | null;

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

function catalogResponse(status = 200): Response {
  return jsonResponse(status, { data: { categories: catalog } });
}

function networkFailure(): Response {
  throw new TypeError("Failed to fetch");
}

function neverAnswers(): Promise<Response> {
  return new Promise(() => undefined);
}

function applyWrite(request: Request): Response {
  const body = request.body as Record<string, unknown>;
  if (request.url === ORDER_PATH) {
    const ids = body.categoryIds as string[];
    catalog = [
      ...ids.map((id) => catalog.find((category) => category.id === id)!),
      ...catalog.filter((category) => !category.isActive),
    ];
    return catalogResponse();
  }
  if (request.method === "POST") {
    const created = {
      id: NEW_CATEGORY_ID,
      name: String(body.name),
      isActive: true,
    };
    catalog = [
      ...catalog.filter(({ isActive }) => isActive),
      created,
      ...catalog.filter(({ isActive }) => !isActive),
    ];
    return catalogResponse(201);
  }
  const categoryId = request.url.split("/").at(-1);
  const target = catalog.find((category) => category.id === categoryId)!;
  if ("name" in body) {
    catalog = catalog.map((category) =>
      category === target ? { ...category, name: String(body.name) } : category,
    );
    return catalogResponse();
  }
  // Reactivar la devuelve al final de las activas.
  const changed = { ...target, isActive: body.isActive as boolean };
  const others = catalog.filter((category) => category !== target);
  catalog = [
    ...others.filter(({ isActive }) => isActive),
    changed,
    ...others.filter(({ isActive }) => !isActive),
  ];
  return catalogResponse();
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.startsWith(CATEGORIES_PATH)) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      const method = init?.method ?? "GET";
      if (method === "GET") {
        const load = nextLoadResponse;
        nextLoadResponse = null;
        return load?.() ?? catalogResponse();
      }
      const request: Request = {
        method,
        url,
        body: JSON.parse(String(init?.body)) as unknown,
      };
      requests.push(request);
      const write = nextWriteResponse;
      nextWriteResponse = null;
      return write?.() ?? applyWrite(request);
    }),
  );
}

function mountTab(locale: Locale = "en"): void {
  render(<EvaluationCategoriesManager translate={createTranslator(locale)} />);
}

async function renderTab(locale: Locale = "en"): Promise<void> {
  mountTab(locale);
  await screen.findByRole("list", {
    name: locale === "en" ? "Active categories" : "Categorías activas",
  });
}

function activeList(): HTMLElement {
  return screen.getByRole("list", { name: "Active categories" });
}

/** Los nombres de las activas, en el orden en que salen. */
function activeNames(): string[] {
  return within(activeList())
    .getAllByRole("listitem")
    .map(
      (row) =>
        row.querySelector(".evaluation-categories-name")?.textContent ?? "",
    );
}

function handleOf(name: string, rank: number, total = 3): HTMLElement {
  return screen.getByRole("button", {
    name: `Reorder ${name}, position ${rank} of ${total}`,
  });
}

function addField(): HTMLElement {
  return screen.getByRole("textbox", { name: "New category" });
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: "Add" });
}

async function openDeactivated(): Promise<HTMLElement> {
  await userEvent.click(
    screen.getByRole("button", { name: /^Deactivated categories: / }),
  );
  return screen.getByRole("list", { name: "Deactivated categories" });
}

beforeEach(() => {
  catalog = [FITNESS, SPEED, TEAMWORK, EXPERIENCE];
  requests = [];
  nextWriteResponse = null;
  nextLoadResponse = null;
  dndContext.props = null;
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("la tabla de categorías", () => {
  it("lleva la entradilla del orden y las activas en su orden, con su número", async () => {
    await renderTab();

    expect(
      screen.getByText(
        "The order here is the order on every evaluation. Deactivating hides a category from new ratings; old scores are kept.",
      ),
    ).toBeInTheDocument();
    expect(activeNames()).toEqual(["Fitness", "Speed", "Teamwork"]);
    const ranks = within(activeList())
      .getAllByRole("listitem")
      .map(
        (row) =>
          row.querySelector(".evaluation-categories-rank")?.textContent ?? "",
      );
    expect(ranks).toEqual(["1", "2", "3"]);
  });

  it("da a cada fila su asa, Renombrar y Desactivar", async () => {
    await renderTab();

    const [, row] = within(activeList()).getAllByRole("listitem");
    if (row === undefined) {
      throw new Error("Falta la segunda fila");
    }
    const handle = within(row).getByRole("button", {
      name: "Reorder Speed, position 2 of 3",
    });
    expect(handle).toHaveAttribute("title", "Drag, or use ↑ ↓");
    expect(
      within(row).getByRole("button", { name: "Rename Speed" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Deactivate Speed" }),
    ).toBeInTheDocument();
  });

  it("ya no tiene los botones de subir y bajar", async () => {
    await renderTab();

    expect(screen.queryByRole("button", { name: /^Move .* (up|down)$/ })).toBe(
      null,
    );
  });

  it("deja las desactivadas plegadas, con su número y su nota", async () => {
    await renderTab();

    const toggle = screen.getByRole("button", {
      name: "Deactivated categories: 1",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Deactivated · 1");
    expect(toggle).toHaveTextContent(
      "hidden from new ratings, kept on old ones",
    );
    expect(
      screen.queryByRole("list", { name: "Deactivated categories" }),
    ).toBeNull();

    const inactive = await openDeactivated();

    expect(within(inactive).getByText("Experiência")).toBeInTheDocument();
  });
});

describe("reordenar con ↑ y ↓ en el asa", () => {
  it("sube la fila un puesto, manda el orden entero, lo anuncia y deja el foco en el asa", async () => {
    await renderTab();

    handleOf("Teamwork", 3).focus();
    await userEvent.keyboard("{ArrowUp}");

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Fitness", "Teamwork", "Speed"]),
    );
    expect(requests).toEqual([
      {
        method: "PUT",
        url: ORDER_PATH,
        body: { categoryIds: [FITNESS.id, TEAMWORK.id, SPEED.id] },
      },
    ]);
    expect(
      screen.getByText("Teamwork moved to 2 of 3 · saved", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(handleOf("Teamwork", 2)).toHaveFocus());
  });

  it("baja la fila un puesto con ↓", async () => {
    await renderTab();

    handleOf("Fitness", 1).focus();
    await userEvent.keyboard("{ArrowDown}");

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Speed", "Fitness", "Teamwork"]),
    );
    await waitFor(() => expect(handleOf("Fitness", 2)).toHaveFocus());
  });

  it("enseña también a la vista que se guardó", async () => {
    await renderTab();

    handleOf("Teamwork", 3).focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(
      await screen.findByText("Teamwork moved to 2 of 3 · saved", {
        selector: ".club-saved-notice *",
      }),
    ).toBeInTheDocument();
  });

  it("no sube la primera ni baja la última", async () => {
    await renderTab();

    handleOf("Fitness", 1).focus();
    await userEvent.keyboard("{ArrowUp}");
    handleOf("Teamwork", 3).focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(requests).toEqual([]);
  });

  it("si falla al guardar, la fila sigue en su sitio y dice el error", async () => {
    await renderTab();
    nextWriteResponse = networkFailure;

    handleOf("Teamwork", 3).focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(activeNames()).toEqual(["Fitness", "Speed", "Teamwork"]);
  });

  it("si alguien cambió las categorías entretanto, ofrece cargar las últimas", async () => {
    await renderTab();
    nextWriteResponse = () =>
      errorResponse(409, "conflict", "evaluation_categories_changed");

    handleOf("Speed", 2).focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /someone else changed the categories/i,
    );
    catalog = [TEAMWORK, FITNESS, SPEED, EXPERIENCE];
    await userEvent.click(
      screen.getByRole("button", { name: "Load the latest categories" }),
    );

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Teamwork", "Fitness", "Speed"]),
    );
  });
});

describe("arrastrar por el asa", () => {
  it("soltar en otro puesto guarda el orden entero y lo anuncia", async () => {
    await renderTab();

    dropOn(dndContext, TEAMWORK.id, FITNESS.id);

    expect(
      await screen.findByText("Teamwork moved to 1 of 3 · saved", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
    expect(requests).toEqual([
      {
        method: "PUT",
        url: ORDER_PATH,
        body: { categoryIds: [TEAMWORK.id, FITNESS.id, SPEED.id] },
      },
    ]);
    expect(activeNames()).toEqual(["Teamwork", "Fitness", "Speed"]);
  });

  it("mientras el servidor contesta, la fila ya está donde se soltó", async () => {
    await renderTab();
    nextWriteResponse = neverAnswers;

    dropOn(dndContext, FITNESS.id, TEAMWORK.id);

    expect(activeNames()).toEqual(["Speed", "Teamwork", "Fitness"]);
  });

  it("si falla, la fila vuelve a su sitio y dice el error", async () => {
    await renderTab();
    nextWriteResponse = networkFailure;

    dropOn(dndContext, TEAMWORK.id, FITNESS.id);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(activeNames()).toEqual(["Fitness", "Speed", "Teamwork"]);
  });

  it("soltar en el mismo puesto no manda nada", async () => {
    await renderTab();

    dropOn(dndContext, SPEED.id, SPEED.id);

    expect(requests).toEqual([]);
  });
});

describe("renombrar en la fila", () => {
  it("pasa el nombre a un campo con ✓ y ×, con el foco dentro", async () => {
    await renderTab();

    await userEvent.click(screen.getByRole("button", { name: "Rename Speed" }));

    const field = screen.getByRole("textbox", { name: "New name for Speed" });
    expect(field).toHaveValue("Speed");
    expect(field).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Save name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("guarda con Intro", async () => {
    await renderTab();

    await userEvent.click(screen.getByRole("button", { name: "Rename Speed" }));
    const field = screen.getByRole("textbox", { name: "New name for Speed" });
    await userEvent.clear(field);
    await userEvent.type(field, "Sprint{Enter}");

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Fitness", "Sprint", "Teamwork"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${CATEGORIES_PATH}/${SPEED.id}`,
        body: { name: "Sprint" },
      },
    ]);
    expect(
      screen.queryByRole("textbox", { name: "New name for Speed" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rename Sprint" }),
      ).toHaveFocus(),
    );
  });

  it("cancela con Esc sin mandar nada y devuelve el foco a Renombrar", async () => {
    await renderTab();

    await userEvent.click(screen.getByRole("button", { name: "Rename Speed" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "New name for Speed" }),
      "y{Escape}",
    );

    expect(
      screen.queryByRole("textbox", { name: "New name for Speed" }),
    ).toBeNull();
    expect(activeNames()).toEqual(["Fitness", "Speed", "Teamwork"]);
    expect(requests).toEqual([]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rename Speed" }),
      ).toHaveFocus(),
    );
  });

  it("no deja guardar el nombre de otra categoría", async () => {
    await renderTab();

    await userEvent.click(screen.getByRole("button", { name: "Rename Speed" }));
    const field = screen.getByRole("textbox", { name: "New name for Speed" });
    await userEvent.clear(field);
    await userEvent.type(field, "fitness");

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "There is already a category with that name.",
    );
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
  });
});

describe("la fila de añadir", () => {
  it("lleva el campo de hasta 40 caracteres y Añadir deshabilitado mientras está vacío", async () => {
    await renderTab();

    expect(addField()).toHaveAttribute(
      "placeholder",
      "New category, e.g. Speed",
    );
    expect(addField()).toHaveAttribute("maxlength", "40");
    expect(addButton()).toBeDisabled();

    await userEvent.type(addField(), "   ");

    expect(addButton()).toBeDisabled();
  });

  it("añade con Intro y dice que sale sin nota en las que ya existen", async () => {
    await renderTab();

    await userEvent.type(addField(), "Breath hold{Enter}");

    await vi.waitFor(() =>
      expect(activeNames()).toEqual([
        "Fitness",
        "Speed",
        "Teamwork",
        "Breath hold",
      ]),
    );
    expect(requests).toEqual([
      { method: "POST", url: CATEGORIES_PATH, body: { name: "Breath hold" } },
    ]);
    expect(addField()).toHaveValue("");
    expect(
      screen.getByText(
        'Breath hold added · it shows as "not rated" on existing evaluations',
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["una activa, en minúsculas", "speed"],
    ["una desactivada", "Experiência"],
    ["una desactivada, sin tilde y en mayúsculas", "EXPERIENCIA"],
  ])("avisa del nombre de %s y no deja añadirlo", async (_case, name) => {
    await renderTab();

    await userEvent.type(addField(), name);

    expect(addField()).toHaveAttribute("aria-invalid", "true");
    expect(addField()).toHaveAccessibleDescription(
      "There is already a category with that name.",
    );
    expect(addButton()).toBeDisabled();
  });

  it("si el servidor dice que el nombre ya existe, lo enseña junto al campo", async () => {
    await renderTab();
    nextWriteResponse = () =>
      errorResponse(400, "validation_error", "name_taken");

    await userEvent.type(addField(), "Breath hold");
    await userEvent.click(addButton());

    await vi.waitFor(() =>
      expect(addField()).toHaveAttribute("aria-invalid", "true"),
    );
    expect(addField()).toHaveAccessibleDescription(
      "There is already a category with that name.",
    );
  });

  it("tras un fallo de red lo dice y deja reintentar con lo escrito", async () => {
    await renderTab();
    nextWriteResponse = networkFailure;

    await userEvent.type(addField(), "Breath hold{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(addField()).toHaveValue("Breath hold");
    await userEvent.click(addButton());

    await vi.waitFor(() => expect(activeNames()).toContain("Breath hold"));
  });
});

describe("desactivar y reactivar", () => {
  it("desactiva una categoría, lo dice y la pasa a las desactivadas", async () => {
    await renderTab();

    await userEvent.click(
      screen.getByRole("button", { name: "Deactivate Speed" }),
    );

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Fitness", "Teamwork"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${CATEGORIES_PATH}/${SPEED.id}`,
        body: { isActive: false },
      },
    ]);
    expect(
      screen.getByText("Speed deactivated · old scores kept", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
    const inactive = await openDeactivated();
    expect(within(inactive).getByText("Speed")).toBeInTheDocument();
  });

  it("reactiva una desactivada al final de las activas", async () => {
    await renderTab();
    const inactive = await openDeactivated();

    await userEvent.click(
      within(inactive).getByRole("button", { name: "Reactivate Experiência" }),
    );

    await vi.waitFor(() =>
      expect(activeNames()).toEqual([
        "Fitness",
        "Speed",
        "Teamwork",
        "Experiência",
      ]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${CATEGORIES_PATH}/${EXPERIENCE.id}`,
        body: { isActive: true },
      },
    ]);
    expect(
      screen.getByText("Experiência reactivated · added at the end", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("tras un fallo de red al desactivar lo dice y reintenta con un botón", async () => {
    await renderTab();
    nextWriteResponse = networkFailure;

    await userEvent.click(
      screen.getByRole("button", { name: "Deactivate Speed" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Fitness", "Teamwork"]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("la carga", () => {
  it("si no puede cargarlas, lo dice y deja reintentar", async () => {
    nextLoadResponse = networkFailure;
    mountTab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("list", { name: "Active categories" }),
    ).toBeInTheDocument();
  });

  it("dice que no tiene acceso si la API responde 403", async () => {
    nextLoadResponse = () => errorResponse(403, "forbidden");

    mountTab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only coaches and admins/i,
    );
  });
});

describe("en español", () => {
  it("sale entera en español", async () => {
    await renderTab("es");

    expect(
      screen.getByText(
        "El orden de aquí es el de cada evaluación. Desactivar oculta una categoría de las notas nuevas; las antiguas se conservan.",
      ),
    ).toBeInTheDocument();
    const handle = screen.getByRole("button", {
      name: "Reordenar Speed, posición 2 de 3",
    });
    expect(handle).toHaveAttribute("title", "Arrastra, o usa ↑ ↓");
    expect(
      screen.getByRole("button", { name: "Desactivar Speed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Nueva categoría" }),
    ).toHaveAttribute("placeholder", "Nueva categoría, p. ej. Velocidad");
    expect(screen.getByRole("button", { name: "Añadir" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Categorías desactivadas: 1" }),
    ).toHaveTextContent(
      "Desactivadas · 1ocultas en las notas nuevas, se conservan en las antiguas",
    );
  });

  it("anuncia en español lo que guarda", async () => {
    await renderTab("es");

    screen
      .getByRole("button", { name: "Reordenar Teamwork, posición 3 de 3" })
      .focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(
      await screen.findByText("Teamwork movida a 2 de 3 · guardado", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("avisa en español del nombre repetido", async () => {
    await renderTab("es");

    await userEvent.type(
      screen.getByRole("textbox", { name: "Nueva categoría" }),
      "experiencia",
    );

    expect(
      screen.getByText("Ya hay una categoría con ese nombre."),
    ).toBeInTheDocument();
  });

  it("dice en español lo que pasa al añadir, desactivar y reactivar", async () => {
    await renderTab("es");

    await userEvent.type(
      screen.getByRole("textbox", { name: "Nueva categoría" }),
      "Apnea{Enter}",
    );
    expect(
      await screen.findByText(
        'Apnea añadida · sale como "sin nota" en las evaluaciones que ya existen',
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Desactivar Speed" }),
    );
    expect(
      await screen.findByText(
        "Speed desactivada · se conservan las notas antiguas",
        {
          selector: "[aria-live]",
        },
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Categorías desactivadas: 2" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reactivar Speed" }),
    );
    expect(
      await screen.findByText("Speed reactivada · añadida al final", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });
});

/* El móvil (#823, RF-7 del PRD de E31): por debajo de 768 px la tabla no
   cabe. Cada activa es una fila de una tarjeta con su asa, su número, su
   nombre y una flecha; al tocarla sube una hoja con el nombre, Desactivar y
   Guardar. El ancho lo dice `matchMedia`, que aquí se simula; cómo se ve lo
   prueba Playwright. */

const PHONE_QUERY = "(width < 768px)";

function stubPhoneScreen(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function phoneRow(name: string): HTMLElement {
  return within(activeList()).getByRole("button", { name });
}

function sheet(name: string): HTMLElement {
  return screen.getByRole("dialog", { name });
}

async function openSheet(name: string): Promise<HTMLElement> {
  await userEvent.click(phoneRow(name));
  return sheet(name);
}

function sheetField(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("textbox", { name: "Name" });
}

async function renameInSheet(dialog: HTMLElement, name: string): Promise<void> {
  await userEvent.clear(sheetField(dialog));
  await userEvent.type(sheetField(dialog), name);
}

function saveButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("button", { name: "Save" });
}

describe("en el móvil", () => {
  beforeEach(() => {
    stubPhoneScreen();
  });

  describe("la tarjeta", () => {
    it("indica cómo se ordena y se renombra", async () => {
      await renderTab();

      expect(
        screen.getByText("Hold ⋮⋮ and drag to reorder. Tap to rename."),
      ).toBeInTheDocument();
    });

    it("en español indica cómo se ordena y se renombra", async () => {
      await renderTab("es");

      expect(
        screen.getByText(
          "Mantén ⋮⋮ y arrastra para ordenar. Toca para renombrar.",
        ),
      ).toBeInTheDocument();
    });

    it("pinta una fila por activa, en su orden, con su asa, su número y su nombre", async () => {
      await renderTab();

      expect(activeNames()).toEqual(["Fitness", "Speed", "Teamwork"]);
      const [, row] = within(activeList()).getAllByRole("listitem");
      if (row === undefined) {
        throw new Error("Falta la segunda fila");
      }
      expect(
        within(row).getByRole("button", {
          name: "Reorder Speed, position 2 of 3",
        }),
      ).toBeInTheDocument();
      expect(
        row.querySelector(".evaluation-categories-rank"),
      ).toHaveTextContent("2");
      expect(
        within(row).getByRole("button", { name: "Speed" }),
      ).toHaveAttribute("aria-haspopup", "dialog");
    });

    it("no pinta los controles de la tabla de escritorio", async () => {
      await renderTab();

      expect(screen.queryByRole("button", { name: /^Rename / })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Deactivate / })).toBeNull();
    });

    it("el asa reordena con ↑ como en escritorio", async () => {
      await renderTab();

      handleOf("Teamwork", 3).focus();
      await userEvent.keyboard("{ArrowUp}");

      await vi.waitFor(() =>
        expect(activeNames()).toEqual(["Fitness", "Teamwork", "Speed"]),
      );
      expect(requests[0]?.body).toEqual({
        categoryIds: [FITNESS.id, TEAMWORK.id, SPEED.id],
      });
      await waitFor(() => expect(handleOf("Teamwork", 2)).toHaveFocus());
    });

    it("el asa reordena con ↓ como en escritorio", async () => {
      await renderTab();

      handleOf("Fitness", 1).focus();
      await userEvent.keyboard("{ArrowDown}");

      await vi.waitFor(() =>
        expect(activeNames()).toEqual(["Speed", "Fitness", "Teamwork"]),
      );
    });

    it("soltar una fila arrastrada guarda el orden con el aviso del escritorio", async () => {
      await renderTab();

      dropOn(dndContext, TEAMWORK.id, FITNESS.id);

      expect(
        await screen.findByText("Teamwork moved to 1 of 3 · saved", {
          selector: ".club-saved-notice *",
        }),
      ).toBeInTheDocument();
      expect(requests[0]?.body).toEqual({
        categoryIds: [TEAMWORK.id, FITNESS.id, SPEED.id],
      });
    });

    it("tocar el asa no abre la hoja", async () => {
      await renderTab();

      await userEvent.click(handleOf("Speed", 2));

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("debajo de la tarjeta", () => {
    it("el campo Nueva categoría añade con Añadir", async () => {
      await renderTab();

      expect(addField()).toHaveAttribute("placeholder", "New category");
      await userEvent.type(addField(), "Breath hold");
      await userEvent.click(addButton());

      await vi.waitFor(() => expect(activeNames()).toContain("Breath hold"));
      expect(requests).toEqual([
        { method: "POST", url: CATEGORIES_PATH, body: { name: "Breath hold" } },
      ]);
    });

    it("avisa del nombre repetido al añadir y no deja mandarlo", async () => {
      await renderTab();

      await userEvent.type(addField(), "EXPERIENCIA");

      expect(addField()).toHaveAccessibleDescription(
        "There is already a category with that name.",
      );
      expect(addButton()).toBeDisabled();
    });

    it("las desactivadas van plegadas y se reactivan", async () => {
      await renderTab();

      const inactive = await openDeactivated();
      await userEvent.click(
        within(inactive).getByRole("button", {
          name: "Reactivate Experiência",
        }),
      );

      await vi.waitFor(() => expect(activeNames()).toContain("Experiência"));
      expect(requests[0]?.body).toEqual({ isActive: true });
    });
  });

  describe("la hoja de una categoría", () => {
    it("tocar la fila abre la hoja con el nombre, Desactivar y Guardar", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");

      expect(
        within(dialog).getByRole("heading", { name: "Speed" }),
      ).toBeInTheDocument();
      expect(sheetField(dialog)).toHaveValue("Speed");
      expect(
        within(dialog).getByRole("button", { name: "Deactivate" }),
      ).toBeInTheDocument();
      expect(saveButton(dialog)).toBeInTheDocument();
    });

    it("en español lleva Nombre, Desactivar y Guardar", async () => {
      await renderTab("es");

      await userEvent.click(
        within(
          screen.getByRole("list", { name: "Categorías activas" }),
        ).getByRole("button", { name: "Speed" }),
      );
      const dialog = sheet("Speed");

      expect(
        within(dialog).getByRole("textbox", { name: "Nombre" }),
      ).toHaveValue("Speed");
      expect(
        within(dialog).getByRole("button", { name: "Desactivar" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Guardar" }),
      ).toBeInTheDocument();
    });

    it("al abrirse deja el foco dentro de la hoja", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");

      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    });

    it("guarda el nombre nuevo, cierra, lo avisa y devuelve el foco a la fila", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");
      await renameInSheet(dialog, "Sprint");
      await userEvent.click(saveButton(dialog));

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests).toEqual([
        {
          method: "PATCH",
          url: `${CATEGORIES_PATH}/${SPEED.id}`,
          body: { name: "Sprint" },
        },
      ]);
      expect(activeNames()).toEqual(["Fitness", "Sprint", "Teamwork"]);
      expect(
        screen.getByText("Name saved.", { selector: ".club-saved-notice *" }),
      ).toBeInTheDocument();
      await waitFor(() => expect(phoneRow("Sprint")).toHaveFocus());
    });

    it("sin cambios, Guardar cierra la hoja sin mandar nada", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");
      await userEvent.click(saveButton(dialog));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
    });

    it("no deja guardar el nombre de otra categoría", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");
      await renameInSheet(dialog, "fitness");

      expect(sheetField(dialog)).toHaveAttribute("aria-invalid", "true");
      expect(sheetField(dialog)).toHaveAccessibleDescription(
        "There is already a category with that name.",
      );
      expect(saveButton(dialog)).toBeDisabled();
    });

    it("enseña en la hoja el nombre repetido que rechaza el servidor y la deja abierta", async () => {
      await renderTab();
      nextWriteResponse = () =>
        errorResponse(400, "validation_error", "name_taken");

      const dialog = await openSheet("Speed");
      await renameInSheet(dialog, "Sprint");
      await userEvent.click(saveButton(dialog));

      await vi.waitFor(() =>
        expect(sheetField(dialog)).toHaveAccessibleDescription(
          "There is already a category with that name.",
        ),
      );
      expect(sheet("Speed")).toBe(dialog);
    });

    it("Desactivar la pasa a las desactivadas y cierra la hoja", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Deactivate" }),
      );

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests).toEqual([
        {
          method: "PATCH",
          url: `${CATEGORIES_PATH}/${SPEED.id}`,
          body: { isActive: false },
        },
      ]);
      expect(activeNames()).toEqual(["Fitness", "Teamwork"]);
      const inactive = await openDeactivated();
      expect(within(inactive).getByText("Speed")).toBeInTheDocument();
    });

    it("un fallo de red al desactivar sale en la hoja y la deja abierta", async () => {
      await renderTab();
      nextWriteResponse = networkFailure;

      const dialog = await openSheet("Speed");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Deactivate" }),
      );

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /couldn't reach the server/i,
      );
      expect(sheet("Speed")).toBe(dialog);
      expect(activeNames()).toEqual(["Fitness", "Speed", "Teamwork"]);
    });

    it("Escape la cierra sin cambiar nada y devuelve el foco a la fila", async () => {
      await renderTab();

      const dialog = await openSheet("Speed");
      await userEvent.type(sheetField(dialog), "y");
      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
      await waitFor(() => expect(phoneRow("Speed")).toHaveFocus());
    });

    it("al reabrirla tras cerrarla sin guardar, empieza por lo guardado", async () => {
      await renderTab();

      const first = await openSheet("Speed");
      await userEvent.type(sheetField(first), "y");
      await userEvent.keyboard("{Escape}");
      const dialog = await openSheet("Speed");

      expect(sheetField(dialog)).toHaveValue("Speed");
    });
  });
});
