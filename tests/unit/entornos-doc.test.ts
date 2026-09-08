import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEnvExampleNames } from "../support/env-vars";

const ENTORNOS_DOC_PATH = "docs/entornos.md";

// Formas de credencial de Supabase: JWT clásico (`eyJ...`), la clave con
// prefijo `sb_` del formato nuevo, y el nombre de la clave que las tablas de
// club_id saltan por completo. Ninguna debe aparecer nunca en este documento.
// Si una variable futura choca con alguno de estos patrones (como le pasó a
// SUPABASE_SERVICE_ROLE_KEY), añádela a ENV_VARS_NOT_SPELLED_OUT_BY_NAME más
// abajo en vez de aflojar el patrón.
const KEY_LOOKING_PATTERNS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /sb_[a-z]+_/,
  /service_role/i,
];

/** Refs de los dos proyectos de Supabase. Son públicos: viajan en la URL de
 * cada petición del navegador. Lo que nunca se versiona son las claves. */
const PROJECT_REFS = ["xcfrpcvomjjmfoztifuo", "weqhmtpvgewomslpvefu"] as const;

// El propio KEY_LOOKING_PATTERNS de arriba (`/service_role/i`) prohíbe esta
// cadena en cualquier parte del documento, así que no puede aparecer por su
// nombre exacto aunque sí tenga su fila en el catálogo de variables (issue
// #90): docs/entornos.md la describe como "la llave de servicio" y remite a
// `.env.example` para el nombre real.
const ENV_VARS_NOT_SPELLED_OUT_BY_NAME = new Set(["SUPABASE_SERVICE_ROLE_KEY"]);

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

  it("documenta el entorno de cada variable declarada en .env.example", () => {
    const doc = readEntornosDoc();
    const names = readEnvExampleNames();

    const missing = [...names].filter(
      (name) =>
        !ENV_VARS_NOT_SPELLED_OUT_BY_NAME.has(name) &&
        !new RegExp(`\\b${name}\\b`).test(doc),
    );

    expect(
      missing,
      `faltan en docs/entornos.md: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
