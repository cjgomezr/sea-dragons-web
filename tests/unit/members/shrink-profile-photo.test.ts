import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  PROFILE_PHOTO_MAX_SIDE_PX,
  shrinkProfilePhoto,
} from "@/lib/members/shrink-profile-photo";

/**
 * La reducción de la foto de perfil (#271, RF-9 del PRD de E5) con imágenes
 * de verdad. Los fixtures se generaron con sharp: las fotos grandes llevan
 * grano para pesar como una de móvil (1,6 MB), la girada es de 300 × 200 con
 * la esquina de arriba a la izquierda roja y orientación EXIF 6, y la de GPS
 * lleva marca, modelo y coordenadas de Melbourne.
 */

const FIXTURES_DIR = path.resolve(__dirname, "../../support/fixtures");
const MAX_STORED_BYTES = 100 * 1024;
/** Cuánto puede apartarse un canal de su valor puro por la compresión. */
const COMPRESSION_TOLERANCE = 40;
const CHANNEL_MAX = 255;

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES_DIR, name)));
}

async function shrunkBytes(name: string): Promise<Uint8Array> {
  const result = await shrinkProfilePhoto(await fixture(name));
  if (result.kind !== "shrunk") {
    throw new Error(`${name} no se pudo reducir.`);
  }
  return result.bytes;
}

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

describe("reducir la foto", () => {
  it("deja una foto grande en 400 px por su lado mayor, en WebP", async () => {
    const result = await shrinkProfilePhoto(
      await fixture("foto-apaisada-3000x2000.jpg"),
    );

    expect(result.kind).toBe("shrunk");
    if (result.kind !== "shrunk") return;
    expect(result.type).toBe("image/webp");
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(PROFILE_PHOTO_MAX_SIDE_PX);
  });

  it("guarda la foto grande por debajo de 100 KB", async () => {
    const original = await fixture("foto-apaisada-3000x2000.jpg");

    const bytes = await shrunkBytes("foto-apaisada-3000x2000.jpg");

    expect(original.length).toBeGreaterThan(MAX_STORED_BYTES);
    expect(bytes.length).toBeLessThan(MAX_STORED_BYTES);
  });

  it("no agranda una foto que ya mide menos de 400 px", async () => {
    const bytes = await shrunkBytes("foto-pequena-300x200.png");

    const { width, height } = await sharp(bytes).metadata();
    expect([width, height]).toEqual([300, 200]);
  });

  it.each([
    ["apaisada", "foto-apaisada-3000x2000.jpg", [400, 267]],
    ["vertical", "foto-vertical-2000x3000.jpg", [267, 400]],
  ])(
    "conserva la proporción de una foto %s, sin recortarla",
    async (_name, file, expected) => {
      const bytes = await shrunkBytes(file);

      const { width, height } = await sharp(bytes).metadata();
      expect([width, height]).toEqual(expected);
    },
  );

  it("endereza una foto girada según la orientación de sus metadatos", async () => {
    const bytes = await shrunkBytes("foto-girada-exif-6.jpg");

    const { width, height, orientation } = await sharp(bytes).metadata();
    expect([width, height]).toEqual([200, 300]);
    expect(orientation).toBeUndefined();
    await expect(isRedAt(bytes, 190, 10)).resolves.toBe(true);
    await expect(isRedAt(bytes, 10, 10)).resolves.toBe(false);
  });

  it("no conserva metadatos como la ubicación o el modelo de cámara", async () => {
    const original = await sharp(await fixture("foto-con-gps.jpg")).metadata();

    const bytes = await shrunkBytes("foto-con-gps.jpg");

    expect(original.exif).toBeDefined();
    const metadata = await sharp(bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
  });

  it("mantiene transparente lo que era transparente en un PNG", async () => {
    const bytes = await shrunkBytes("foto-transparente-800x800.png");

    const metadata = await sharp(bytes).metadata();
    expect(metadata.hasAlpha).toBe(true);
    const corner = await pixelAt(bytes, 0, 0);
    expect(corner[3]).toBe(0);
  });

  it("dice que no puede decodificar un fichero que sólo empieza como un PNG", async () => {
    const result = await shrinkProfilePhoto(await fixture("foto-corrupta.png"));

    expect(result).toEqual({ kind: "undecodable" });
  });
});
