import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROFILE_PHOTO_LARGE_SIDE_PX,
  PROFILE_PHOTO_THUMBNAIL_SIDE_PX,
  shrinkProfilePhoto,
} from "@/lib/members/shrink-profile-photo";

/**
 * La reducción de la foto de perfil (#271, RF-9 del PRD de E5) a sus dos
 * tamaños (#353) con imágenes de verdad. Los fixtures se generaron con sharp: las fotos grandes llevan
 * grano para pesar como una de móvil (1,6 MB), la girada es de 300 × 200 con
 * la esquina de arriba a la izquierda roja y orientación EXIF 6, y la de GPS
 * lleva marca, modelo y coordenadas de Melbourne.
 */

const FIXTURES_DIR = path.resolve(__dirname, "../../support/fixtures");
const THUMBNAIL_MAX_BYTES = 20 * 1024;
const LARGE_MAX_BYTES = 200 * 1024;
/** Cuánto puede apartarse un canal de su valor puro por la compresión. */
const COMPRESSION_TOLERANCE = 40;
const CHANNEL_MAX = 255;

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES_DIR, name)));
}

type Version = "thumbnail" | "large";

async function shrunkBytes(
  name: string,
  version: Version,
): Promise<Uint8Array> {
  const result = await shrinkProfilePhoto(await fixture(name));
  if (result.kind !== "shrunk") {
    throw new Error(`${name} no se pudo reducir.`);
  }
  return result[version].bytes;
}

async function sidesOf(bytes: Uint8Array): Promise<readonly unknown[]> {
  const { width, height } = await sharp(bytes).metadata();
  return [width, height];
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function pixelAt(
  bytes: Uint8Array,
  x: number,
  y: number,
): Promise<readonly number[]> {
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + info.channels)];
}

async function isRedAt(
  bytes: Uint8Array,
  x: number,
  y: number,
): Promise<boolean> {
  const [red = 0, green = 0, blue = 0] = await pixelAt(bytes, x, y);
  return (
    red > CHANNEL_MAX - COMPRESSION_TOLERANCE &&
    green < COMPRESSION_TOLERANCE &&
    blue < COMPRESSION_TOLERANCE
  );
}

describe("dos tamaños de la foto", () => {
  it("deja la grande en 1024 px y la miniatura en 160 px por el lado mayor, las dos en WebP", async () => {
    const result = await shrinkProfilePhoto(
      await fixture("foto-apaisada-3000x2000.jpg"),
    );

    expect(result.kind).toBe("shrunk");
    if (result.kind !== "shrunk") return;
    expect(result.large.type).toBe("image/webp");
    expect(result.thumbnail.type).toBe("image/webp");
    await expect(sharp(result.large.bytes).metadata()).resolves.toMatchObject({
      format: "webp",
      width: PROFILE_PHOTO_LARGE_SIDE_PX,
    });
    await expect(
      sharp(result.thumbnail.bytes).metadata(),
    ).resolves.toMatchObject({
      format: "webp",
      width: PROFILE_PHOTO_THUMBNAIL_SIDE_PX,
    });
  });

  it("guarda la miniatura por debajo de 20 KB y la grande por debajo de 200 KB", async () => {
    const result = await shrinkProfilePhoto(
      await fixture("foto-apaisada-3000x2000.jpg"),
    );

    if (result.kind !== "shrunk") throw new Error("no se pudo reducir");
    expect(result.thumbnail.bytes.length).toBeLessThan(THUMBNAIL_MAX_BYTES);
    expect(result.large.bytes.length).toBeLessThan(LARGE_MAX_BYTES);
  });

  it("no agranda la versión grande de una foto que mide menos de 1024 px", async () => {
    const bytes = await shrunkBytes("foto-transparente-800x800.png", "large");

    await expect(sidesOf(bytes)).resolves.toEqual([800, 800]);
  });

  it("no agranda ninguna de las dos si la foto es más pequeña que la miniatura", async () => {
    const result = await shrinkProfilePhoto(
      await fixture("foto-de-perfil.png"),
    );

    if (result.kind !== "shrunk") throw new Error("no se pudo reducir");
    await expect(sidesOf(result.thumbnail.bytes)).resolves.toEqual([128, 128]);
    await expect(sidesOf(result.large.bytes)).resolves.toEqual([128, 128]);
  });

  it.each([
    ["apaisada", "foto-apaisada-3000x2000.jpg", [1024, 683], [160, 107]],
    ["vertical", "foto-vertical-2000x3000.jpg", [683, 1024], [107, 160]],
  ])(
    "conserva la proporción de una foto %s en los dos tamaños, sin recortarla",
    async (_name, file, large, thumbnail) => {
      const result = await shrinkProfilePhoto(await fixture(file));

      if (result.kind !== "shrunk") throw new Error("no se pudo reducir");
      await expect(sidesOf(result.large.bytes)).resolves.toEqual(large);
      await expect(sidesOf(result.thumbnail.bytes)).resolves.toEqual(thumbnail);
    },
  );

  it("endereza la grande según la orientación de sus metadatos", async () => {
    const bytes = await shrunkBytes("foto-girada-exif-6.jpg", "large");

    const { orientation } = await sharp(bytes).metadata();
    await expect(sidesOf(bytes)).resolves.toEqual([200, 300]);
    expect(orientation).toBeUndefined();
    await expect(isRedAt(bytes, 190, 10)).resolves.toBe(true);
    await expect(isRedAt(bytes, 10, 10)).resolves.toBe(false);
  });

  it("endereza también la miniatura", async () => {
    const bytes = await shrunkBytes("foto-girada-exif-6.jpg", "thumbnail");

    await expect(sidesOf(bytes)).resolves.toEqual([107, 160]);
    await expect(isRedAt(bytes, 100, 5)).resolves.toBe(true);
    await expect(isRedAt(bytes, 5, 5)).resolves.toBe(false);
  });

  it.each(["thumbnail", "large"] as const)(
    "no conserva en la versión %s metadatos como la ubicación o el modelo de cámara",
    async (version) => {
      const original = await sharp(
        await fixture("foto-con-gps.jpg"),
      ).metadata();

      const bytes = await shrunkBytes("foto-con-gps.jpg", version);

      expect(original.exif).toBeDefined();
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
    },
  );

  it("mantiene transparente lo que era transparente en un PNG", async () => {
    const bytes = await shrunkBytes(
      "foto-transparente-800x800.png",
      "thumbnail",
    );

    const metadata = await sharp(bytes).metadata();
    expect(metadata.hasAlpha).toBe(true);
    const corner = await pixelAt(bytes, 0, 0);
    expect(corner[3]).toBe(0);
  });

  it("dice que no puede decodificar un fichero que sólo empieza como un PNG", async () => {
    const result = await shrinkProfilePhoto(await fixture("foto-corrupta.png"));

    expect(result).toEqual({ kind: "undecodable" });
  });

  it("no entrega ninguna versión si falla la generación de una de las dos", async () => {
    // Sólo la primera codificación falla: la otra versión sale bien.
    vi.spyOn(sharp.prototype, "toBuffer").mockRejectedValueOnce(
      new Error("se quedó sin memoria"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await shrinkProfilePhoto(
      await fixture("foto-de-perfil.png"),
    );

    expect(result).toEqual({ kind: "undecodable" });
  });
});
