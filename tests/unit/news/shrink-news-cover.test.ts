// @vitest-environment node
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shrinkNewsCover } from "@/lib/news/shrink-news-cover";

/**
 * La reducción de la portada de una publicación (#591, RF-2 del PRD de E22)
 * a sus dos versiones WebP. Las imágenes se generan con sharp en cada test:
 * sólo importan sus lados y su formato.
 */

const OCEAN_BLUE = { r: 20, g: 60, b: 110 };

async function aPicture(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<Uint8Array> {
  const picture = sharp({
    create: { width, height, channels: 3, background: OCEAN_BLUE },
  });
  return new Uint8Array(await picture.toFormat(format).toBuffer());
}

async function describeVersion(bytes: Uint8Array): Promise<readonly unknown[]> {
  const { width, height, format } = await sharp(bytes).metadata();
  return [width, height, format];
}

async function shrink(
  bytes: Uint8Array,
): Promise<{ thumbnail: Uint8Array; large: Uint8Array }> {
  const result = await shrinkNewsCover(bytes);
  if (result.kind !== "shrunk") {
    throw new Error("la portada no se pudo reducir");
  }
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shrinkNewsCover", () => {
  it("reduce una horizontal a 176 y 1600 px por su lado mayor, en WebP", async () => {
    const cover = await shrink(await aPicture(3200, 1800));

    expect(await describeVersion(cover.thumbnail)).toEqual([176, 99, "webp"]);
    expect(await describeVersion(cover.large)).toEqual([1600, 900, "webp"]);
  });

  it("reduce una vertical por su alto", async () => {
    const cover = await shrink(await aPicture(1800, 3200, "png"));

    expect(await describeVersion(cover.thumbnail)).toEqual([99, 176, "webp"]);
    expect(await describeVersion(cover.large)).toEqual([900, 1600, "webp"]);
  });

  it("no agranda una imagen más pequeña que la versión grande", async () => {
    const cover = await shrink(await aPicture(800, 600, "webp"));

    expect(await describeVersion(cover.thumbnail)).toEqual([176, 132, "webp"]);
    expect(await describeVersion(cover.large)).toEqual([800, 600, "webp"]);
  });

  it("dice que no se puede decodificar una imagen rota en vez de lanzar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = (await aPicture(400, 300)).slice(0, 40);

    const result = await shrinkNewsCover(broken);

    expect(result).toEqual({ kind: "undecodable" });
  });
});
