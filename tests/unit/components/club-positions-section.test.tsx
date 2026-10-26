import type { DndContextProps } from "@dnd-kit/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubPositionsSection } from "@/components/club/ClubPositionsSection";
import type { ManagedPosition } from "@/lib/club/manage-club-positions";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  announcementsOf,
  type CapturedDndContext,
  dropOn,
} from "../helpers/dnd-kit-drag";

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
  minPerTeam: 1,
  shortNames: { en: "GK", es: "POR" },
};
const DEFENDER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000002",
  names: { en: "Defender", es: "Defensa" },
  isArchived: false,
  minPerTeam: 2,
  shortNames: { en: null, es: null },
};
const FORWARD: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
  minPerTeam: 0,
  shortNames: { en: null, es: null },
};
const UTILITY: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000004",
  names: { en: "Utility", es: null },
  isArchived: true,
  minPerTeam: 0,
  shortNames: { en: null, es: null },
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
        minPerTeam: 0,
        shortNames: { en: null, es: null },
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
    if ("minPerTeam" in body) {
      return { ...position, minPerTeam: body.minPerTeam as number };
    }
    if ("shortNames" in body) {
      return {
        ...position,
        shortNames: body.shortNames as ManagedPosition["shortNames"],
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

function minimumOf(name: string): HTMLElement {
  return screen.getByRole("spinbutton", {
    name: `Minimum per team for ${name}`,
  });
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
  it("explica que el orden vale en todas partes y qué es el mínimo", async () => {
    await renderSection();

    expect(
      screen.getByText(
        "The order here is the order everywhere: directory filters, teams and evaluations. The minimum is how many of each position auto-balance tries to put in every team; 0 means it doesn't matter.",
      ),
    ).toBeInTheDocument();
  });

  it("en español explica el mínimo con tú", async () => {
    await renderSection("es");

    expect(
      screen.getByText(
        /El mínimo es cuántos de cada posición intenta poner auto-balance en cada equipo; 0 es que no importa./,
      ),
    ).toBeInTheDocument();
  });

  it("encabeza las columnas con la posición y el mínimo por equipo", async () => {
    await renderSection();

    expect(screen.getByText("Position")).toBeInTheDocument();
    expect(screen.getByText("Minimum per team")).toBeInTheDocument();
  });

  it("en español la columna es Mínimo por equipo", async () => {
    await renderSection("es");

    expect(screen.getByText("Mínimo por equipo")).toBeInTheDocument();
  });

  it("junto al nombre enseña la abreviatura del club", async () => {
    await renderSection();

    expect(within(rowOf("Goalkeeper")).getByText("GK")).toBeInTheDocument();
  });

  it("sin abreviatura enseña la que se usará: tres letras del nombre", async () => {
    await renderSection();

    expect(within(rowOf("Defender")).getByText("DEF")).toBeInTheDocument();
    expect(within(rowOf("Forward")).getByText("FOR")).toBeInTheDocument();
  });

  it("en español enseña la abreviatura en español", async () => {
    await renderSection("es");

    expect(screen.getByText("POR")).toBeInTheDocument();
    expect(screen.getByText("ATA")).toBeInTheDocument();
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
    expect(within(row).getByText("Defender")).toBeInTheDocument();
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

describe("el mínimo por equipo", () => {
  it("enseña el mínimo de cada activa, de 0 a 20", async () => {
    await renderSection();

    expect(minimumOf("Goalkeeper")).toHaveValue(1);
    expect(minimumOf("Defender")).toHaveValue(2);
    expect(minimumOf("Forward")).toHaveValue(0);
    expect(minimumOf("Forward")).toHaveAttribute("min", "0");
    expect(minimumOf("Forward")).toHaveAttribute("max", "20");
  });

  it("ya no tiene el selector de rol", async () => {
    await renderSection();

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Role in auto-balance")).toBeNull();
  });

  it("guarda el número al pulsar Enter, lo anuncia y deja el foco en él", async () => {
    await renderSection();

    await userEvent.clear(minimumOf("Defender"));
    await userEvent.type(minimumOf("Defender"), "3{Enter}");

    expect(
      await screen.findByText("Defender: 3 per team · saved"),
    ).toBeInTheDocument();
    expect(screen.getByText("Defender: 3 per team")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${DEFENDER.id}`,
        body: { minPerTeam: 3 },
      },
    ]);
    expect(minimumOf("Defender")).toHaveValue(3);
    expect(minimumOf("Defender")).toHaveFocus();
  });

  it("guarda el número al salir del campo", async () => {
    await renderSection();

    await userEvent.clear(minimumOf("Defender"));
    await userEvent.type(minimumOf("Defender"), "12");
    await userEvent.tab();

    await vi.waitFor(() =>
      expect(requests.map((request) => request.body)).toEqual([
        { minPerTeam: 12 },
      ]),
    );
    expect(await screen.findByText("Defender: 12 per team")).toBeVisible();
  });

  it("con 0 dice que no hay mínimo", async () => {
    await renderSection();

    await userEvent.clear(minimumOf("Goalkeeper"));
    await userEvent.type(minimumOf("Goalkeeper"), "0{Enter}");

    expect(
      await screen.findByText("Goalkeeper: no minimum · saved"),
    ).toBeInTheDocument();
    expect(requests[0]?.body).toEqual({ minPerTeam: 0 });
  });

  it("la flecha arriba sube uno y lo guarda al momento", async () => {
    await renderSection();

    minimumOf("Forward").focus();
    await userEvent.keyboard("{ArrowUp}");

    await vi.waitFor(() =>
      expect(requests.map((request) => request.body)).toEqual([
        { minPerTeam: 1 },
      ]),
    );
    await vi.waitFor(() => expect(minimumOf("Forward")).toHaveFocus());
  });

  it("la flecha abajo no baja de 0", async () => {
    await renderSection();

    minimumOf("Forward").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(minimumOf("Forward")).toHaveValue(0);
    expect(requests).toEqual([]);
  });

  it("la flecha arriba no pasa de 20", async () => {
    catalog = [{ ...FORWARD, minPerTeam: 20 }];
    await renderSection();

    minimumOf("Forward").focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(minimumOf("Forward")).toHaveValue(20);
    expect(requests).toEqual([]);
  });

  it.each(["21", "-1", "1.5", ""])(
    "con %j escrito a mano no manda nada y vuelve al último válido",
    async (typed) => {
      await renderSection();

      await userEvent.clear(minimumOf("Defender"));
      if (typed !== "") {
        await userEvent.type(minimumOf("Defender"), typed);
      }
      await userEvent.tab();

      expect(minimumOf("Defender")).toHaveValue(2);
      expect(requests).toEqual([]);
    },
  );

  it("con el mismo número no manda nada", async () => {
    await renderSection();

    await userEvent.clear(minimumOf("Defender"));
    await userEvent.type(minimumOf("Defender"), "2{Enter}");

    expect(requests).toEqual([]);
  });

  it("si falla, vuelve al número anterior, lo dice y reintenta con un botón", async () => {
    await renderSection();
    nextWriteResponse = networkFailure;

    await userEvent.clear(minimumOf("Defender"));
    await userEvent.type(minimumOf("Defender"), "4{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(minimumOf("Defender")).toHaveValue(2);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() => expect(minimumOf("Defender")).toHaveValue(4));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("una archivada no enseña ni deja cambiar su mínimo", async () => {
    catalog = [GOALKEEPER, { ...UTILITY, minPerTeam: 3 }];
    await renderSection();

    const archived = await openArchived();

    expect(within(archived).queryByRole("spinbutton")).toBeNull();
    expect(within(archived).queryByText("3")).toBeNull();
    expect(
      screen.queryByRole("spinbutton", {
        name: "Minimum per team for Utility",
      }),
    ).toBeNull();
  });

  it("en español nombra el mínimo y dice cuántos por equipo", async () => {
    await renderSection("es");

    const control = screen.getByRole("spinbutton", {
      name: "Mínimo por equipo de Portería",
    });
    await userEvent.clear(control);
    await userEvent.type(control, "2{Enter}");

    expect(
      await screen.findByText("Portería: 2 por equipo · guardado"),
    ).toBeInTheDocument();
  });

  it("en español con 0 dice sin mínimo", async () => {
    await renderSection("es");

    const control = screen.getByRole("spinbutton", {
      name: "Mínimo por equipo de Portería",
    });
    await userEvent.clear(control);
    await userEvent.type(control, "0{Enter}");

    expect(
      await screen.findByText("Portería: sin mínimo · guardado"),
    ).toBeInTheDocument();
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

  it("junto a cada nombre abre su abreviatura, de hasta 4 caracteres", async () => {
    await renderSection();

    const form = await openRename("Goalkeeper");
    const english = within(form).getByLabelText("Short name in English");
    const spanish = within(form).getByLabelText("Short name in Spanish");

    expect(english).toHaveValue("GK");
    expect(spanish).toHaveValue("POR");
    expect(english).toHaveAttribute("maxLength", "4");
    expect(spanish).toHaveAttribute("maxLength", "4");
    expect(english).toHaveAccessibleDescription(
      "Up to 4 characters. Shown on the team cards.",
    );
    expect(
      within(form).getByText("Up to 4 characters. Shown on the team cards."),
    ).toBeInTheDocument();
  });

  it("sin abreviatura, el campo sugiere la que se usará", async () => {
    await renderSection();

    const form = await openRename("Defender");

    expect(within(form).getByLabelText("Short name in English")).toHaveValue(
      "",
    );
    expect(
      within(form).getByLabelText("Short name in English"),
    ).toHaveAttribute("placeholder", "DEF");
  });

  it("guarda la abreviatura cambiada sin volver a mandar el nombre", async () => {
    await renderSection();

    const form = await openRename("Defender");
    await userEvent.type(
      within(form).getByLabelText("Short name in English"),
      "DF",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    await vi.waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Rename Defender" }),
      ).toBeNull(),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${DEFENDER.id}`,
        body: { shortNames: { en: "DF", es: null } },
      },
    ]);
    expect(within(rowOf("Defender")).getByText("DF")).toBeInTheDocument();
    expect(
      await screen.findByText("Defender: short names updated · saved"),
    ).toBeInTheDocument();
  });

  it("con el nombre y la abreviatura cambiados, manda primero el nombre", async () => {
    await renderSection();

    const form = await openRename("Defender");
    await fillNames(form, { en: "Back", es: "Defensa" });
    await userEvent.type(
      within(form).getByLabelText("Short name in English"),
      "BK",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((request) => request.body)).toEqual([
      { names: { en: "Back", es: "Defensa" } },
      { shortNames: { en: "BK", es: null } },
    ]);
  });

  it("vaciada, queda sin abreviatura y la tabla enseña la que se usará", async () => {
    await renderSection();

    const form = await openRename("Goalkeeper");
    await userEvent.clear(within(form).getByLabelText("Short name in English"));
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    await vi.waitFor(() =>
      expect(within(rowOf("Goalkeeper")).getByText("GOA")).toBeInTheDocument(),
    );
    expect(requests[0]?.body).toEqual({ shortNames: { en: null, es: "POR" } });
  });

  it("no manda una abreviatura en un idioma sin nombre, y lo dice junto al campo", async () => {
    catalog = [{ ...UTILITY, isArchived: false }];
    await renderSection();

    const form = await openRename("Utility");
    await userEvent.type(
      within(form).getByLabelText("Short name in Spanish"),
      "COM",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    expect(
      within(form).getByLabelText("Short name in Spanish"),
    ).toHaveAccessibleDescription(
      expect.stringContaining("Give it a name in this language first."),
    );
    expect(requests).toEqual([]);
  });

  it("enseña junto a su campo la abreviatura que rechaza el servidor", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(400, "validation_error", "short_name_en_too_long");

    const form = await openRename("Defender");
    await userEvent.type(
      within(form).getByLabelText("Short name in English"),
      "DF",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    const english = within(form).getByLabelText("Short name in English");
    await vi.waitFor(() =>
      expect(english).toHaveAttribute("aria-invalid", "true"),
    );
    expect(english).toHaveAccessibleDescription(
      expect.stringContaining("Up to 4 characters."),
    );
  });

  it("en español los campos se llaman Abreviatura", async () => {
    await renderSection("es");

    await userEvent.click(
      screen.getByRole("button", { name: "Renombrar Portería" }),
    );
    const form = screen.getByRole("form", { name: "Renombrar Portería" });

    expect(
      within(form).getByLabelText("Abreviatura en inglés"),
    ).toHaveAccessibleDescription(
      "Hasta 4 caracteres. Sale en las tarjetas de los equipos.",
    );
    expect(within(form).getByLabelText("Abreviatura en español")).toHaveValue(
      "POR",
    );
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

describe("arrastrar por el asa", () => {
  it("soltar en otro puesto manda el orden entero, lo anuncia y deja el foco en el asa", async () => {
    await renderSection();

    dropOn(dndContext, FORWARD.id, GOALKEEPER.id);

    expect(await screen.findByText("Forward moved to 1 of 3")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(requests).toEqual([
      {
        method: "PUT",
        url: ORDER_PATH,
        body: { positionIds: [FORWARD.id, GOALKEEPER.id, DEFENDER.id] },
      },
    ]);
    expect(activeNames()).toEqual(["Forward", "Goalkeeper", "Defender"]);
    // El foco vuelve en el pintado de después de la respuesta, no en el
    // mismo que el anuncio.
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Reorder Forward, position 1 of 3",
        }),
      ).toHaveFocus();
    });
  });

  it("mientras el servidor contesta, la fila ya está donde se soltó", async () => {
    await renderSection();
    nextWriteResponse = neverAnswers;

    dropOn(dndContext, GOALKEEPER.id, FORWARD.id);

    expect(activeNames()).toEqual(["Defender", "Forward", "Goalkeeper"]);
  });

  it("si falla, la lista vuelve al orden anterior y dice el error", async () => {
    await renderSection();
    nextWriteResponse = networkFailure;

    dropOn(dndContext, FORWARD.id, GOALKEEPER.id);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reach the server/i,
    );
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
    await waitFor(() => {
      expect(handleOf("Forward")).toHaveFocus();
    });
  });

  it("si otro Admin cambió las posiciones, vuelve al orden y ofrece cargar las últimas", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(409, "conflict", "club_positions_changed");

    dropOn(dndContext, DEFENDER.id, FORWARD.id);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /another admin changed the positions/i,
    );
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
    expect(
      screen.getByRole("button", { name: "Load the latest positions" }),
    ).toBeInTheDocument();
  });

  it("soltar en el mismo puesto no manda nada", async () => {
    await renderSection();

    dropOn(dndContext, DEFENDER.id, DEFENDER.id);

    expect(requests).toEqual([]);
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
  });

  it("soltar fuera de la lista no manda nada", async () => {
    await renderSection();

    dropOn(dndContext, DEFENDER.id, null);

    expect(requests).toEqual([]);
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
  });

  it("con una acción esperando al servidor no deja arrastrar", async () => {
    await renderSection();
    nextWriteResponse = neverAnswers;
    await userEvent.click(
      screen.getByRole("button", { name: "Archive Defender" }),
    );

    dropOn(dndContext, FORWARD.id, GOALKEEPER.id);

    expect(requests).toHaveLength(1);
    expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
  });

  it("anuncia el inicio, el destino y el final del arrastre", async () => {
    await renderSection();

    const announce = announcementsOf(dndContext);

    expect(announce.start(FORWARD.id)).toBe(
      "Picked up Forward, position 3 of 3.",
    );
    expect(announce.over(FORWARD.id, GOALKEEPER.id)).toBe(
      "Moving Forward over position 1 of 3.",
    );
    expect(announce.over(FORWARD.id, null)).toBe(
      "Moving Forward outside the list.",
    );
    expect(announce.end(FORWARD.id, GOALKEEPER.id)).toBe(
      "Dropped Forward at position 1 of 3.",
    );
    expect(announce.end(FORWARD.id, null)).toBe(
      "Dropped Forward back at position 3 of 3.",
    );
    expect(announce.cancel(FORWARD.id)).toBe(
      "Stopped moving Forward. It stays at position 3 of 3.",
    );
  });

  it("en español anuncia el arrastre en español", async () => {
    await renderSection("es");

    const announce = announcementsOf(dndContext);

    expect(announce.start(FORWARD.id)).toBe(
      "Has cogido Ataque, puesto 3 de 3.",
    );
    expect(announce.over(FORWARD.id, GOALKEEPER.id)).toBe(
      "Llevas Ataque sobre el puesto 1 de 3.",
    );
    expect(announce.over(FORWARD.id, null)).toBe(
      "Llevas Ataque fuera de la lista.",
    );
    expect(announce.end(FORWARD.id, GOALKEEPER.id)).toBe(
      "Has soltado Ataque en el puesto 1 de 3.",
    );
    expect(announce.end(FORWARD.id, FORWARD.id)).toBe(
      "Has soltado Ataque en su puesto, el 3 de 3.",
    );
    expect(announce.cancel(FORWARD.id)).toBe(
      "Movimiento cancelado: Ataque sigue en el puesto 3 de 3.",
    );
  });

  it("el asa sigue siendo un botón propio, sin el modo de teclado de dnd-kit", async () => {
    await renderSection();

    const handle = handleOf("Defender");

    expect(handle).not.toHaveAttribute("aria-roledescription");
    expect(handle).toHaveAccessibleDescription(
      "Drag it, or use the up and down arrow keys to move it.",
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
    expect(minimumOf("Forward")).toBeDisabled();
    expect(requests).toHaveLength(1);
  });
});

/* El móvil (#724, RF-6 del PRD de E26): por debajo de 768 px la tabla no
   cabe. Cada activa es una fila con su asa y, al tocarla, una hoja inferior
   con sus nombres, su rol, Archivar y Guardar. El ancho lo dice
   `matchMedia`, que aquí se simula; cómo se ve lo prueba Playwright. */

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

function minimumStepper(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("group", { name: "Minimum per team" });
}

function stepperValue(dialog: HTMLElement): HTMLElement {
  return within(minimumStepper(dialog)).getByRole("status");
}

async function stepMinimum(
  dialog: HTMLElement,
  direction: "One more" | "One fewer",
): Promise<void> {
  await userEvent.click(
    within(minimumStepper(dialog)).getByRole("button", {
      name: `${direction} per team`,
    }),
  );
}

async function saveSheet(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
}

describe("en el móvil", () => {
  beforeEach(() => {
    stubPhoneScreen();
  });

  describe("la lista", () => {
    it("indica cómo se reordena", async () => {
      await renderSection();

      expect(
        screen.getByText("Hold ⋮⋮ and drag to reorder"),
      ).toBeInTheDocument();
    });

    it("en español indica cómo se reordena", async () => {
      await renderSection("es");

      expect(
        screen.getByText("Mantén ⋮⋮ y arrastra para reordenar"),
      ).toBeInTheDocument();
    });

    it("pinta una fila por activa, en su orden, con su asa", async () => {
      await renderSection();

      expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
      expect(phoneRow("Defender")).toBeInTheDocument();
    });

    it("debajo del nombre dice su abreviatura y su mínimo", async () => {
      await renderSection();

      expect(phoneRow("Goalkeeper")).toHaveAccessibleDescription(
        "GK · 1 per team",
      );
      expect(phoneRow("Defender")).toHaveAccessibleDescription(
        "DEF · 2 per team",
      );
      expect(phoneRow("Forward")).toHaveAccessibleDescription(
        "FOR · No minimum",
      );
    });

    it("dice también el nombre que falta", async () => {
      catalog = [GOALKEEPER, { ...UTILITY, isArchived: false }];

      await renderSection();

      expect(phoneRow("Utility")).toHaveAccessibleDescription(
        "UTI · No minimum · No Spanish name",
      );
    });

    it("no pinta los controles de la tabla de escritorio", async () => {
      await renderSection();

      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Rename / })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Archive / })).toBeNull();
    });

    it("el asa reordena con ↑ como en escritorio", async () => {
      await renderSection();

      handleOf("Forward").focus();
      await userEvent.keyboard("{ArrowUp}");

      await vi.waitFor(() =>
        expect(activeNames()).toEqual(["Goalkeeper", "Forward", "Defender"]),
      );
      expect(requests[0]?.body).toEqual({
        positionIds: [GOALKEEPER.id, FORWARD.id, DEFENDER.id],
      });
      expect(handleOf("Forward")).toHaveFocus();
    });

    it("el asa reordena con ↓ como en escritorio", async () => {
      await renderSection();

      handleOf("Goalkeeper").focus();
      await userEvent.keyboard("{ArrowDown}");

      await vi.waitFor(() =>
        expect(activeNames()).toEqual(["Defender", "Goalkeeper", "Forward"]),
      );
    });
  });

  describe("arrastrar por el asa", () => {
    it("soltar en otro puesto manda el orden entero y deja el foco en el asa", async () => {
      await renderSection();

      dropOn(dndContext, FORWARD.id, GOALKEEPER.id);

      expect(await screen.findByText("Forward moved to 1 of 3")).toBeVisible();
      expect(requests[0]?.body).toEqual({
        positionIds: [FORWARD.id, GOALKEEPER.id, DEFENDER.id],
      });
      await waitFor(() => {
        expect(handleOf("Forward")).toHaveFocus();
      });
    });

    it("mientras el servidor contesta, la fila ya está donde se soltó", async () => {
      await renderSection();
      nextWriteResponse = neverAnswers;

      dropOn(dndContext, GOALKEEPER.id, FORWARD.id);

      expect(activeNames()).toEqual(["Defender", "Forward", "Goalkeeper"]);
    });
  });

  describe("debajo de la lista", () => {
    it("el campo Nueva posición añade con un solo nombre en el idioma de la pantalla", async () => {
      await renderSection();

      const form = createForm();
      const field = within(form).getByRole("textbox");
      expect(field).toHaveAttribute("placeholder", "New position");
      await userEvent.type(field, "Centre");
      await userEvent.click(within(form).getByRole("button", { name: "Add" }));

      await vi.waitFor(() => expect(activeNames()).toContain("Centre"));
      expect(requests).toEqual([
        {
          method: "POST",
          url: POSITIONS_PATH,
          body: { names: { en: "Centre", es: null } },
        },
      ]);
    });

    it("en español el nombre nuevo es el español", async () => {
      await renderSection("es");

      const form = screen.getByRole("form", { name: "Añadir una posición" });
      await userEvent.type(within(form).getByRole("textbox"), "Centro");
      await userEvent.click(
        within(form).getByRole("button", { name: "Añadir" }),
      );

      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]?.body).toEqual({ names: { en: null, es: "Centro" } });
    });

    it("las archivadas van plegadas y se reactivan", async () => {
      await renderSection();

      const list = await openArchived();
      await userEvent.click(
        within(list).getByRole("button", { name: "Reactivate Utility" }),
      );

      await vi.waitFor(() => expect(activeNames()).toContain("Utility"));
    });
  });

  describe("la hoja de una posición", () => {
    it("tocar la fila abre la hoja con sus nombres, sus abreviaturas y su mínimo", async () => {
      await renderSection();

      const dialog = await openSheet("Defender");

      expect(
        within(dialog).getByRole("heading", { name: "Defender" }),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText("English")).toHaveValue("Defender");
      expect(within(dialog).getByLabelText("Español")).toHaveValue("Defensa");
      expect(
        within(dialog).getByLabelText("Short name in English"),
      ).toHaveAttribute("placeholder", "DEF");
      expect(
        within(dialog).getByLabelText("Short name in Spanish"),
      ).toHaveAttribute("maxLength", "4");
      expect(stepperValue(dialog)).toHaveTextContent("2");
      expect(minimumStepper(dialog)).toHaveAccessibleDescription(
        "How many of this position auto-balance tries to put in every team. 0 means it doesn't matter.",
      );
      expect(within(dialog).queryByRole("radio")).toBeNull();
      expect(
        within(dialog).getByRole("button", { name: "Archive" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Save" }),
      ).toBeInTheDocument();
    });

    it("los botones del paso a paso no bajan de 0", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");

      expect(stepperValue(dialog)).toHaveTextContent("0");
      expect(
        within(minimumStepper(dialog)).getByRole("button", {
          name: "One fewer per team",
        }),
      ).toBeDisabled();
    });

    it("los botones del paso a paso no pasan de 20", async () => {
      catalog = [{ ...FORWARD, minPerTeam: 19 }];
      await renderSection();

      const dialog = await openSheet("Forward");
      await stepMinimum(dialog, "One more");

      expect(stepperValue(dialog)).toHaveTextContent("20");
      expect(
        within(minimumStepper(dialog)).getByRole("button", {
          name: "One more per team",
        }),
      ).toBeDisabled();
    });

    it("en español los campos son Inglés y Español, con su abreviatura", async () => {
      await renderSection("es");

      await userEvent.click(
        within(
          screen.getByRole("list", { name: "Posiciones activas" }),
        ).getByRole("button", { name: "Ataque" }),
      );
      const dialog = sheet("Ataque");

      expect(within(dialog).getByLabelText("Inglés")).toHaveValue("Forward");
      expect(within(dialog).getByLabelText("Español")).toHaveValue("Ataque");
      expect(
        within(dialog).getByLabelText("Abreviatura en español"),
      ).toHaveAttribute("placeholder", "ATA");
      expect(
        within(dialog).getByRole("group", { name: "Mínimo por equipo" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Uno más por equipo" }),
      ).toBeInTheDocument();
    });

    it("tocar el asa no abre la hoja", async () => {
      await renderSection();

      await userEvent.click(handleOf("Forward"));

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("guarda el nombre cambiado, cierra y devuelve el foco a la fila", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await userEvent.clear(within(dialog).getByLabelText("English"));
      await userEvent.type(within(dialog).getByLabelText("English"), "Striker");
      await saveSheet(dialog);

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests).toEqual([
        {
          method: "PATCH",
          url: `${POSITIONS_PATH}/${FORWARD.id}`,
          body: { names: { en: "Striker", es: "Ataque" } },
        },
      ]);
      expect(phoneRow("Striker")).toHaveFocus();
      expect(screen.getByText("✓ Saved")).toBeInTheDocument();
    });

    it("en español el aviso dice guardado", async () => {
      await renderSection("es");

      await userEvent.click(
        within(
          screen.getByRole("list", { name: "Posiciones activas" }),
        ).getByRole("button", { name: "Ataque" }),
      );
      const dialog = sheet("Ataque");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Uno más por equipo" }),
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Guardar" }),
      );

      expect(await screen.findByText("✓ Guardado")).toBeInTheDocument();
    });

    it("guarda el mínimo cambiado", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await stepMinimum(dialog, "One more");
      await stepMinimum(dialog, "One more");
      await saveSheet(dialog);

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests).toEqual([
        {
          method: "PATCH",
          url: `${POSITIONS_PATH}/${FORWARD.id}`,
          body: { minPerTeam: 2 },
        },
      ]);
      expect(phoneRow("Forward")).toHaveAccessibleDescription(
        "FOR · 2 per team",
      );
      expect(phoneRow("Forward")).toHaveFocus();
    });

    it("baja el mínimo a 0", async () => {
      await renderSection();

      const dialog = await openSheet("Goalkeeper");
      await stepMinimum(dialog, "One fewer");
      await saveSheet(dialog);

      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]?.body).toEqual({ minPerTeam: 0 });
    });

    it("guarda la abreviatura cambiada", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await userEvent.type(
        within(dialog).getByLabelText("Short name in English"),
        "ATT",
      );
      await saveSheet(dialog);

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests.map((request) => request.body)).toEqual([
        { shortNames: { en: "ATT", es: null } },
      ]);
      expect(phoneRow("Forward")).toHaveAccessibleDescription(
        "ATT · No minimum",
      );
    });

    it("guarda el nombre, la abreviatura y el mínimo, en ese orden", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await userEvent.type(within(dialog).getByLabelText("English"), "s");
      await userEvent.type(
        within(dialog).getByLabelText("Short name in English"),
        "FW",
      );
      await stepMinimum(dialog, "One more");
      await saveSheet(dialog);

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests.map((request) => request.body)).toEqual([
        { names: { en: "Forwards", es: "Ataque" } },
        { shortNames: { en: "FW", es: null } },
        { minPerTeam: 1 },
      ]);
      expect(phoneRow("Forwards")).toHaveAccessibleDescription(
        "FW · 1 per team",
      );
    });

    it("sin cambios, Guardar cierra la hoja sin mandar nada", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await saveSheet(dialog);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
      expect(phoneRow("Forward")).toHaveFocus();
    });

    it("con un nombre inválido enseña el aviso en la hoja y no la cierra", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await userEvent.clear(within(dialog).getByLabelText("English"));
      await userEvent.clear(within(dialog).getByLabelText("Español"));
      await saveSheet(dialog);

      expect(
        within(dialog).getByLabelText("English"),
      ).toHaveAccessibleDescription(
        expect.stringContaining("at least one language"),
      );
      expect(sheet("Forward")).toBe(dialog);
      expect(requests).toEqual([]);
    });

    it("enseña en la hoja el nombre repetido que rechaza el servidor", async () => {
      await renderSection();
      nextWriteResponse = () =>
        errorResponse(400, "validation_error", "name_en_taken");

      const dialog = await openSheet("Forward");
      await userEvent.clear(within(dialog).getByLabelText("English"));
      await userEvent.type(
        within(dialog).getByLabelText("English"),
        "Defender",
      );
      await saveSheet(dialog);

      await vi.waitFor(() =>
        expect(
          within(dialog).getByLabelText("English"),
        ).toHaveAccessibleDescription(
          expect.stringContaining("Another position already has this name"),
        ),
      );
      expect(sheet("Forward")).toBe(dialog);
    });

    it("Archivar archiva, cierra la hoja y la pasa a las archivadas", async () => {
      await renderSection();

      const dialog = await openSheet("Defender");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Archive" }),
      );

      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests).toEqual([
        {
          method: "PATCH",
          url: `${POSITIONS_PATH}/${DEFENDER.id}`,
          body: { isArchived: true },
        },
      ]);
      expect(activeNames()).toEqual(["Goalkeeper", "Forward"]);
      expect(archivedNames(await openArchived())).toEqual([
        "Defender",
        "Utility",
      ]);
    });

    it("Escape la cierra sin cambiar nada y devuelve el foco a la fila", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await userEvent.type(within(dialog).getByLabelText("English"), "s");
      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
      expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
      expect(phoneRow("Forward")).toHaveFocus();
    });

    it("un toque fuera la cierra sin cambiar nada y devuelve el foco a la fila", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      await stepMinimum(dialog, "One more");
      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
      expect(phoneRow("Forward")).toHaveFocus();
    });

    it("arrastrarla hacia abajo la cierra sin cambiar nada", async () => {
      await renderSection();

      const dialog = await openSheet("Forward");
      const grip = within(dialog).getByRole("button", {
        name: "Close the sheet",
      });
      fireEvent.pointerDown(grip, { clientX: 180, clientY: 400, pointerId: 1 });
      fireEvent.pointerMove(grip, { clientX: 182, clientY: 520, pointerId: 1 });
      fireEvent.pointerUp(grip, { clientX: 182, clientY: 520, pointerId: 1 });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests).toEqual([]);
      expect(phoneRow("Forward")).toHaveFocus();
    });

    it("al reabrirla tras cerrarla sin guardar, empieza por lo guardado", async () => {
      await renderSection();

      const first = await openSheet("Forward");
      await userEvent.type(within(first).getByLabelText("English"), "s");
      await userEvent.keyboard("{Escape}");
      const dialog = await openSheet("Forward");

      expect(within(dialog).getByLabelText("English")).toHaveValue("Forward");
    });

    it("un fallo de red al guardar sale en la hoja y la deja abierta", async () => {
      await renderSection();
      nextWriteResponse = networkFailure;

      const dialog = await openSheet("Forward");
      await stepMinimum(dialog, "One more");
      await saveSheet(dialog);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /couldn't reach the server/i,
      );
      expect(sheet("Forward")).toBe(dialog);
      expect(stepperValue(dialog)).toHaveTextContent("1");
    });

    it("un fallo de red al archivar sale en la hoja y la deja abierta", async () => {
      await renderSection();
      nextWriteResponse = networkFailure;

      const dialog = await openSheet("Forward");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Archive" }),
      );

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /couldn't reach the server/i,
      );
      expect(sheet("Forward")).toBe(dialog);
      expect(activeNames()).toEqual(["Goalkeeper", "Defender", "Forward"]);
    });

    it("si otro Admin cambió las posiciones, ofrece cargar las últimas", async () => {
      await renderSection();
      nextWriteResponse = () =>
        errorResponse(409, "conflict", "club_positions_changed");

      const dialog = await openSheet("Forward");
      await stepMinimum(dialog, "One more");
      await saveSheet(dialog);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /another admin changed the positions/i,
      );
      catalog = [FORWARD, GOALKEEPER, DEFENDER, UTILITY];
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: "Load the latest positions",
        }),
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      await vi.waitFor(() =>
        expect(activeNames()).toEqual(["Forward", "Goalkeeper", "Defender"]),
      );
    });

    it("con el guardado esperando al servidor, sus botones esperan", async () => {
      await renderSection();
      nextWriteResponse = neverAnswers;

      const dialog = await openSheet("Forward");
      await stepMinimum(dialog, "One more");
      await saveSheet(dialog);

      expect(
        within(dialog).getByRole("button", { name: "Save" }),
      ).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: "Archive" }),
      ).toBeDisabled();
      expect(
        within(minimumStepper(dialog)).getByRole("button", {
          name: "One fewer per team",
        }),
      ).toBeDisabled();
    });
  });
});
