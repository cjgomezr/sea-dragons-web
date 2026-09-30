// @vitest-environment node
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClubBrand, DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";

/**
 * #421 (E18a): las rutas de `src/app/` que sirven el icono de la pestaña, el
 * de iOS y el manifest de la pantalla de inicio, con la marca doblada.
 */

const servedBrand = vi.hoisted(() => ({
  current: null as ClubBrand | null,
}));

vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => servedBrand.current,
}));

const iconRoute = await import("@/app/icon");
const appleIconRoute = await import("@/app/apple-icon");
const manifestRoute = await import("@/app/manifest");

const CLUB_ACCENT = "#7b3fa0";
const ONE_DAY_CACHE = "public, max-age=86400";
const LOGO_URL = "https://storage.example/club-logos/club/uno.png";

const BRAND_WITHOUT_LOGO: ClubBrand = {
  ...DEFAULT_CLUB_BRAND,
  name: "Hobart Orcas",
  initials: "HO",
  accentColor: CLUB_ACCENT,
};

type ImageMetadataEntry = {
  readonly id: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly contentType: string;
};

async function iconEntryOfWidth(width: number): Promise<ImageMetadataEntry> {
  const entries = await iconRoute.generateImageMetadata();
  const entry = entries.find((candidate) => candidate.size.width === width);
  if (entry === undefined) {
    throw new Error(`no hay icono de ${width}px: ${JSON.stringify(entries)}`);
  }
  return entry;
}

async function pngSize(
  response: Response,
): Promise<{ width?: number; height?: number }> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { width, height } = await sharp(bytes).metadata();
  return { width, height };
}

beforeEach(() => {
  servedBrand.current = BRAND_WITHOUT_LOGO;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("icono de la pestaña (src/app/icon)", () => {
  it("declara uno de 32 px y otro de 512 px, los dos PNG", async () => {
    const entries = await iconRoute.generateImageMetadata();

    expect(
      entries.map(({ size, contentType }) => ({ size, contentType })),
    ).toEqual([
      { size: { width: 32, height: 32 }, contentType: "image/png" },
      { size: { width: 512, height: 512 }, contentType: "image/png" },
    ]);
  });

  it("sirve el de 32 px como PNG de 32 × 32 con un día de caché", async () => {
    const { id } = await iconEntryOfWidth(32);

    const response = await iconRoute.default({ id: Promise.resolve(id) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(ONE_DAY_CACHE);
    expect(await pngSize(response)).toEqual({ width: 32, height: 32 });
  });

  it("sirve el de 512 px como PNG de 512 × 512", async () => {
    const { id } = await iconEntryOfWidth(512);

    const response = await iconRoute.default({ id: Promise.resolve(id) });

    expect(await pngSize(response)).toEqual({ width: 512, height: 512 });
  });

  it("cambia de dirección cuando el Admin sube un logo", async () => {
    const before = await iconEntryOfWidth(32);
    servedBrand.current = { ...BRAND_WITHOUT_LOGO, logoUrl: LOGO_URL };

    const after = await iconEntryOfWidth(32);

    expect(after.id).not.toBe(before.id);
  });

  it("no cambia de dirección entre visitas con la misma marca", async () => {
    const first = await iconEntryOfWidth(32);

    const second = await iconEntryOfWidth(32);

    expect(second.id).toBe(first.id);
  });

  it("pinta el logo que trae de su dirección pública", async () => {
    servedBrand.current = { ...BRAND_WITHOUT_LOGO, logoUrl: LOGO_URL };
    const logo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#c81414" },
    })
      .png()
      .toBuffer();
    const fetchLogo = vi.fn(async () => new Response(new Uint8Array(logo)));
    vi.stubGlobal("fetch", fetchLogo);
    const { id } = await iconEntryOfWidth(32);

    const response = await iconRoute.default({ id: Promise.resolve(id) });

    expect(fetchLogo).toHaveBeenCalledWith(LOGO_URL, expect.anything());
    const { dominant } = await sharp(
      new Uint8Array(await response.arrayBuffer()),
    ).stats();
    expect(dominant.r).toBeGreaterThan(dominant.b);
  });

  it("sirve las iniciales, sin error, si el logo responde 404", async () => {
    servedBrand.current = { ...BRAND_WITHOUT_LOGO, logoUrl: LOGO_URL };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );
    const { id } = await iconEntryOfWidth(32);

    const response = await iconRoute.default({ id: Promise.resolve(id) });

    expect(response.status).toBe(200);
    expect(await pngSize(response)).toEqual({ width: 32, height: 32 });
    expect(console.error).toHaveBeenCalled();
  });

  it("no deja las iniciales de respaldo un día en la caché del navegador", async () => {
    servedBrand.current = { ...BRAND_WITHOUT_LOGO, logoUrl: LOGO_URL };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );
    const { id } = await iconEntryOfWidth(32);

    const response = await iconRoute.default({ id: Promise.resolve(id) });

    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("se genera en cada petición y no en el build, para seguir a la marca", () => {
    expect(iconRoute.dynamic).toBe("force-dynamic");
  });
});

describe("icono de iOS (src/app/apple-icon)", () => {
  it("declara uno de 180 px en PNG", async () => {
    const entries = await appleIconRoute.generateImageMetadata();

    expect(
      entries.map(({ size, contentType }) => ({ size, contentType })),
    ).toEqual([
      { size: { width: 180, height: 180 }, contentType: "image/png" },
    ]);
  });

  it("lo sirve como PNG de 180 × 180 con un día de caché", async () => {
    const [entry] = await appleIconRoute.generateImageMetadata();

    const response = await appleIconRoute.default({
      id: Promise.resolve(entry?.id ?? ""),
    });

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(ONE_DAY_CACHE);
    expect(await pngSize(response)).toEqual({ width: 180, height: 180 });
  });

  it("se genera en cada petición y no en el build", () => {
    expect(appleIconRoute.dynamic).toBe("force-dynamic");
  });
});

describe("manifest (src/app/manifest)", () => {
  it("lleva el nombre del club, su acento y el icono de 512 px", async () => {
    const icon512 = await iconEntryOfWidth(512);

    const manifest = await manifestRoute.default();

    expect(manifest).toMatchObject({
      name: "Hobart Orcas",
      short_name: "Hobart Orcas",
      theme_color: CLUB_ACCENT,
      display: "browser",
      icons: [
        { src: `/icon/${icon512.id}`, sizes: "512x512", type: "image/png" },
      ],
    });
  });

  it("usa el acento por defecto si el guardado no es un color", async () => {
    servedBrand.current = { ...BRAND_WITHOUT_LOGO, accentColor: "rojo" };

    const manifest = await manifestRoute.default();

    expect(manifest.theme_color).toBe(DEFAULT_CLUB_BRAND.accentColor);
  });

  it("se genera en cada petición y no en el build", () => {
    expect(manifestRoute.dynamic).toBe("force-dynamic");
  });
});
