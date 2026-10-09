/**
 * #547: el bundle solo lleva los iconos de Phosphor que se importan. La raíz
 * del paquete reexporta los más de mil iconos, y la variante `csr` necesita
 * un contexto de React que obliga a `"use client"`. La regla de ESLint deja
 * importar solo la ruta por icono de `dist/ssr`.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

async function restrictedImportMessages(source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, {
    filePath: "src/components/Example.tsx",
  });
  if (result === undefined) {
    throw new Error("ESLint returned no result");
  }
  return result.messages
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("imports de Phosphor", () => {
  it.each([
    'import { MagnifyingGlass } from "@phosphor-icons/react";',
    'import { MagnifyingGlass } from "@phosphor-icons/react/ssr";',
    'import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";',
    'import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";',
    'import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";',
  ])("rechaza %s", async (source) => {
    expect(await restrictedImportMessages(source)).toHaveLength(1);
  });

  it("rechaza un import de valor desde dist/lib/types, que solo trae .d.ts", async () => {
    const source =
      'import { IconWeight } from "@phosphor-icons/react/dist/lib/types";';

    expect(await restrictedImportMessages(source)).toHaveLength(1);
  });

  it("acepta un import type desde dist/lib/types", async () => {
    const source =
      'import type { Icon } from "@phosphor-icons/react/dist/lib/types";';

    expect(await restrictedImportMessages(source)).toEqual([]);
  });

  it("acepta la ruta por icono de dist/ssr", async () => {
    const source =
      'import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";';

    expect(await restrictedImportMessages(source)).toEqual([]);
  });
});
