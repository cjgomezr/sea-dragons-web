import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENTORNOS_DOC_PATH = "docs/entornos.md";

// Formas de credencial de Supabase: JWT clásico (`eyJ...`), la clave con
// prefijo `sb_` del formato nuevo, y el nombre de la clave que las tablas de
// club_id saltan por completo. Ninguna debe aparecer nunca en este documento.
const KEY_LOOKING_PATTERNS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /sb_[a-z]+_/,
  /service_role/i,
];

/** Refs de los dos proyectos de Supabase. Son públicos: viajan en la URL de
 * cada petición del navegador. Lo que nunca se versiona son las claves. */
const PROJECT_REFS = ["xcfrpcvomjjmfoztifuo", "weqhmtpvgewomslpvefu"] as const;

function readEntornosDoc(): string {
  return readFileSync(ENTORNOS_DOC_PATH, "utf-8");
}

describe("docs/entornos.md", () => {
  it("nombra los dos proyectos de Supabase y su región", () => {
    const doc = readEntornosDoc();

    expect(doc).toContain("seadragons-dev");
    expect(doc).toContain("seadragons-prod");
    expect(doc).toContain("ap-southeast-2");
  });

  it("declara un ref concreto para cada proyecto, no un pendiente", () => {
    const doc = readEntornosDoc();

    // Un ref sin resolver deja el documento inservible justo cuando alguien lo
    // consulta: al configurar un despliegue o al buscar dónde apuntar.
    for (const ref of PROJECT_REFS) {
      expect(doc).toContain(ref);
    }
    expect(doc).not.toMatch(/\*\*Ref:\*\*\s*pendiente/i);
  });

  it("no contiene ninguna cadena con pinta de clave", () => {
    const doc = readEntornosDoc();

    for (const pattern of KEY_LOOKING_PATTERNS) {
      expect(doc).not.toMatch(pattern);
    }
  });
});
