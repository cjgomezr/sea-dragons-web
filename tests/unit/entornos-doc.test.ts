import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  environmentsFor,
  readEnvironmentManifest,
  secretVariableNames,
} from "../../scripts/lib/entornos-manifest";
import {
  PLATFORM_INJECTED_ENV_VARS,
  readEnvExampleNames,
} from "../support/env-vars";

const ENTORNOS_DOC_PATH = "docs/entornos.md";
const ROTATION_HEADING = "## Rotación de credenciales";

// Los dos formatos en los que Supabase entrega una clave: el JWT clásico
// (`eyJ<header>.<payload>.<firma>`) y el del formato nuevo, con prefijo
// `sb_publishable_` o `sb_secret_`. Ninguna debe aparecer nunca en este
// documento.
//
// Aquí vivió un tercer patrón, `/service_role/i`, hasta el 8 de septiembre de
// 2026. Se quitó porque no cazaba ninguna credencial: ese texto no aparece
// dentro de una clave de ninguno de los dos formatos. Lo único que cazaba era
// la palabra, que es un nombre de rol de Postgres y sale con toda legitimidad
// en las migraciones y en el código. El precio de tenerlo era que
// `docs/entornos.md` no podía nombrar `SUPABASE_SERVICE_ROLE_KEY`, la variable
// que más importa documentar bien, y hacía falta una lista de excepciones para
// que este archivo y el catálogo de variables pudieran convivir.
const KEY_LOOKING_PATTERNS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /sb_[a-z]+_/,
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

  // Sin esto, borrar un patrón por accidente dejaría el test de arriba pasando
  // siempre y nadie se enteraría: un documento sin claves y un patrón que ya no
  // busca nada se ven exactamente igual desde fuera.
  it.each([
    [
      "JWT del formato clásico",
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoieCJ9.ZmlybWE",
    ],
    ["clave secreta del formato nuevo", "sb_secret_ejemplo"],
    ["clave publicable del formato nuevo", "sb_publishable_ejemplo"],
  ])(
    "reconoce una %s como cadena con pinta de clave",
    (_nombre, credencial) => {
      expect(
        KEY_LOOKING_PATTERNS.some((pattern) => pattern.test(credencial)),
      ).toBe(true);
    },
  );

  it("nombra el plan Hobby de Vercel y su límite de uso no comercial", () => {
    const doc = readEntornosDoc();

    // Hobby prohíbe el uso comercial. E12 cobra cuotas por Stripe, así que
    // quien llegue a ese epic tiene que encontrar la advertencia aquí y no en
    // los términos de servicio de Vercel después de cobrarle a alguien.
    expect(doc).toContain("Hobby");
    expect(doc).toMatch(/no comercial/i);
    expect(doc).toContain("E12");
  });

  // Estas no están en `.env.example` a propósito (ver `env-vars.ts`), así que
  // este documento es el único sitio donde un humano puede enterarse de que
  // existen. Sin este test, borrar su párrafo dejaría la suite en verde.
  it("documenta las variables que inyecta la plataforma y no viven en .env.example", () => {
    const doc = readEntornosDoc();

    for (const name of PLATFORM_INJECTED_ENV_VARS) {
      expect(doc).toContain(name);
    }
  });

  it("documenta el entorno de cada variable declarada en .env.example", () => {
    const doc = readEntornosDoc();
    const names = readEnvExampleNames();

    const missing = [...names].filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(doc),
    );

    expect(
      missing,
      `faltan en docs/entornos.md: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

type RotationRow = readonly [
  variable: string,
  environment: string,
  where: string,
];

/** Filas de la tabla de rotación, sin cabecera ni separador. La tabla es la
 * lista que alguien sigue con la credencial nueva delante, así que se compara
 * entera contra el manifiesto: una fila de más o de menos deja media rotación
 * sin hacer. */
function readRotationRows(): RotationRow[] {
  const doc = readEntornosDoc();
  const start = doc.indexOf(ROTATION_HEADING);
  if (start < 0) {
    throw new Error(`${ENTORNOS_DOC_PATH} no tiene "${ROTATION_HEADING}"`);
  }
  const section =
    doc.slice(start + ROTATION_HEADING.length).split(/^## /m)[0] ?? "";

  return section
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim().replace(/^`|`$/g, "")),
    )
    .filter((cells) => cells[0] !== "Variable" && !/^-+$/.test(cells[0] ?? ""))
    .map((cells) => [cells[0] ?? "", cells[1] ?? "", cells[2] ?? ""] as const);
}

function expectedRotationRows(): RotationRow[] {
  const manifest = readEnvironmentManifest();

  return secretVariableNames(manifest).flatMap((variable) =>
    environmentsFor(manifest, variable).map(
      (environment) =>
        [
          variable,
          environment,
          manifest.environments[environment]?.where ?? "",
        ] as const,
    ),
  );
}

describe("rotación de credenciales en docs/entornos.md", () => {
  it("enumera un sitio por cada entorno en el que vive cada variable secreta", () => {
    expect(readRotationRows()).toEqual(expectedRotationRows());
  });

  it("nombra todas las variables secretas del manifiesto", () => {
    const listed = new Set(readRotationRows().map(([variable]) => variable));

    for (const name of secretVariableNames(readEnvironmentManifest())) {
      expect(listed).toContain(name);
    }
  });

  // Sin esto, una tabla vacía y una tabla completa se verían igual el día que
  // alguien rompa el parser o borre la sección entera.
  it("tiene al menos una fila por variable secreta", () => {
    const rows = readRotationRows();

    expect(rows.length).toBeGreaterThanOrEqual(
      secretVariableNames(readEnvironmentManifest()).length,
    );
  });
});
