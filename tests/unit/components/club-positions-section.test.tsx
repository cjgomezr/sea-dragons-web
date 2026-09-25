import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubPositionsSection } from "@/components/club/ClubPositionsSection";
import type { ClubPosition } from "@/lib/club/club-positions";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección de posiciones de la configuración del club (#300, RF-7 del PRD
 * de E18a): el Admin ve las activas en su orden y las archivadas aparte, y
 * crea, renombra, reordena (también con el teclado), archiva y reactiva. El
 * servidor es un doble que guarda el catálogo en memoria.
 */

const POSITIONS_PATH = "/api/v1/club/settings/positions";
const ORDER_PATH = `${POSITIONS_PATH}/order`;

const GOALKEEPER: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
};
const DEFENDER: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000002",
  names: { en: "Defender", es: "Defensa" },
  isArchived: false,
};
const FORWARD: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000003",
  names: { en: "Forward", es: "Ataque" },
  isArchived: false,
};
const UTILITY: ClubPosition = {
  id: "00000000-0000-4000-8000-000000000004",
  names: { en: "Utility", es: null },
  isArchived: true,
};
const NEW_POSITION_ID = "00000000-0000-4000-8000-000000000005";

type Request = { readonly method: string; readonly url: string; body: unknown };

let catalog: ClubPosition[];
let requests: Request[];
/** La respuesta de la próxima petición que no sea la carga, si no es la del
 * doble. */
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
        names: body.names as ClubPosition["names"],
        isArchived: false,
      },
    ];
    return catalogResponse(201);
  }
  const positionId = request.url.split("/").at(-1);
  catalog = catalog.map((position) => {
    if (position.id !== positionId) {
      return position;
    }
    return "names" in body
      ? { ...position, names: body.names as ClubPosition["names"] }
      : { ...position, isArchived: body.isArchived as boolean };
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

async function renderSection(locale: Locale = "en"): Promise<void> {
  render(
    <ClubPositionsSection
      locale={locale}
      translate={createTranslator(locale)}
    />,
  );
  await screen.findByRole("list", {
    name: locale === "en" ? "Active positions" : "Posiciones activas",
  });
}

function activeList(): HTMLElement {
  return screen.getByRole("list", { name: "Active positions" });
}

function archivedList(): HTMLElement {
  return screen.getByRole("list", { name: "Archived positions" });
}

function namesIn(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("heading").textContent ?? "");
}

function createForm(): HTMLElement {
  return screen.getByRole("form", { name: "Add a position" });
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

describe("pantalla de posiciones", () => {
  it("lista las activas en su orden y las archivadas aparte", async () => {
    await renderSection();

    expect(namesIn(activeList())).toEqual([
      "Goalkeeper",
      "Defender",
      "Forward",
    ]);
    expect(namesIn(archivedList())).toEqual(["Utility"]);
  });

  it("enseña los nombres en el idioma de la pantalla", async () => {
    await renderSection("es");

    expect(
      namesIn(screen.getByRole("list", { name: "Posiciones activas" })),
    ).toEqual(["Portería", "Defensa", "Ataque"]);
    // Sin nombre en español, cae al inglés.
    expect(
      namesIn(screen.getByRole("list", { name: "Posiciones archivadas" })),
    ).toEqual(["Utility"]);
  });

  it("avisa cuando a una posición le falta el nombre en un idioma", async () => {
    await renderSection();

    expect(
      within(archivedList()).getByText(/no name in spanish yet/i),
    ).toBeInTheDocument();
  });

  it("crea una posición con sus dos nombres y vacía el formulario", async () => {
    await renderSection();

    await fillNames(createForm(), { en: "Centre", es: "Centro" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add position" }),
    );

    expect(await within(activeList()).findByText("Centre")).toBeInTheDocument();
    expect(requests).toEqual([
      {
        method: "POST",
        url: POSITIONS_PATH,
        body: { names: { en: "Centre", es: "Centro" } },
      },
    ]);
    expect(within(createForm()).getByLabelText("Name in English")).toHaveValue(
      "",
    );
  });

  it("crea una posición con el nombre en un solo idioma", async () => {
    await renderSection();

    await fillNames(createForm(), { en: "", es: "Centro" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add position" }),
    );

    expect(await within(activeList()).findByText("Centro")).toBeInTheDocument();
    expect(requests[0]?.body).toEqual({ names: { en: null, es: "Centro" } });
  });

  it("no manda nada sin ningún nombre, y lo dice junto al campo", async () => {
    await renderSection();

    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add position" }),
    );

    const english = within(createForm()).getByLabelText("Name in English");
    expect(english).toHaveAttribute("aria-invalid", "true");
    expect(english).toHaveAccessibleDescription(
      expect.stringContaining("at least one language"),
    );
    expect(requests).toEqual([]);
  });

  it("enseña el nombre repetido junto al campo de su idioma", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(400, "validation_error", "name_es_taken");

    await fillNames(createForm(), { en: "Centre", es: "Defensa" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add position" }),
    );

    const spanish = within(createForm()).getByLabelText("Name in Spanish");
    await vi.waitFor(() =>
      expect(spanish).toHaveAttribute("aria-invalid", "true"),
    );
    expect(spanish).toHaveAccessibleDescription(
      expect.stringContaining("Another position already has this name"),
    );
    expect(
      within(createForm()).getByLabelText("Name in English"),
    ).toHaveAttribute("aria-invalid", "false");
  });

  it("renombra una posición", async () => {
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename Defender" }),
    );
    const form = screen.getByRole("form", { name: "Rename Defender" });
    expect(within(form).getByLabelText("Name in English")).toHaveValue(
      "Defender",
    );
    await fillNames(form, { en: "Back", es: "Defensa" });
    await userEvent.click(
      within(form).getByRole("button", { name: "Save name" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual(["Goalkeeper", "Back", "Forward"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${DEFENDER.id}`,
        body: { names: { en: "Back", es: "Defensa" } },
      },
    ]);
    expect(screen.queryByRole("form", { name: "Rename Defender" })).toBeNull();
  });

  it("reordena con el teclado y deja el foco en la posición que se movió", async () => {
    await renderSection();

    screen.getByRole("button", { name: "Move Forward up" }).focus();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual([
        "Goalkeeper",
        "Forward",
        "Defender",
      ]),
    );
    expect(requests).toEqual([
      {
        method: "PUT",
        url: ORDER_PATH,
        body: { positionIds: [GOALKEEPER.id, FORWARD.id, DEFENDER.id] },
      },
    ]);
    expect(
      screen.getByRole("button", { name: "Move Forward up" }),
    ).toHaveFocus();
    expect(screen.getByText("Forward is now number 2 of 3.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("no deja subir la primera ni bajar la última", async () => {
    await renderSection();

    expect(
      screen.getByRole("button", { name: "Move Goalkeeper up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Forward down" }),
    ).toBeDisabled();
  });

  it("archiva una posición y la pasa a las archivadas", async () => {
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Archive Defender" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(archivedList())).toEqual(["Defender", "Utility"]),
    );
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: `${POSITIONS_PATH}/${DEFENDER.id}`,
        body: { isArchived: true },
      },
    ]);
  });

  it("reactiva una posición archivada", async () => {
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Reactivate Utility" }),
    );

    await vi.waitFor(() => expect(namesIn(activeList())).toContain("Utility"));
    expect(requests[0]?.body).toEqual({ isArchived: false });
  });

  it("dice que no hay archivadas cuando no hay ninguna", async () => {
    catalog = [GOALKEEPER, DEFENDER, FORWARD];

    await renderSection();

    expect(screen.getByText("No archived positions.")).toBeInTheDocument();
  });

  it("tras un fallo de red al crear lo dice y deja reintentar con lo escrito", async () => {
    await renderSection();
    nextWriteResponse = networkFailure;

    await fillNames(createForm(), { en: "Centre", es: "Centro" });
    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add position" }),
    );

    expect(
      await within(createForm()).findByText(/couldn't reach the server/i),
    ).toBeInTheDocument();
    expect(within(createForm()).getByLabelText("Name in English")).toHaveValue(
      "Centre",
    );

    await userEvent.click(
      within(createForm()).getByRole("button", { name: "Add position" }),
    );

    expect(await within(activeList()).findByText("Centre")).toBeInTheDocument();
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
      expect(namesIn(archivedList())).toEqual(["Defender", "Utility"]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si otro Admin cambió las posiciones, ofrece cargar las últimas", async () => {
    await renderSection();
    nextWriteResponse = () =>
      errorResponse(409, "conflict", "club_positions_changed");

    await userEvent.click(
      screen.getByRole("button", { name: "Move Defender down" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /another admin changed the positions/i,
    );
    catalog = [FORWARD, GOALKEEPER, DEFENDER, UTILITY];
    await userEvent.click(
      screen.getByRole("button", { name: "Load the latest positions" }),
    );

    await vi.waitFor(() =>
      expect(namesIn(activeList())).toEqual([
        "Forward",
        "Goalkeeper",
        "Defender",
      ]),
    );
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

describe("el foco en la pantalla de posiciones", () => {
  it("al subir una posición hasta arriba pasa al botón de bajarla", async () => {
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Defender up" }),
    );

    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move Defender down" }),
      ).toHaveFocus(),
    );
  });

  it("al cerrar el renombrado vuelve al botón que lo abrió", async () => {
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename Defender" }),
    );
    expect(
      within(
        screen.getByRole("form", { name: "Rename Defender" }),
      ).getByLabelText("Name in English"),
    ).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Rename Defender" }),
    ).toHaveFocus();
  });
});
