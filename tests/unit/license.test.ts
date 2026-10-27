import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const COPYRIGHT_NOTICE =
  "Copyright (c) 2026 Camilo Gómez Restrepo. All rights reserved.";

/** En npm, `UNLICENSED` es la marca de código propietario: no confundir con
 * The Unlicense, que es justo lo contrario. */
const PROPRIETARY_NPM_LICENSE = "UNLICENSED";

const packageJsonSchema = z.object({
  license: z.string().optional(),
  private: z.boolean().optional(),
});

function readPackageJson(): z.infer<typeof packageJsonSchema> {
  const raw: unknown = JSON.parse(readFileSync("package.json", "utf-8"));
  return packageJsonSchema.parse(raw);
}

function readLicense(): string {
  return readFileSync("LICENSE", "utf-8");
}

// El repositorio es público solo para que Actions no tenga tope de minutos
// (#915). Estos tests impiden que alguien deje el código como libre sin
// querer, por ejemplo regenerando package.json con `npm init`.
describe("licencia propietaria", () => {
  it("declara package.json como UNLICENSED", () => {
    expect(readPackageJson().license).toBe(PROPRIETARY_NPM_LICENSE);
  });

  it("mantiene package.json privado para que npm no lo publique", () => {
    expect(readPackageJson().private).toBe(true);
  });

  it("reserva todos los derechos en LICENSE a nombre del titular", () => {
    expect(readLicense()).toContain(COPYRIGHT_NOTICE);
  });
});
