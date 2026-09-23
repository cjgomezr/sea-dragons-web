import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import type { ClubSettings } from "@/lib/club/club-settings";

/**
 * La pantalla de configuración del club (#296, RF-6 del PRD de E18a): carga
 * lo guardado por la API v1, guarda nombre e iniciales con lo que el Admin
 * tenía delante, y refresca la cabecera cuando el servidor lo confirma.
 */

const SETTINGS_PATH = "/api/v1/club/settings";

const STORED: ClubSettings = {
  name: "Harbour Hammerheads",
  initials: "HH",
  accentColor: "#1c6ea4",
  logoPath: null,
};

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Stub = {
  readonly settings?: ClubSettings;
  readonly load?: () => Response | Promise<Response>;
  readonly save?: (body: unknown) => Response | Promise<Response>;
};

const patches: unknown[] = [];
let loads = 0;

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

/** Lo que respondería el servidor: la configuración con lo pedido. */
function savedSettings(body: unknown): Response {
  const { name, initials } = body as { name: string; initials: string | null };
  return jsonResponse(200, { data: { ...STORED, name, initials } });
}

function stubApi(stub: Stub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== SETTINGS_PATH) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      if (init?.method === "PATCH") {
        const body: unknown = JSON.parse(String(init.body));
        patches.push(body);
        return stub.save?.(body) ?? savedSettings(body);
      }
      loads += 1;
      return (
        stub.load?.() ?? jsonResponse(200, { data: stub.settings ?? STORED })
      );
    }),
  );
}

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<ClubSettingsScreen locale={locale} />);
  await screen.findByRole("button", { name: /save settings|guardar/i });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /save settings|saving/i });
}

async function typeName(name: string): Promise<void> {
  const field = screen.getByLabelText("Club name");
  await userEvent.clear(field);
  if (name !== "") {
    await userEvent.type(field, name);
  }
}

beforeEach(() => {
  patches.length = 0;
  loads = 0;
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla de configuración: carga", () => {
  it("carga lo guardado: nombre, iniciales, acento y logo", async () => {
    stubApi();

    await renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Club settings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Club name")).toHaveValue(
      "Harbour Hammerheads",
    );
    expect(screen.getByLabelText("Initials")).toHaveValue("HH");
    expect(screen.getByText("#1C6EA4")).toBeInTheDocument();
    expect(
      screen.getByText("No logo yet: the initials are shown instead."),
    ).toBeInTheDocument();
  });

  it("dice que hay un logo cuando el club lo tiene", async () => {
    stubApi({ settings: { ...STORED, logoPath: "club/logo.png" } });

    await renderScreen();

    expect(screen.getByText("The club has a logo.")).toBeInTheDocument();
  });

  it("deja vacías las iniciales que no se guardaron", async () => {
    stubApi({ settings: { ...STORED, initials: null } });

    await renderScreen();

    expect(screen.getByLabelText("Initials")).toHaveValue("");
  });

  it("avisa si no pudo cargar y deja volver a intentarlo", async () => {
    let attempt = 0;
    stubApi({
      load: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : jsonResponse(200, { data: STORED });
      },
    });
    render(<ClubSettingsScreen locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Club name")).toHaveValue(
      "Harbour Hammerheads",
    );
  });

  it("sale entera en español", async () => {
    stubApi();

    await renderScreen("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "Configuración del club" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del club")).toHaveValue(
      "Harbour Hammerheads",
    );
  });
});

describe("pantalla de configuración: guardar", () => {
  it("manda el nombre nuevo junto a lo que había al abrirla", async () => {
    stubApi();
    await renderScreen();

    await typeName("Bay Barracudas");
    await userEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Settings saved.",
    );
    expect(patches).toEqual([
      {
        name: "Bay Barracudas",
        initials: "HH",
        expected: { name: "Harbour Hammerheads", initials: "HH" },
      },
    ]);
  });

  it("refresca la cabecera cuando el servidor confirma el guardado", async () => {
    stubApi();
    await renderScreen();

    await typeName("Bay Barracudas");
    await userEvent.click(saveButton());
    await screen.findByRole("status");

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("manda unas iniciales vacías como ninguna", async () => {
    stubApi();
    await renderScreen();

    await userEvent.clear(screen.getByLabelText("Initials"));
    await userEvent.click(saveButton());

    await screen.findByRole("status");
    expect(patches).toMatchObject([{ initials: null }]);
  });

  it("toma lo guardado como punto de partida del siguiente guardado", async () => {
    stubApi();
    await renderScreen();
    await typeName("Bay Barracudas");
    await userEvent.click(saveButton());
    await screen.findByRole("status");

    await typeName("Bay Barracudas II");
    await userEvent.click(saveButton());

    await vi.waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toMatchObject({
      expected: { name: "Bay Barracudas", initials: "HH" },
    });
  });

  it("desactiva el botón y los campos mientras guarda", async () => {
    stubApi({ save: () => new Promise<Response>(() => undefined) });
    await renderScreen();

    await userEvent.click(saveButton());

    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent("Saving…");
    expect(screen.getByLabelText("Club name")).toBeDisabled();
  });

  it("no manda un segundo guardado con un doble clic", async () => {
    stubApi({ save: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await renderScreen();

    await user.dblClick(saveButton());

    expect(patches).toHaveLength(1);
  });
});

describe("pantalla de configuración: errores", () => {
  it.each([
    ["un nombre vacío", "", "The club needs a name."],
    [
      "un nombre de más de 60 caracteres",
      "a".repeat(61),
      "The name can have at most 60 characters.",
    ],
  ])(
    "explica %s junto al campo, sin mandar nada",
    async (_case, name, text) => {
      stubApi();
      await renderScreen();

      await typeName(name);
      await userEvent.click(saveButton());

      const field = screen.getByLabelText("Club name");
      expect(field).toHaveAccessibleDescription(new RegExp(`^${text}`));
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(patches).toEqual([]);
    },
  );

  it("explica unas iniciales demasiado largas junto a su campo", async () => {
    stubApi();
    await renderScreen();

    await userEvent.type(screen.getByLabelText("Initials"), "QQ");
    await userEvent.click(saveButton());

    expect(screen.getByLabelText("Initials")).toHaveAccessibleDescription(
      /^Initials can have at most 3 characters\./,
    );
    expect(patches).toEqual([]);
  });

  it("enseña junto al campo el rechazo que decide el servidor", async () => {
    stubApi({
      save: () => errorResponse(400, "validation_error", "name_too_long"),
    });
    await renderScreen();

    await typeName("Bay Barracudas");
    await userEvent.click(saveButton());

    await vi.waitFor(() =>
      expect(screen.getByLabelText("Club name")).toHaveAccessibleDescription(
        /^The name can have at most 60 characters\./,
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("avisa de un fallo de red y deja reintentar sin perder lo escrito", async () => {
    let attempt = 0;
    stubApi({
      save: (body) => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : savedSettings(body);
      },
    });
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(screen.getByLabelText("Club name")).toHaveValue("Bay Barracudas");
    expect(saveButton()).toBeEnabled();

    await userEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Settings saved.",
    );
    expect(patches).toHaveLength(2);
  });

  it("avisa de que otro Admin guardó entretanto y ofrece cargar lo último", async () => {
    stubApi({
      save: () => errorResponse(409, "conflict", "club_settings_changed"),
    });
    await renderScreen();
    await typeName("Bay Barracudas");

    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another Admin changed the settings while you were editing.",
    );
    expect(refresh).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Load the latest settings" }),
    );

    await vi.waitFor(() => expect(loads).toBe(2));
  });

  it.each([
    [
      "un 403",
      () => errorResponse(403, "forbidden"),
      "Only an Admin can change the club settings.",
    ],
    [
      "un 500",
      () => errorResponse(500, "internal_error"),
      "We couldn't save the club settings. Try again.",
    ],
  ])("avisa de %s", async (_case, save, text) => {
    stubApi({ save });
    await renderScreen();

    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(saveButton()).toBeEnabled();
  });
});
