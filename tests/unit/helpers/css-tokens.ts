import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readGlobalsCss(): string {
  return readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");
}

/** Devuelve el cuerpo de la primera regla con ese selector exacto. */
export function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  const body = match?.[1];
  if (body === undefined) {
    throw new Error(`Selector not found in globals.css: ${selector}`);
  }
  return body;
}

export function cssCustomProperties(block: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) {
      continue;
    }
    properties[name] = value.replace(/\s+/g, " ").trim();
  }
  return properties;
}
