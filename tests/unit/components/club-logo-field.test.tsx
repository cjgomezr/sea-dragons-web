import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubSettingsScreen } from "@/components/club/ClubSettingsScreen";
import type { ClubSettings } from "@/lib/club/club-settings";

/**
 * El logo en la pantalla de configuración del club (#295, RF-4 del PRD de
 * E18a): el Admin lo sube, lo cambia o lo quita, y la pantalla sólo da el
 * cambio por hecho cuando el servidor lo confirma.
 */

const SETTINGS_PATH = "/api/v1/club/settings";
const LOGO_PATH = "/api/v1/club/settings/logo";
const LOGO_URL = "https://storage.example.test/club-logos/club/logo.png";
const NEW_LOGO_URL = "https://storage.example.test/club-logos/club/nuevo.png";
const LOGO_ALT = "Harbour Hammerheads logo";

const STORED: ClubSettings = {
  name: "Harbour Hammerheads",
  initials: "HH",
  accentColor: "#1c6ea4",
  logoUrl: null,
};

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type LogoCall = { readonly method: string; readonly body: unknown };

const logoCalls: LogoCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(options: {
  readonly settings?: ClubSettings;
  readonly logo?: () => Response;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === SETTINGS_PATH) {
        return jsonResponse(200, { data: options.settings ?? STORED });
      }
      if (url === LOGO_PATH) {
        const method = init?.method ?? "GET";
        logoCalls.push({ method, body: init?.body });
        return (
          options.logo?.() ??
          jsonResponse(200, {
            data: { logoUrl: method === "PUT" ? NEW_LOGO_URL : null },
          })
        );
      }
      throw new Error(`Petición inesperada: ${url}`);
    }),
  );
}

async function renderScreen(): Promise<void> {
  render(<ClubSettingsScreen locale="en" />);
  await screen.findByRole("button", { name: "Save settings" });
}

function pngFile(size = 64): File {
  return new File([new Uint8Array(size)], "logo.png", { type: "image/png" });
}

beforeEach(() => {
  logoCalls.length = 0;
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el logo en la configuración del club", () => {
  it("enseña el logo guardado y deja cambiarlo o quitarlo", async () => {
    stubApi({ settings: { ...STORED, logoUrl: LOGO_URL } });

    await renderScreen();

    expect(screen.getByRole("img", { name: LOGO_ALT })).toHaveAttribute(
      "src",
      LOGO_URL,
    );
    expect(
      screen.getByRole("button", { name: "Change logo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove logo" }),
    ).toBeInTheDocument();
  });

  it("sin logo ofrece subirlo y no ofrece quitarlo", async () => {
    stubApi({});

    await renderScreen();

    expect(
      screen.getByRole("button", { name: "Upload logo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove logo" }),
    ).not.toBeInTheDocument();
  });

  it("sube el logo elegido y lo enseña cuando el servidor lo confirma", async () => {
    stubApi({});
    await renderScreen();
    const file = pngFile();

    await userEvent.upload(screen.getByLabelText("Choose a logo"), file);

    expect(await screen.findByText("Logo updated.")).toBeInTheDocument();
    expect(logoCalls).toEqual([{ method: "PUT", body: file }]);
    expect(screen.getByRole("img", { name: LOGO_ALT })).toHaveAttribute(
      "src",
      NEW_LOGO_URL,
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("avisa de un JPEG antes de subirlo, sin mandar nada", async () => {
    stubApi({});
    await renderScreen();
    const jpeg = new File([new Uint8Array(8)], "logo.jpg", {
      type: "image/jpeg",
    });

    await userEvent.upload(screen.getByLabelText("Choose a logo"), jpeg, {
      applyAccept: false,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only PNG or WebP logos can be used.",
    );
    expect(logoCalls).toEqual([]);
  });

  it("avisa de un logo de más de 512 KB antes de subirlo", async () => {
    stubApi({});
    await renderScreen();

    await userEvent.upload(
      screen.getByLabelText("Choose a logo"),
      pngFile(512 * 1024 + 1),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This logo is larger than 512 KB.",
    );
    expect(logoCalls).toEqual([]);
  });

  it("explica el rechazo del servidor de un fichero que no se decodifica", async () => {
    stubApi({
      logo: () =>
        jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "x",
            reason: "logo_undecodable",
          },
        }),
    });
    await renderScreen();

    await userEvent.upload(screen.getByLabelText("Choose a logo"), pngFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file cannot be read as an image.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("quita el logo y vuelven las iniciales", async () => {
    stubApi({ settings: { ...STORED, logoUrl: LOGO_URL } });
    await renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Remove logo" }));

    expect(
      await screen.findByText("Logo removed: the initials are back."),
    ).toBeInTheDocument();
    expect(logoCalls).toEqual([{ method: "DELETE", body: undefined }]);
    expect(
      screen.queryByRole("img", { name: LOGO_ALT }),
    ).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("avisa si quien lo intenta no es Admin", async () => {
    stubApi({
      settings: { ...STORED, logoUrl: LOGO_URL },
      logo: () =>
        jsonResponse(403, { error: { code: "forbidden", message: "x" } }),
    });
    await renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Remove logo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an Admin can change the club settings.",
    );
    expect(screen.getByRole("img", { name: LOGO_ALT })).toBeInTheDocument();
  });
});
