// @vitest-environment node
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCENT_COLOR } from "@/lib/club/accent-color";
import {
  type ClubIcon,
  type ClubIconBrand,
  type IconSurface,
  type LogoBytesReader,
  clubIconFingerprint,
  renderClubIcon,
} from "@/lib/club/club-icon";

/**
 * #421 (E18a): el icono de la pestaña, los marcadores y la pantalla de inicio
 * sale del logo del club, o de sus iniciales sobre el acento si no hay logo o
 * no se puede leer. El de la pestaña va sin nada detrás, como en la cabecera;
 * el de la pantalla de inicio va sobre el acento con un margen, porque iOS y
 * Android no admiten transparencia.
 */

const LOGO_RED = { r: 200, g: 20, b: 20 };
const ACCENT = "#7b3fa0";
const ACCENT_RGB = { r: 0x7b, g: 0x3f, b: 0xa0 };
const TEST_READ_TIMEOUT_MS = 50;
const OPAQUE = 255;
const TRANSPARENT_ALPHA = 0;

/** La pestaña: el logo tal cual, sin nada detrás. */
const TRANSPARENT: IconSurface = { kind: "transparent" };
/** La pantalla de inicio: fondo del acento y un margen de un octavo del
 * lado, para que la máscara de Android no recorte el logo. */
const ON_ACCENT: IconSurface = {
  kind: "solid",
  color: ACCENT,
  paddingShare: 0.125,
};

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
type Rgba = Rgb & { readonly alpha: number };

async function solidPng(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: LOGO_RED },
  })
    .png()
    .toBuffer();
}

/** Un logo del todo transparente: lo que el club sube suele traer fondo
 * transparente alrededor del dibujo. */
async function transparentPng(side: number): Promise<Uint8Array> {
  return sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { ...LOGO_RED, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

async function pixelAt(png: Uint8Array, x: number, y: number): Promise<Rgba> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return {
    r: data[offset] ?? -1,
    g: data[offset + 1] ?? -1,
    b: data[offset + 2] ?? -1,
    alpha: data[offset + 3] ?? -1,
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

function renderResult(
  brand: ClubIconBrand,
  sizePx: number,
  readLogoBytes: LogoBytesReader,
  surface: IconSurface = TRANSPARENT,
): Promise<ClubIcon> {
  return renderClubIcon({
    brand,
    sizePx,
    surface,
    readLogoBytes,
    readTimeoutMs: TEST_READ_TIMEOUT_MS,
  });
}

async function render(
  brand: ClubIconBrand,
  sizePx: number,
  readLogoBytes: LogoBytesReader,
  surface: IconSurface = TRANSPARENT,
): Promise<Uint8Array> {
  return (await renderResult(brand, sizePx, readLogoBytes, surface)).png;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderClubIcon con logo, en la pestaña", () => {
  it("devuelve un PNG cuadrado del tamaño pedido", async () => {
    const logo = await solidPng(200, 100);

    const icon = await render(WITH_LOGO, 180, readerReturning(logo));

    const metadata = await sharp(icon).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 180, height: 180 });
  });

  it("encaja un logo apaisado entero y deja transparente lo de arriba y abajo", async () => {
    const logo = await solidPng(200, 100);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo));

    expectColorClose(await pixelAt(icon, 0, 16), LOGO_RED);
    expectColorClose(await pixelAt(icon, 31, 16), LOGO_RED);
    expect((await pixelAt(icon, 0, 16)).alpha).toBe(OPAQUE);
    expect((await pixelAt(icon, 16, 0)).alpha).toBe(TRANSPARENT_ALPHA);
    expect((await pixelAt(icon, 16, 31)).alpha).toBe(TRANSPARENT_ALPHA);
  });

  it("encaja un logo vertical entero y deja transparentes los lados", async () => {
    const logo = await solidPng(100, 200);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo));

    expectColorClose(await pixelAt(icon, 16, 0), LOGO_RED);
    expectColorClose(await pixelAt(icon, 16, 31), LOGO_RED);
    expect((await pixelAt(icon, 0, 16)).alpha).toBe(TRANSPARENT_ALPHA);
    expect((await pixelAt(icon, 31, 16)).alpha).toBe(TRANSPARENT_ALPHA);
  });

  it("conserva la transparencia que trae el logo", async () => {
    const logo = await transparentPng(40);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo));

    expect((await pixelAt(icon, 16, 16)).alpha).toBe(TRANSPARENT_ALPHA);
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

describe("renderClubIcon con logo, en la pantalla de inicio", () => {
  it("pone el logo sobre el acento con un margen alrededor", async () => {
    const logo = await solidPng(200, 100);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo), ON_ACCENT);

    // Un octavo de 32 son 4 px de margen: el logo apaisado ocupa 24 × 12,
    // centrado, así que la fila del medio es logo de la columna 4 a la 27 y
    // todo lo demás es acento.
    expectColorClose(await pixelAt(icon, 16, 16), LOGO_RED);
    expectColorClose(await pixelAt(icon, 4, 16), LOGO_RED);
    expectColorClose(await pixelAt(icon, 27, 16), LOGO_RED);
    expectColorClose(await pixelAt(icon, 1, 16), ACCENT_RGB);
    expectColorClose(await pixelAt(icon, 16, 1), ACCENT_RGB);
    expectColorClose(await pixelAt(icon, 16, 30), ACCENT_RGB);
    expect((await pixelAt(icon, 0, 0)).alpha).toBe(OPAQUE);
  });

  it("rellena con el acento la transparencia del logo", async () => {
    const logo = await transparentPng(40);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo), ON_ACCENT);

    expectColorClose(await pixelAt(icon, 16, 16), ACCENT_RGB);
    expect((await pixelAt(icon, 16, 16)).alpha).toBe(OPAQUE);
  });

  it("usa el acento por defecto si el color del fondo no es un color", async () => {
    const logo = await solidPng(10, 10);

    const icon = await render(WITH_LOGO, 32, readerReturning(logo), {
      ...ON_ACCENT,
      color: "</svg>",
    });

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

  it("pinta las iniciales sobre el acento también en la pestaña: sin logo no hay nada que dejar ver", async () => {
    const icon = await render(WITHOUT_LOGO, 32, vi.fn<LogoBytesReader>());

    expectColorClose(await pixelAt(icon, 0, 0), ACCENT_RGB);
    expect((await pixelAt(icon, 0, 0)).alpha).toBe(OPAQUE);
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

describe("renderClubIcon: qué pintó", () => {
  it("dice que pintó la marca cuando el logo se leyó", async () => {
    const logo = await solidPng(10, 10);

    const icon = await renderResult(WITH_LOGO, 32, readerReturning(logo));

    expect(icon.kind).toBe("brand");
  });

  it("dice que pintó la marca cuando el club no tiene logo", async () => {
    const icon = await renderResult(WITHOUT_LOGO, 32, vi.fn<LogoBytesReader>());

    expect(icon.kind).toBe("brand");
  });

  it("dice que pintó el respaldo cuando el logo no se pudo leer", async () => {
    const reader: LogoBytesReader = async () => {
      throw new Error("el logo respondió 404");
    };

    const icon = await renderResult(WITH_LOGO, 32, reader);

    expect(icon.kind).toBe("logo_fallback");
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

  it("con logo, cambia con el acento: la pantalla de inicio lo lleva de fondo", () => {
    expect(
      clubIconFingerprint({ ...WITH_LOGO, accentColor: "#123456" }),
    ).not.toBe(clubIconFingerprint(WITH_LOGO));
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
