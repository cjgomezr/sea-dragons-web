import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSessionPacksSection } from "@/components/club/ClubSessionPacksSection";
import { CLUB_SESSION_PACKS_API_PATH } from "@/lib/auth/routes";
import type { ClubPrice } from "@/lib/membership/stripe-prices";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección "Packs de sesiones" de `/club` (#469, RF-4 del PRD de E13; la
 * tabla de #722, RF-7 del PRD de E26). El Admin o el Committee ve los packs
 * con su precio, añade, quita y ordena en un borrador con el asa y las
 * flechas, y lo guarda entero con la barra de cambios sin guardar (#719).
 */

/** No es el precio del club: el de este test, para que nada pase por
 * casualidad con el de verdad. */
const SESSION_PRICE: ClubPrice = { amountCents: 1990, currency: "AUD" };

type Stub = {
  readonly sessionPrice?: ClubPrice;
  readonly load?: () => Response;
  readonly save?: (sessions: readonly number[]) => Response;
};

const savedLists: (readonly number[])[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function catalog(
  sizes: readonly number[],
  sessionPrice: ClubPrice = SESSION_PRICE,
): Response {
  return jsonResponse(200, {
    data: {
      packs: sizes.map((sessions) => ({
        sessions,
        price:
          sessionPrice.amountCents === null
            ? sessionPrice
            : {
                amountCents: sessionPrice.amountCents * sessions,
                currency: "AUD",
              },
      })),
      sessionPrice,
    },
  });
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== CLUB_SESSION_PACKS_API_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (init?.method === "PUT") {
        const { sessions } = JSON.parse(String(init.body)) as {
          sessions: number[];
        };
        savedLists.push(sessions);
        return stub.save?.(sessions) ?? catalog(sessions, stub.sessionPrice);
      }
      return stub.load?.() ?? catalog([5, 10], stub.sessionPrice);
    }),
  );
}

function renderPacks(locale: "en" | "es" = "en"): void {
  render(
    <ClubSessionPacksSection
      translate={createTranslator(locale)}
      onHasDraftChange={() => undefined}
    />,
  );
}

const ADD_FIELD = "Sessions in the new pack";
const PACK_LABEL = /^\d+ (sessions?|sesi(ón|ones))$/;

async function renderSection(locale: "en" | "es" = "en"): Promise<void> {
  renderPacks(locale);
  await screen.findByLabelText(
    locale === "en" ? ADD_FIELD : "Sesiones del pack nuevo",
  );
}

function packList(): HTMLElement {
  return screen.getByRole("list", { name: /session packs|packs de sesiones/i });
}

function packRows(): HTMLElement[] {
  return within(packList()).getAllByRole("listitem");
}

function listedPacks(): string[] {
  return packRows().map(
    (row) => within(row).getByText(PACK_LABEL).textContent ?? "",
  );
}

function handle(sessions: number, rank: number, total: number): HTMLElement {
  return screen.getByRole("button", {
    name: `Reorder the ${sessions} sessions pack, position ${rank} of ${total}`,
  });
}

function removeButton(sessions: number): HTMLElement {
  return screen.getByRole("button", {
    name: `Remove the ${sessions} sessions pack`,
  });
}

function addField(): HTMLElement {
  return screen.getByLabelText(ADD_FIELD);
}

async function typeNewPack(sessions: string): Promise<void> {
  await userEvent.clear(addField());
  if (sessions !== "") {
    await userEvent.type(addField(), sessions);
  }
}

async function addPack(sessions: string): Promise<void> {
  await typeNewPack(sessions);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
}

/** Guardar cambios, en la barra que sale con un cambio (#719). */
function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save changes" });
}

async function save(): Promise<void> {
  await userEvent.click(saveButton());
}

beforeEach(() => {
  savedLists.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la tabla de packs", () => {
  it("enseña cada pack en orden con el precio del pack entero", async () => {
    stubApi();

    await renderSection();

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
    const [five, ten] = packRows();
    expect(five).toHaveTextContent("$99.50");
    expect(ten).toHaveTextContent("$199.00");
  });

  it("la entrada dice el precio de una sesión Casual en Stripe", async () => {
    stubApi();

    await renderSection();

    expect(
      screen.getByText(
        "Bundles Casual members can buy. Each pack costs the Casual session price × sessions (now $19.90 per session in Stripe).",
      ),
    ).toBeInTheDocument();
  });

  it("cada fila tiene el asa con el puesto del pack y el botón de borrar", async () => {
    stubApi();

    await renderSection();

    const [five, ten] = packRows();
    expect(five).toContainElement(handle(5, 1, 2));
    expect(five).toContainElement(removeButton(5));
    expect(ten).toContainElement(handle(10, 2, 2));
  });

  it("el pie dice los límites y que los socios ven este orden", async () => {
    stubApi();

    await renderSection();

    expect(
      screen.getByText(
        "From 1 to 50 sessions, no repeats. Members see them in this order.",
      ),
    ).toBeInTheDocument();
  });

  it("sin packs dice que los Casual solo pueden pagar por sesión", async () => {
    stubApi({ load: () => catalog([]) });

    await renderSection();

    expect(
      screen.getByText("No packs. Casual members can only pay per session."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("dice que el precio no está disponible si Stripe no lo da, y deja editar", async () => {
    stubApi({
      sessionPrice: { amountCents: null, reason: "stripe_unavailable" },
    });
    await renderSection();

    await typeNewPack("3");

    expect(within(packList()).getAllByText("Price not available")).toHaveLength(
      2,
    );
    expect(addField()).toHaveAccessibleDescription(/Price not available/);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(listedPacks()).toEqual(["5 sessions", "10 sessions", "3 sessions"]);
  });

  it("si no puede cargarlos lo dice con un alert", async () => {
    stubApi({
      load: () =>
        jsonResponse(500, { error: { code: "internal_error", message: "x" } }),
    });

    renderPacks();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});

describe("la fila de añadir", () => {
  it("enseña en vivo el precio del pack que se escribe", async () => {
    stubApi();
    await renderSection();

    await typeNewPack("3");

    expect(addField()).toHaveAccessibleDescription(/\$59\.70/);
  });

  it("añade un pack al final del borrador con su precio", async () => {
    stubApi();
    await renderSection();

    await addPack("3");

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions", "3 sessions"]);
    expect(packRows()[2]).toHaveTextContent("$59.70");
    expect(addField()).toHaveValue(null);
    expect(savedLists).toEqual([]);
  });

  it("habla de una sesión en singular", async () => {
    stubApi();
    await renderSection();

    await addPack("1");

    expect(listedPacks()).toContain("1 session");
  });

  it.each(["0", "51", "2.5", ""])(
    "no añade un pack de «%s» y dice el límite",
    async (sessions) => {
      stubApi();
      await renderSection();

      await addPack(sessions);

      expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
      expect(addField()).toHaveAccessibleDescription(
        expect.stringContaining("Between 1 and 50."),
      );
      expect(addField()).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("no añade un tamaño que ya está", async () => {
    stubApi();
    await renderSection();

    await addPack("10");

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
    expect(addField()).toHaveAccessibleDescription(
      expect.stringContaining("Already in the list."),
    );
  });
});

describe("borrar", () => {
  it("saca el pack del borrador y lleva el foco a la fila siguiente", async () => {
    stubApi({ load: () => catalog([5, 10, 20]) });
    await renderSection();

    await userEvent.click(removeButton(10));

    expect(listedPacks()).toEqual(["5 sessions", "20 sessions"]);
    expect(removeButton(20)).toHaveFocus();
    expect(savedLists).toEqual([]);
  });

  it("al borrar el último lleva el foco a la fila de añadir", async () => {
    stubApi();
    await renderSection();

    await userEvent.click(removeButton(10));

    expect(addField()).toHaveFocus();
  });
});

describe("mover con el teclado", () => {
  it("↑ sobre el asa sube el pack, lo anuncia y deja el foco en el asa", async () => {
    stubApi({ load: () => catalog([5, 10, 20]) });
    await renderSection();
    handle(20, 3, 3).focus();

    await userEvent.keyboard("{ArrowUp}");

    expect(listedPacks()).toEqual(["5 sessions", "20 sessions", "10 sessions"]);
    expect(handle(20, 2, 3)).toHaveFocus();
    expect(
      screen.getByText("20 sessions is now number 2 of 3."),
    ).toHaveAttribute("role", "status");

    await userEvent.keyboard("{ArrowUp}");

    expect(listedPacks()).toEqual(["20 sessions", "5 sessions", "10 sessions"]);
    expect(handle(20, 1, 3)).toHaveFocus();
  });

  it("↓ sobre el asa baja el pack y deja el foco en el asa", async () => {
    stubApi();
    await renderSection();
    handle(5, 1, 2).focus();

    await userEvent.keyboard("{ArrowDown}");

    expect(listedPacks()).toEqual(["10 sessions", "5 sessions"]);
    expect(handle(5, 2, 2)).toHaveFocus();
    expect(saveButton()).toBeEnabled();
  });

  it("en un extremo no mueve nada ni saca la barra", async () => {
    stubApi();
    await renderSection();
    handle(5, 1, 2).focus();

    await userEvent.keyboard("{ArrowUp}");

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});

describe("guardar", () => {
  it("manda la lista en su orden y enseña lo que quedó guardado", async () => {
    stubApi();
    await renderSection();
    await addPack("20");
    handle(20, 3, 3).focus();
    await userEvent.keyboard("{ArrowUp}");

    await save();

    expect(savedLists).toEqual([[5, 20, 10]]);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(listedPacks()).toEqual(["5 sessions", "20 sessions", "10 sessions"]);
  });

  it("no deja guardar una lista vacía y pide dejar al menos uno", async () => {
    stubApi();
    await renderSection();
    await userEvent.click(removeButton(5));

    await userEvent.click(removeButton(10));

    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Keep at least one pack.",
    );
  });

  it("enseña el motivo de un 400 del servidor", async () => {
    stubApi({
      save: () =>
        jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "x",
            reason: "pack_sessions_repeated",
          },
        }),
    });
    await renderSection();
    await addPack("7");

    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "There is already a pack with that many sessions.",
    );
  });

  it("dice que no tiene permiso con un 403 y conserva el borrador", async () => {
    stubApi({
      save: () =>
        jsonResponse(403, { error: { code: "forbidden", message: "x" } }),
    });
    await renderSection();
    await addPack("7");

    await save();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(listedPacks()).toEqual(["5 sessions", "10 sessions", "7 sessions"]);
  });
});

describe("idiomas", () => {
  it("en español habla de packs de sesiones", async () => {
    stubApi();

    await renderSection("es");

    expect(
      screen.getByRole("heading", { name: "Packs de sesiones" }),
    ).toBeInTheDocument();
    expect(listedPacks()).toEqual(["5 sesiones", "10 sesiones"]);
    expect(
      screen.getByText(
        /^Paquetes que pueden comprar los miembros Casual\. Cada pack cuesta el precio de la sesión Casual × sesiones \(ahora 19,90\sAUD por sesión en Stripe\)\.$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reordenar el pack de 10 sesiones, puesto 2 de 2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "De 1 a 50 sesiones, sin repetir. Los miembros los ven en este orden.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Quitar el pack de 5 sesiones" }),
    );
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeInTheDocument();
  });

  it("en español dice el límite y el repetido de la fila de añadir", async () => {
    stubApi();
    await renderSection("es");
    const field = screen.getByLabelText("Sesiones del pack nuevo");

    await userEvent.type(field, "60");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining("Entre 1 y 50."),
    );

    await userEvent.clear(field);
    await userEvent.type(field, "5");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining("Ya está en la lista."),
    );
  });

  it("sin packs, en español", async () => {
    stubApi({ load: () => catalog([]) });

    await renderSection("es");

    expect(
      screen.getByText(
        "Sin packs. Los miembros Casual solo pueden pagar por sesión.",
      ),
    ).toBeInTheDocument();
  });
});
