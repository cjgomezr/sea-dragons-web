import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isDecodableLogo } from "@/lib/club/decode-club-logo";

/**
 * Si los bytes de un logo se decodifican de verdad (#295). El dominio ya
 * miró la firma del fichero: esto caza lo que empieza como un PNG y no lo es.
 */

const FIXTURES_DIR = path.resolve(__dirname, "../../support/fixtures");

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES_DIR, name)));
}

describe("decodificar el logo", () => {
  it("acepta un PNG de verdad", async () => {
    expect(await isDecodableLogo(await fixture("foto-de-perfil.png"))).toBe(
      true,
    );
  });

  it("acepta un WebP de verdad", async () => {
    const webp = await sharp(await fixture("foto-de-perfil.png"))
      .webp()
      .toBuffer();

    expect(await isDecodableLogo(new Uint8Array(webp))).toBe(true);
  });

  it("rechaza unos bytes con la firma de PNG que no son una imagen", async () => {
    expect(await isDecodableLogo(await fixture("foto-corrupta.png"))).toBe(
      false,
    );
  });

  it("rechaza un PNG cortado por la mitad", async () => {
    const whole = await fixture("foto-de-perfil.png");

    expect(
      await isDecodableLogo(whole.subarray(0, Math.floor(whole.length / 2))),
    ).toBe(false);
  });
});
