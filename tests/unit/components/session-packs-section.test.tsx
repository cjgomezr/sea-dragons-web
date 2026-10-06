import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSessionPacksSection } from "@/components/club/ClubSessionPacksSection";
import { CLUB_SESSION_PACKS_API_PATH } from "@/lib/auth/routes";
import type { ClubPrice } from "@/lib/membership/stripe-prices";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La sección "Packs de sesiones" de `/club` (#469, RF-4 del PRD de E13). El
 * Admin o el Committee ve los packs con su precio, añade, quita y ordena en
 * un borrador, y lo guarda entero con un botón.
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

async function renderSection(locale: "en" | "es" = "en"): Promise<void> {
  render(<ClubSessionPacksSection translate={createTranslator(locale)} />);
  await screen.findByRole("list", { name: /session packs|packs de sesiones/i });
}

function packList(): HTMLElement {
  return screen.getByRole("list", { name: /session packs|packs de sesiones/i });
}

function listedPacks(): string[] {
  return within(packList())
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("heading").textContent ?? "");
}

async function addPack(sessions: string): Promise<void> {
  const field = screen.getByLabelText("Sessions in the new pack");
  await userEvent.clear(field);
  if (sessions !== "") {
    await userEvent.type(field, sessions);
  }
  await userEvent.click(screen.getByRole("button", { name: "Add pack" }));
}

async function save(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Save packs" }));
}

beforeEach(() => {
  savedLists.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la lista de packs", () => {
  it("enseña cada pack en orden con el precio del pack entero", async () => {
    stubApi();

    await renderSection();

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
    const [five, ten] = within(packList()).getAllByRole("listitem");
    expect(five).toHaveTextContent("$99.50");
    expect(ten).toHaveTextContent("$199.00");
  });

  it("dice que el precio no está disponible si Stripe no lo da", async () => {
    stubApi({
      sessionPrice: { amountCents: null, reason: "stripe_unavailable" },
    });

    await renderSection();

    expect(within(packList()).getAllByText("Price not available")).toHaveLength(
      2,
    );
  });

  it("si no puede cargarlos lo dice con un alert", async () => {
    stubApi({
      load: () =>
        jsonResponse(500, { error: { code: "internal_error", message: "x" } }),
    });

    render(<ClubSessionPacksSection translate={createTranslator("en")} />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save packs" })).toBeNull();
  });
});

describe("editar la lista", () => {
  it("añade un pack al final con su precio", async () => {
    stubApi();
    await renderSection();

    await addPack("3");

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions", "3 sessions"]);
    expect(within(packList()).getAllByRole("listitem")[2]).toHaveTextContent(
      "$59.70",
    );
  });

  it("habla de una sesión en singular", async () => {
    stubApi();
    await renderSection();

    await addPack("1");

    expect(listedPacks()).toContain("1 session");
  });

  it.each(["0", "51", ""])(
    "no añade un pack de «%s» y explica el límite",
    async (sessions) => {
      stubApi();
      await renderSection();

      await addPack(sessions);

      expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
      expect(
        screen.getByText("A pack has from 1 to 50 sessions."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Sessions in the new pack")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    },
  );

  it("no añade un tamaño que ya está", async () => {
    stubApi();
    await renderSection();

    await addPack("10");

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
    expect(
      screen.getByText("There is already a pack with that many sessions."),
    ).toBeInTheDocument();
  });

  it("quita un pack", async () => {
    stubApi();
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove the 5 sessions pack" }),
    );

    expect(listedPacks()).toEqual(["10 sessions"]);
  });

  it("sube y baja un pack, sin mover el primero hacia arriba ni el último hacia abajo", async () => {
    stubApi();
    await renderSection();

    expect(
      screen.getByRole("button", { name: "Move the 5 sessions pack up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move the 10 sessions pack down" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Move the 10 sessions pack up" }),
    );

    expect(listedPacks()).toEqual(["10 sessions", "5 sessions"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "10 sessions is now number 1 of 2.",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Move the 10 sessions pack down" }),
    );

    expect(listedPacks()).toEqual(["5 sessions", "10 sessions"]);
  });
});

describe("guardar", () => {
  it("manda la lista en su orden y enseña lo que quedó guardado", async () => {
    stubApi();
    await renderSection();
    await addPack("20");
    await userEvent.click(
      screen.getByRole("button", { name: "Move the 20 sessions pack up" }),
    );

    await save();

    expect(savedLists).toEqual([[5, 20, 10]]);
    expect(await screen.findByText("Packs saved.")).toBeInTheDocument();
    expect(listedPacks()).toEqual(["5 sessions", "20 sessions", "10 sessions"]);
  });

  it("no manda una lista vacía y pide dejar al menos uno", async () => {
    stubApi();
    await renderSection();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove the 5 sessions pack" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove the 10 sessions pack" }),
    );

    await save();

    expect(savedLists).toEqual([]);
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
      screen.getByRole("button", { name: "Subir el pack de 10 sesiones" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar los packs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sesiones del pack nuevo"),
    ).toBeInTheDocument();
  });
});
