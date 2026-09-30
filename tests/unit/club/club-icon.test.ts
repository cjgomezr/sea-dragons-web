// @vitest-environment node
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCENT_COLOR } from "@/lib/club/accent-color";
import {
  type ClubIconBrand,
  type LogoBytesReader,
  clubIconFingerprint,
  renderClubIcon,
} from "@/lib/club/club-icon";

/**
 * #421 (E18a): el icono de la pestaña, los marcadores y la pantalla de inicio
 * sale del logo del club, o de sus iniciales sobre el acento si no hay logo o
 * no se puede leer.
 */

const LOGO_RED = { r: 200, g: 20, b: 20 };
const PANEL_WHITE = { r: 255, g: 255, b: 255 };
const ACCENT = "#7b3fa0";
const ACCENT_RGB = { r: 0x7b, g: 0x3f, b: 0xa0 };
const TEST_READ_TIMEOUT_MS = 50;

const WITHOUT_LOGO: ClubIconBrand = {
  initials: "HO",
  accentColor: ACCENT,
  logoUrl: null,
};

const WITH_LOGO: ClubIconBrand = {
  ...WITHOUT_LOGO,
  logoUrl: "https://storage.example/club-logos/club/uno.png",
};

type Rgb = { readonly r: number; readonly g: number; readonly b: number };

async function solidPng(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: LOGO_RED },
  })
    .png()
    .toBuffer();
}

async function pixelAt(png: Uint8Array, x: number, y: number): Promise<Rgb> {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return {
    r: data[offset] ?? -1,
    g: data[offset + 1] ?? -1,
    b: data[offset + 2] ?? -1,
  };
}

function expectColorClose(actual: Rgb, expected: Rgb): void {
  const tolerance = 8;
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(tolerance);
}

function readerReturning(bytes: Uint8Array): LogoBytesReader {
  return async () => bytes;
}

function render(
  brand: ClubIconBrand,
  sizePx: number,
  readLogoBytes: LogoBytesReader,
): Promise<Uint8Array> {
  return renderClubIcon({
    brand,
    sizePx,
    readLogoBytes,
    readTimeoutMs: TEST_READ_TIMEOUT_MS,
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderClubIcon con logo", () => {
  it("devuelve un PNG cuadrado del tamaño pedido", async () => {
    const logo = await solidPng(200, 100);

    const icon = await render(WITH_LOGO, 180, readerReturning(logo));

    const metadata = await sharp(icon).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 180, height: 180 });
  });

  it("encaja un logo apaisado entero, con bandas de panel arriba y abajo", async () => {
    const logo = await solidPng(200, 100);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo));

    expectColorClose(await pixelAt(icon, 0, 16), LOGO_RED);
    expectColorClose(await pixelAt(icon, 31, 16), LOGO_RED);
    expectColorClose(await pixelAt(icon, 16, 0), PANEL_WHITE);
    expectColorClose(await pixelAt(icon, 16, 31), PANEL_WHITE);
  });

  it("encaja un logo vertical entero, con bandas de panel a los lados", async () => {
    const logo = await solidPng(100, 200);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo));

    expectColorClose(await pixelAt(icon, 16, 0), LOGO_RED);
    expectColorClose(await pixelAt(icon, 16, 31), LOGO_RED);
    expectColorClose(await pixelAt(icon, 0, 16), PANEL_WHITE);
    expectColorClose(await pixelAt(icon, 31, 16), PANEL_WHITE);
  });

  it("pide los bytes a la dirección del logo", async () => {
    const reader = vi.fn(readerReturning(await solidPng(10, 10)));

    await render(WITH_LOGO, 32, reader);

    expect(reader).toHaveBeenCalledWith(
      WITH_LOGO.logoUrl,
      expect.any(AbortSignal),
    );
  });
});

describe("renderClubIcon sin logo", () => {
  it("pinta las iniciales sobre el acento, del tamaño pedido", async () => {
    const reader = vi.fn<LogoBytesReader>();

    const icon = await render(WITHOUT_LOGO, 512, reader);

    expect(await sharp(icon).metadata()).toMatchObject({
      format: "png",
      width: 512,
      height: 512,
    });
    expectColorClose(await pixelAt(icon, 0, 0), ACCENT_RGB);
    expect(reader).not.toHaveBeenCalled();
  });

  it("pinta las iniciales en blanco", async () => {
    const icon = await render(WITHOUT_LOGO, 180, vi.fn<LogoBytesReader>());

    const { channels } = await sharp(icon).stats();
    expect(channels.slice(0, 3).map((channel) => channel.max)).toEqual([
      255, 255, 255,
    ]);
  });

  it("usa el acento por defecto si el guardado no es un color", async () => {
    const icon = await render(
      { ...WITHOUT_LOGO, accentColor: "</svg>" },
      32,
      vi.fn<LogoBytesReader>(),
    );

    const [r, g, b] = [1, 3, 5].map((start) =>
      parseInt(DEFAULT_ACCENT_COLOR.slice(start, start + 2), 16),
    );
    expectColorClose(await pixelAt(icon, 0, 0), {
      r: r ?? -1,
      g: g ?? -1,
      b: b ?? -1,
    });
  });
});

describe("renderClubIcon con un logo que no se puede leer", () => {
  it("pinta las iniciales y deja el fallo en el log si el lector falla", async () => {
    const reader: LogoBytesReader = async () => {
      throw new Error("el logo respondió 404");
    };

    const icon = await render(WITH_LOGO, 32, reader);

    expectColorClose(await pixelAt(icon, 0, 0), ACCENT_RGB);
    expect(console.error).toHaveBeenCalled();
  });

  it("pinta las iniciales si los bytes no son una imagen", async () => {
    const notAnImage = new TextEncoder().encode("<html>404</html>");

    const icon = await render(WITH_LOGO, 32, readerReturning(notAnImage));

    expectColorClose(await pixelAt(icon, 0, 0), ACCENT_RGB);
    expect(console.error).toHaveBeenCalled();
  });

  it("pinta las iniciales si el lector no contesta a tiempo, y lo cancela", async () => {
    let signalSeen: AbortSignal | undefined;
    const reader: LogoBytesReader = (_url, signal) => {
      signalSeen = signal;
      return new Promise<Uint8Array>(() => undefined);
    };

    const icon = await render(WITH_LOGO, 32, reader);

    expectColorClose(await pixelAt(icon, 0, 0), ACCENT_RGB);
    expect(signalSeen?.aborted).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("clubIconFingerprint", () => {
  it("no cambia entre lecturas de la misma marca", () => {
    expect(clubIconFingerprint(WITH_LOGO)).toBe(
      clubIconFingerprint({ ...WITH_LOGO }),
    );
  });

  it("cambia cuando el Admin sube otro logo", () => {
    const other = {
      ...WITH_LOGO,
      logoUrl: "https://storage.example/club-logos/club/dos.png",
    };

    expect(clubIconFingerprint(other)).not.toBe(clubIconFingerprint(WITH_LOGO));
  });

  it("cambia cuando el Admin quita el logo", () => {
    expect(clubIconFingerprint(WITHOUT_LOGO)).not.toBe(
      clubIconFingerprint(WITH_LOGO),
    );
  });

  it("sin logo, cambia con las iniciales o con el acento", () => {
    const base = clubIconFingerprint(WITHOUT_LOGO);

    expect(clubIconFingerprint({ ...WITHOUT_LOGO, initials: "VS" })).not.toBe(
      base,
    );
    expect(
      clubIconFingerprint({ ...WITHOUT_LOGO, accentColor: "#123456" }),
    ).not.toBe(base);
  });

  it("sólo lleva caracteres que caben en un segmento de la dirección", () => {
    expect(clubIconFingerprint(WITH_LOGO)).toMatch(/^[0-9a-f]+$/);
  });
});
