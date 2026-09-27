import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationCategoriesScreen } from "@/components/evaluations/EvaluationCategoriesScreen";
import type { EvaluationCategory } from "@/lib/evaluations/evaluation-categories";
import type { Locale } from "@/lib/i18n/locale";

/**
 * La pantalla de categorías de evaluación (#323, RF-3 del PRD de E9): un
 * Coach o un Admin ve las activas en su orden y las desactivadas aparte, y
 * añade, renombra, reordena (también con el teclado), desactiva y reactiva.
 * El servidor es un doble que guarda el catálogo en memoria; las reglas
 * (nombre repetido, qué entra en las evaluaciones nuevas) son suyas.
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
  name: "Experience",
  isActive: false,
};
const NEW_CATEGORY_ID = "ca7e0000-0000-4000-8000-000000000005";

type Request = { readonly method: string; readonly url: string; body: unknown };

let catalog: EvaluationCategory[];
let requests: Request[];
/** La respuesta de la próxima escritura o de la próxima carga, si no es la
 * del doble. */
let nextWriteResponse: (() => Response) | null;
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
  catalog = catalog.map((category) => {
    if (category.id !== categoryId) {
      return category;
    }
    return "name" in body
      ? { ...category, name: String(body.name) }
      : { ...category, isActive: body.isActive as boolean };
  });
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

async function renderScreen(locale: Locale = "en"): Promise<void> {
  render(<EvaluationCategoriesScreen locale={locale} />);
  await screen.findByRole("list", {
    name: locale === "en" ? "Active categories" : "Categorías activas",
  });
}

function activeList(): HTMLElement {
  return screen.getByRole("list", { name: "Active categories" });
}

function inactiveList(): HTMLElement {
  return screen.getByRole("list", { name: "Deactivated categories" });
}

function namesIn(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("heading").textContent ?? "");
}

function createForm(): HTMLElement {
  return screen.getByRole("form", { name: "Add a category" });
}

async function addCategory(name: string): Promise<void> {
  const field = within(createForm()).getByLabelText("Category name");
  await userEvent.clear(field);
  if (name !== "") {
    await userEvent.type(field, name);
  }
  await userEvent.click(
    within(createForm()).getByRole("button", { name: "Add category" }),
  );
}

beforeEach(() => {
  catalog = [FITNESS, SPEED, TEAMWORK, EXPERIENCE];
  requests = [];
  nextWriteResponse = null;
  nextLoadResponse = null;
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("pantalla de categorías", () => {
  it("lista las activas en su orden y las desactivadas aparte", async () => {
    await renderScreen();

    expect(namesIn(activeList())).toEqual(["Fitness", "Speed", "Teamwork"]);
    expect(namesIn(inactiveList())).toEqual(["Experience"]);
  });

  it("vuelve a Evaluaciones desde su cabecera", async () => {
    await renderScreen();

    expect(screen.getByRole("link", { name: /evaluations/i })).toHaveAttribute(
      "href",
      "/evaluaciones",
    );
  });

  it("añade una categoría, que aparece la última de las activas", async () => {
    await renderScreen();

    await addCategory("Breath hold");

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual([
        "Fitness",
        "Speed",
        "Teamwork",
        "Breath hold",
      ]),
    );
    expect(requests).toEqual([
      { method: "POST", url: CATEGORIES_PATH, body: { name: "Breath hold" } },
    ]);
    expect(within(createForm()).getByLabelText("Category name")).toHaveValue(
      "",
    );
    expect(screen.getByText("Breath hold added.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("renombra una categoría", async () => {
    await renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Rename Speed" }));
    const form = screen.getByRole("form", { name: "Rename Speed" });
    const field = within(form).getByLabelText("Category name");
    expect(field).toHaveValue("Speed");
    await userEvent.clear(field);
    await userEvent.type(field, "Sprint");
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual(["Fitness", "Sprint", "Teamwork"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${CATEGORIES_PATH}/${SPEED.id}`,
        body: { name: "Sprint" },
      },
    ]);
    expect(screen.queryByRole("form", { name: "Rename Speed" })).toBeNull();
  });

  it("desactiva una categoría y la pasa a las desactivadas", async () => {
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Deactivate Speed" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(inactiveList())).toEqual(["Speed", "Experience"]),
    );
    expect(namesIn(activeList())).toEqual(["Fitness", "Teamwork"]);
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${CATEGORIES_PATH}/${SPEED.id}`,
        body: { isActive: false },
      },
    ]);
  });

  it("reactiva una categoría desactivada", async () => {
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Reactivate Experience" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toContain("Experience"),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${CATEGORIES_PATH}/${EXPERIENCE.id}`,
        body: { isActive: true },
      },
    ]);
  });

  it("reordena con el teclado mandando la lista entera, y deja el foco en la categoría movida", async () => {
    await renderScreen();

    screen.getByRole("button", { name: "Move Teamwork up" }).focus();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual(["Fitness", "Teamwork", "Speed"]),
    );
    expect(requests).toEqual([
      {
        method: "PUT",
        url: ORDER_PATH,
        body: { categoryIds: [FITNESS.id, TEAMWORK.id, SPEED.id] },
      },
    ]);
    expect(
      screen.getByRole("button", { name: "Move Teamwork up" }),
    ).toHaveFocus();
    expect(screen.getByText("Teamwork is now number 2 of 3.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("no deja subir la primera ni bajar la última", async () => {
    await renderScreen();

    expect(
      screen.getByRole("button", { name: "Move Fitness up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Teamwork down" }),
    ).toBeDisabled();
  });

  it("enseña el nombre repetido junto al campo y no cambia la lista", async () => {
    await renderScreen();
    nextWriteResponse = () =>
      errorResponse(400, "validation_error", "name_taken");

    await addCategory("Speed");

    const field = within(createForm()).getByLabelText("Category name");
    await vi.waitFor(() =>
      expect(field).toHaveAttribute("aria-invalid", "true"),
    );
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining("Another category already has this name"),
    );
    expect(namesIn(activeList())).toEqual(["Fitness", "Speed", "Teamwork"]);
  });

  it("no manda un nombre vacío, y lo dice junto al campo", async () => {
    await renderScreen();

    await addCategory("   ");

    const field = within(createForm()).getByLabelText("Category name");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining("Write a name"),
    );
    expect(requests).toEqual([]);
  });

  it("no manda un nombre de más de 40 caracteres, y lo dice junto al campo", async () => {
    await renderScreen();

    await addCategory("x".repeat(41));

    const field = within(createForm()).getByLabelText("Category name");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining("Up to 40 characters"),
    );
    expect(requests).toEqual([]);
  });

  it("tras un fallo de red al añadir lo dice y deja reintentar con lo escrito", async () => {
    await renderScreen();
    nextWriteResponse = networkFailure;

    await addCategory("Breath hold");

    expect(
      await within(createForm()).findByText(/couldn't reach the server/i),
    ).toBeInTheDocument();
    expect(within(createForm()).getByLabelText("Category name")).toHaveValue(
      "Breath hold",
    );
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add category" }),
    );

    expect(
      await within(activeList()).findByText("Breath hold"),
    ).toBeInTheDocument();
    expect(within(createForm()).queryByRole("alert")).toBeNull();
  });

  it("tras un fallo de red al desactivar lo dice y reintenta con un botón", async () => {
    await renderScreen();
    nextWriteResponse = networkFailure;

    await userEvent.click(
      screen.getByRole("button", { name: "Deactivate Speed" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() =>
      expect(namesIn(inactiveList())).toEqual(["Speed", "Experience"]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si alguien cambió las categorías entretanto, ofrece cargar las últimas", async () => {
    await renderScreen();
    nextWriteResponse = () =>
      errorResponse(409, "conflict", "evaluation_categories_changed");

    await userEvent.click(
      screen.getByRole("button", { name: "Move Speed down" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /someone else changed the categories/i,
    );
    catalog = [TEAMWORK, FITNESS, SPEED, EXPERIENCE];
    await userEvent.click(
      screen.getByRole("button", { name: "Load the latest categories" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual(["Teamwork", "Fitness", "Speed"]),
    );
  });

  it("si no puede cargarlas, lo dice y deja reintentar", async () => {
    nextLoadResponse = networkFailure;
    render(<EvaluationCategoriesScreen locale="en" />);

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

    render(<EvaluationCategoriesScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only coaches and admins/i,
    );
  });

  it("sale entera en español", async () => {
    await renderScreen("es");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Categorías de evaluación",
      }),
    ).toBeInTheDocument();
    expect(
      namesIn(screen.getByRole("list", { name: "Categorías desactivadas" })),
    ).toEqual(["Experience"]);
    expect(
      screen.getByRole("button", { name: "Desactivar Speed" }),
    ).toBeInTheDocument();
  });
});

describe("el foco en la pantalla de categorías", () => {
  it("al subir una categoría hasta arriba pasa al botón de bajarla", async () => {
    await renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Speed up" }),
    );

    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move Speed down" }),
      ).toHaveFocus(),
    );
  });

  it("al cerrar el renombrado vuelve al botón que lo abrió", async () => {
    await renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Rename Speed" }));
    expect(
      within(screen.getByRole("form", { name: "Rename Speed" })).getByLabelText(
        "Category name",
      ),
    ).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Rename Speed" })).toHaveFocus();
  });
});
