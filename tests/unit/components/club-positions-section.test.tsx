import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubPositionsSection } from "@/components/club/ClubPositionsSection";
import type { ManagedPosition } from "@/lib/club/manage-club-positions";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección de posiciones de la configuración del club (#300, RF-7 del PRD
 * de E18a), hecha tabla en #723 (RF-5 del PRD de E26): cada activa es una
 * fila con su asa, su número, sus nombres, su función en el auto-balance
 * (#404) y sus acciones. La función se guarda al cambiarla, se renombra en
 * la misma fila, se añade en la última y se reordena con las flechas sobre
 * el asa. El servidor es un doble que guarda el catálogo en memoria.
 */

const POSITIONS_PATH = "/api/v1/club/settings/positions";
const ORDER_PATH = `${POSITIONS_PATH}/order`;

const GOALKEEPER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
  coverage: "goalkeeper",
};
const DEFENDER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000002",
  names: { en: "Defender", es: "Defensa" },
  isArchived: false,
  coverage: "defender",
};
const FORWARD: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
  coverage: "forward",
};
const UTILITY: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000004",
  names: { en: "Utility", es: null },
  isArchived: true,
  coverage: null,
};
const NEW_POSITION_ID = "00000000-0000-4000-8000-000000000005";

type Request = { readonly method: string; readonly url: string; body: unknown };

let catalog: ManagedPosition[];
let requests: Request[];
/** La respuesta de la próxima petición que no sea la carga, si no es la del
 * doble. */
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
  return jsonResponse(status, { data: { positions: catalog } });
}

function applyWrite(request: Request): Response {
  const body = request.body as Record<string, unknown>;
  if (request.url === ORDER_PATH) {
    const ids = body.positionIds as string[];
    catalog = [
      ...ids.map((id) => catalog.find((position) => position.id === id)!),
      ...catalog.filter((position) => position.isArchived),
    ];
    return catalogResponse();
  }
  if (request.method === "POST") {
    catalog = [
      ...catalog,
      {
        id: NEW_POSITION_ID,
        names: body.names as ManagedPosition["names"],
        isArchived: false,
        coverage: null,
      },
    ];
    return catalogResponse(201);
  }
  const positionId = request.url.split("/").at(-1);
  catalog = catalog.map((position) => {
    if (position.id !== positionId) {
      return position;
    }
    if ("names" in body) {
      return { ...position, names: body.names as ManagedPosition["names"] };
    }
    if ("coverage" in body) {
      return {
        ...position,
        coverage: body.coverage as ManagedPosition["coverage"],
      };
    }
    return { ...position, isArchived: body.isArchived as boolean };
  });
  return catalogResponse();
}

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.startsWith(POSITIONS_PATH)) {
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

function networkFailure(): Response {
  throw new TypeError("Failed to fetch");
}

/** Una respuesta que no llega nunca: la acción se queda esperando. */
function neverAnswers(): Promise<Response> {
  return new Promise(() => {});
}

async function renderSection(locale: Locale = "en"): Promise<void> {
  render(
    <ClubPositionsSection
      locale={locale}
      translate={createTranslator(locale)}
    />,
  );
  await screen.findByRole("form", {
    name: locale === "en" ? "Add a position" : "Añadir una posición",
  });
}

function activeList(): HTMLElement {
  return screen.getByRole("list", { name: "Active positions" });
}

const HANDLE_LABEL = /^Reorder (.+), position \d+ of \d+$/;

/** Los nombres de las activas, en orden, tal como los dice su asa. */
function activeNames(): string[] {
  return within(activeList())
    .getAllByRole("listitem")
    .map((row) => {
      const handle = within(row).getByRole("button", { name: HANDLE_LABEL });
      return handle.getAttribute("aria-label")?.match(HANDLE_LABEL)?.[1] ?? "";
    });
}

function rowOf(name: string): HTMLElement {
  const handle = screen.getByRole("button", {
    name: new RegExp(`^Reorder ${name}, `),
  });
  const row = handle.closest("li");
  if (row === null) {
    throw new Error(`${name} no está en una fila`);
  }
  return row;
}

function handleOf(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^Reorder ${name}, `) });
}

function archivedToggle(): HTMLElement {
  return screen.getByRole("button", { name: /^Archived · \d+/ });
}

async function openArchived(): Promise<HTMLElement> {
  await userEvent.click(archivedToggle());
  return screen.getByRole("list", { name: "Archived positions" });
}

function archivedNames(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("button", { name: /^Reactivate / })
    .map(
      (button) =>
        button.getAttribute("aria-label")?.replace("Reactivate ", "") ?? "",
    );
}

function createForm(): HTMLElement {
  return screen.getByRole("form", { name: "Add a position" });
}

function coverageOf(name: string): HTMLElement {
  return screen.getByRole("combobox", { name: `Role of ${name}` });
}

async function fillNames(
  form: HTMLElement,
  names: { readonly en: string; readonly es: string },
): Promise<void> {
  const english = within(form).getByLabelText("Name in English");
  const spanish = within(form).getByLabelText("Name in Spanish");
  await userEvent.clear(english);
  if (names.en !== "") {
    await userEvent.type(english, names.en);
  }
  await userEvent.clear(spanish);
  if (names.es !== "") {
    await userEvent.type(spanish, names.es);
  }
}

async function openRename(name: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: `Rename ${name}` }));
  return screen.getByRole("form", { name: `Rename ${name}` });
}

beforeEach(() => {
  catalog = [GOALKEEPER, DEFENDER, FORWARD, UTILITY];
  requests = [];
  nextWriteResponse = null;
  nextLoadResponse = null;
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("la tabla de posiciones", () => {
  it("explica que el orden vale en todas partes y para qué es el rol", async () => {
    await renderSection();

    expect(
      screen.getByText(
        "The order here is the order everywhere: directory filters, teams and evaluations. The role tells auto-balance where each position plays.",
      ),
    ).toBeInTheDocument();
  });

  it("encabeza las columnas con la posición y el rol en el reparto", async () => {
    await renderSection();

    expect(screen.getByText("Position")).toBeInTheDocument();
    expect(screen.getByText("Role in auto-balance")).toBeInTheDocument();
  });

  it("pinta una fila por activa, en su orden, con su asa", async () => {
    await renderSection();

    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
    expect(
      screen.getByRole("button", {
        name: "Reorder Defender, position 2 of 3",
      }),
    ).toBeInTheDocument();
  });

  it("enseña el número de cada fila y el nombre en el otro idioma", async () => {
    await renderSection();

    const row = rowOf("Defender");
    expect(within(row).getByText("2")).toBeInTheDocument();
    // "Defender" es también una de las funciones del desplegable.
    expect(
      within(row).getByText("Defender", { ignore: "option" }),
    ).toBeInTheDocument();
    expect(within(row).getByText("ES · Defensa")).toBeInTheDocument();
  });

  it("en español pinta el nombre en español y el inglés en pequeño", async () => {
    await renderSection("es");

    const handle = screen.getByRole("button", {
      name: "Reordenar Portería, puesto 1 de 3",
    });
    const row = handle.closest("li")!;
    expect(within(row).getByText("Portería")).toBeInTheDocument();
    expect(within(row).getByText("EN · Goalkeeper")).toBeInTheDocument();
  });

  it("avisa cuando a una posición le falta el nombre en un idioma", async () => {
    catalog = [GOALKEEPER, { ...UTILITY, isArchived: false }];

    await renderSection();

    expect(
      within(rowOf("Utility")).getByText("No Spanish name"),
    ).toBeInTheDocument();
  });

  it("en español avisa de que falta el nombre en inglés", async () => {
    catalog = [{ ...GOALKEEPER, names: { en: null, es: "Portería" } }];

    await renderSection("es");

    expect(screen.getByText("Sin nombre en inglés")).toBeInTheDocument();
  });

  it("ya no tiene los botones de subir y bajar", async () => {
    await renderSection();

    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Up|Down)$/ })).toBeNull();
  });

  it("sin activas deja sólo la fila de añadir y dice que no hay", async () => {
    catalog = [UTILITY];

    await renderSection();

    expect(screen.queryByRole("list", { name: "Active positions" })).toBeNull();
    expect(
      screen.getByText(/There are no active positions/),
    ).toBeInTheDocument();
    expect(createForm()).toBeInTheDocument();
  });

  it("si no puede cargarlas, lo dice y deja reintentar", async () => {
    nextLoadResponse = networkFailure;
    render(
      <ClubPositionsSection locale="en" translate={createTranslator("en")} />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("list", { name: "Active positions" }),
    ).toBeInTheDocument();
  });
});

describe("el rol de cada posición", () => {
  it("enseña el rol de cada activa", async () => {
    await renderSection();

    expect(coverageOf("Goalkeeper")).toHaveDisplayValue("Goalkeeper");
    expect(coverageOf("Defender")).toHaveDisplayValue("Defender");
    expect(coverageOf("Forward")).toHaveDisplayValue("Forward");
  });

  it("ofrece los tres roles y ninguno", async () => {
    await renderSection();

    expect(
      within(coverageOf("Goalkeeper"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No role", "Goalkeeper", "Defender", "Forward"]);
  });

  it("no tiene botón de guardar aparte", async () => {
    await renderSection();

    expect(screen.queryByRole("button", { name: /^Save role/ })).toBeNull();
  });

  it("guarda el rol al cambiarlo, lo anuncia y deja el foco en él", async () => {
    await renderSection();

    await userEvent.selectOptions(coverageOf("Forward"), "Defender");

    expect(
      await screen.findByText("Forward now counts as Defender"),
    ).toHaveAttribute("aria-live", "polite");
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${FORWARD.id}`,
        body: { coverage: "defender" },
      },
    ]);
    expect(coverageOf("Forward")).toHaveDisplayValue("Defender");
    expect(coverageOf("Defender")).toHaveDisplayValue("Defender");
    expect(coverageOf("Forward")).toHaveFocus();
  });

  it("le quita el rol con la opción de ninguno", async () => {
    await renderSection();

    await userEvent.selectOptions(coverageOf("Goalkeeper"), "No role");

    expect(
      await screen.findByText("Goalkeeper no longer counts as any role"),
    ).toBeInTheDocument();
    expect(requests[0]?.body).toEqual({ coverage: null });
  });

  it("tras un fallo de red conserva el elegido y reintenta con un botón", async () => {
    await renderSection();
    nextWriteResponse = networkFailure;

    await userEvent.selectOptions(coverageOf("Forward"), "Goalkeeper");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(coverageOf("Forward")).toHaveDisplayValue("Goalkeeper");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() =>
      expect(catalog.find(({ id }) => id === FORWARD.id)?.coverage).toBe(
        "goalkeeper",
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("en español nombra el rol de cada posición con sus textos de hoy", async () => {
    await renderSection("es");

    const control = screen.getByRole("combobox", {
      name: "Función de Portería",
    });
    expect(control).toHaveDisplayValue("Portero");
    expect(
      within(control)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Sin función", "Portero", "Defensa", "Ataque"]);
  });
});

describe("renombrar en la fila", () => {
  it("abre los dos nombres en su fila con el foco en el primero", async () => {
    await renderSection();

    const form = await openRename("Defender");

    expect(rowOf("Defender")).toContainElement(form);
    expect(within(form).getByLabelText("Name in English")).toHaveValue(
      "Defender",
    );
    expect(within(form).getByLabelText("Name in Spanish")).toHaveValue(
      "Defensa",
    );
    expect(within(form).getByLabelText("Name in English")).toHaveFocus();
  });

  it("guarda el nombre nuevo y devuelve el foco a Renombrar", async () => {
    await renderSection();

    const form = await openRename("Defender");
    await fillNames(form, { en: "Back", es: "Defensa" });
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Goalkeeper", "Back", "Forward"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${DEFENDER.id}`,
        body: { names: { en: "Back", es: "Defensa" } },
      },
    ]);
    expect(screen.queryByRole("form", { name: "Rename Defender" })).toBeNull();
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename Back" })).toHaveFocus(),
    );
  });

  it("cancelar lo deja como estaba y devuelve el foco a Renombrar", async () => {
    await renderSection();

    const form = await openRename("Defender");
    await fillNames(form, { en: "Back", es: "" });
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form", { name: "Rename Defender" })).toBeNull();
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
    expect(requests).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Rename Defender" }),
    ).toHaveFocus();
  });

  it("enseña el nombre repetido junto al campo de su idioma", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(400, "validation_error", "name_en_taken");

    const form = await openRename("Defender");
    await fillNames(form, { en: "Forward", es: "Defensa" });
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    const english = within(form).getByLabelText("Name in English");
    await vi.waitFor(() =>
      expect(english).toHaveAttribute("aria-invalid", "true"),
    );
    expect(english).toHaveAccessibleDescription(
      expect.stringContaining("Another position already has this name"),
    );
    expect(screen.getByRole("form", { name: "Rename Defender" })).toBe(form);
  });

  it("no manda nada sin ningún nombre, y lo dice junto al campo", async () => {
    await renderSection();

    const form = await openRename("Defender");
    await fillNames(form, { en: "", es: "" });
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    expect(
      within(form).getByLabelText("Name in English"),
    ).toHaveAccessibleDescription(
      expect.stringContaining("at least one language"),
    );
    expect(requests).toEqual([]);
  });

  it("no manda un nombre de más de 40 caracteres", async () => {
    await renderSection();

    const form = await openRename("Defender");
    await fillNames(form, { en: "a".repeat(41), es: "Defensa" });
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    expect(
      within(form).getByLabelText("Name in English"),
    ).toHaveAccessibleDescription(expect.stringContaining("Up to 40"));
    expect(requests).toEqual([]);
  });
});

describe("la fila de añadir", () => {
  it("no deja añadir sin ningún nombre", async () => {
    await renderSection();

    expect(
      within(createForm()).getByRole("button", { name: "Add" }),
    ).toBeDisabled();
    expect(
      within(createForm()).getByText("One name is enough."),
    ).toBeInTheDocument();
  });

  it("añade una posición con un solo nombre y vacía la fila", async () => {
    await renderSection();

    await fillNames(createForm(), { en: "", es: "Centro" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add" }),
    );

    await vi.waitFor(() => expect(activeNames()).toContain("Centro"));
    expect(requests).toEqual([
      {
        method: "POST",
        url: POSITIONS_PATH,
        body: { names: { en: null, es: "Centro" } },
      },
    ]);
    expect(within(createForm()).getByLabelText("Name in Spanish")).toHaveValue(
      "",
    );
  });

  it("enseña el nombre repetido junto al campo de su idioma", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(400, "validation_error", "name_es_taken");

    await fillNames(createForm(), { en: "Centre", es: "Defensa" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add" }),
    );

    const spanish = within(createForm()).getByLabelText("Name in Spanish");
    await vi.waitFor(() =>
      expect(spanish).toHaveAttribute("aria-invalid", "true"),
    );
    expect(spanish).toHaveAccessibleDescription(
      expect.stringContaining("Another position already has this name"),
    );
  });

  it("tras un fallo de red lo dice y deja reintentar con lo escrito", async () => {
    await renderSection();
    nextWriteResponse = networkFailure;

    await fillNames(createForm(), { en: "Centre", es: "Centro" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add" }),
    );

    expect(
      await within(createForm()).findByText(/couldn't reach the server/i),
    ).toBeInTheDocument();
    expect(within(createForm()).getByLabelText("Name in English")).toHaveValue(
      "Centre",
    );
  });
});

describe("archivar y reactivar", () => {
  it("las archivadas salen plegadas con cuántas son", async () => {
    await renderSection();

    expect(archivedToggle()).toHaveAccessibleName(
      "Archived · 1, hidden from new records, kept on old ones",
    );
    expect(archivedToggle()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("list", { name: "Archived positions" }),
    ).toBeNull();
  });

  it("desplegadas, cada una tiene su nombre y Reactivar", async () => {
    await renderSection();

    const list = await openArchived();

    expect(archivedToggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(list).getByText("Utility")).toBeInTheDocument();
    expect(archivedNames(list)).toEqual(["Utility"]);
  });

  it("sin archivadas no sale el desplegable", async () => {
    catalog = [GOALKEEPER, DEFENDER, FORWARD];

    await renderSection();

    expect(screen.queryByRole("button", { name: /^Archived/ })).toBeNull();
  });

  it("archiva una posición y la pasa a las archivadas", async () => {
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Archive Defender" }),
    );

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Goalkeeper", "Forward"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${DEFENDER.id}`,
        body: { isArchived: true },
      },
    ]);
    expect(archivedNames(await openArchived())).toEqual([
      "Defender",
      "Utility",
    ]);
  });

  it("reactiva una posición archivada", async () => {
    await renderSection();

    const list = await openArchived();
    await userEvent.click(
      within(list).getByRole("button", { name: "Reactivate Utility" }),
    );

    await vi.waitFor(() => expect(activeNames()).toContain("Utility"));
    expect(requests[0]?.body).toEqual({ isArchived: false });
  });

  it("tras un fallo de red al archivar lo dice y reintenta con un botón", async () => {
    await renderSection();
    nextWriteResponse = networkFailure;

    await userEvent.click(
      screen.getByRole("button", { name: "Archive Defender" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Goalkeeper", "Forward"]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("reordenar con el asa", () => {
  it("↑ sube la posición un puesto, lo anuncia y deja el foco en el asa", async () => {
    await renderSection();

    handleOf("Forward").focus();
    await userEvent.keyboard("{ArrowUp}");

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Goalkeeper", "Forward", "Defender"]),
    );
    expect(requests).toEqual([
      {
        method: "PUT",
        url: ORDER_PATH,
        body: { positionIds: [GOALKEEPER.id, FORWARD.id, DEFENDER.id] },
      },
    ]);
    expect(screen.getByText("Forward moved to 2 of 3")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(
      screen.getByRole("button", { name: "Reorder Forward, position 2 of 3" }),
    ).toHaveFocus();
  });

  it("↓ baja la posición un puesto", async () => {
    await renderSection();

    handleOf("Goalkeeper").focus();
    await userEvent.keyboard("{ArrowDown}");

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Defender", "Goalkeeper", "Forward"]),
    );
    expect(handleOf("Goalkeeper")).toHaveFocus();
  });

  it("en los extremos no hace nada", async () => {
    await renderSection();

    handleOf("Goalkeeper").focus();
    await userEvent.keyboard("{ArrowUp}");
    handleOf("Forward").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(requests).toEqual([]);
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
  });

  it("si otro Admin cambió las posiciones, ofrece cargar las últimas", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(409, "conflict", "club_positions_changed");

    handleOf("Defender").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /another admin changed the positions/i,
    );
    catalog = [FORWARD, GOALKEEPER, DEFENDER, UTILITY];
    await userEvent.click(
      screen.getByRole("button", { name: "Load the latest positions" }),
    );

    await vi.waitFor(() =>
      expect(activeNames()).toEqual(["Forward", "Goalkeeper", "Defender"]),
    );
  });
});

describe("lo que pasa al guardar", () => {
  it("cuando el servidor confirma, sale un aviso corto de guardado", async () => {
    await renderSection();

    handleOf("Forward").focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(
      await screen.findByText("Forward moved to 2 of 3 · saved"),
    ).toBeInTheDocument();
  });

  it("en español el aviso dice guardado", async () => {
    await renderSection("es");

    screen
      .getByRole("button", { name: "Reordenar Ataque, puesto 3 de 3" })
      .focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(
      await screen.findByText("Ataque movida al 2 de 3 · guardado"),
    ).toBeInTheDocument();
  });

  it("con una acción esperando al servidor, las demás esperan", async () => {
    await renderSection();
    nextWriteResponse = neverAnswers;

    await userEvent.click(
      screen.getByRole("button", { name: "Archive Defender" }),
    );
    handleOf("Forward").focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(
      screen.getByRole("button", { name: "Archive Forward" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Rename Forward" }),
    ).toBeDisabled();
    expect(coverageOf("Forward")).toBeDisabled();
    expect(requests).toHaveLength(1);
  });
});
