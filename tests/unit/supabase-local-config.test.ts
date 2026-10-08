import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El Supabase local de la CLI (#447). Lo que se comprueba aquí es lo que no
 * depende de tener Docker: que la configuración y los comandos existen y dicen
 * lo que el equipo espera. Que el stack arranca y aplica las migraciones se
 * verifica a mano y queda anotado en el PR.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/** Las líneas de una sección de TOML, sin sus subsecciones. Basta para
 * `config.toml`, que es plano: no hace falta una dependencia de TOML. */
function readTomlSection(toml: string, section: string): string {
  const header = `[${section}]`;
  const start = toml.split(/\r?\n/).findIndex((line) => line.trim() === header);
  if (start === -1) {
    throw new Error(`config.toml no tiene la sección ${header}`);
  }
  const lines = toml.split(/\r?\n/).slice(start + 1);
  const end = lines.findIndex((line) => line.trim().startsWith("["));
  return (end === -1 ? lines : lines.slice(0, end)).join("\n");
}

function readTomlValue(toml: string, section: string, key: string): string {
  const value = new RegExp(`^\\s*${key}\\s*=\\s*(?<value>.+?)\\s*$`, "m").exec(
    readTomlSection(toml, section),
  )?.groups?.value;
  if (value === undefined) {
    throw new Error(`[${section}] no declara ${key}`);
  }
  return value;
}

type PackageJson = {
  readonly scripts: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};

const packageJson = JSON.parse(readRepoFile("package.json")) as PackageJson;

describe("configuración de Supabase local", () => {
  const config = readRepoFile("supabase/config.toml");

  it("sirve la API en el puerto 54321, el que acepta la guarda de entorno", () => {
    expect(readTomlValue(config, "api", "port")).toBe("54321");
  });

  it("sirve Postgres en el puerto 54322", () => {
    expect(readTomlValue(config, "db", "port")).toBe("54322");
  });

  it.each(["analytics", "edge_runtime"])(
    "apaga %s, que la app no usa, para que el stack quepa en 8 GB",
    (section) => {
      expect(readTomlValue(config, section, "enabled")).toBe("false");
    },
  );

  it("no siembra nada aparte de las migraciones: la 0001 ya crea el club", () => {
    expect(readTomlValue(config, "db.seed", "enabled")).toBe("false");
  });
});

/** Lo que una suite entera hace desde la IP del runner (#535), con margen: los
 * límites de fábrica (30 inicios de sesión cada 5 minutos) los toca a la
 * mitad y el resto falla con 429. */
const MINIMUM_AUTH_REQUESTS_PER_WINDOW = 1000;

describe("límites de Auth del Supabase local", () => {
  const config = readRepoFile("supabase/config.toml");

  it.each(["sign_in_sign_ups", "token_verifications", "token_refresh"])(
    "%s no frena a una suite entera desde una sola IP",
    (limit) => {
      const value = Number(readTomlValue(config, "auth.rate_limit", limit));

      expect(value).toBeGreaterThanOrEqual(MINIMUM_AUTH_REQUESTS_PER_WINDOW);
    },
  );

  it("avisa de que sólo afectan a los Supabase locales", () => {
    expect(readTomlSection(config, "auth.rate_limit")).toMatch(/solo|sólo/i);
  });
});

describe("scripts de la base local", () => {
  it("instala la CLI de Supabase como dependencia de desarrollo", () => {
    expect(packageJson.devDependencies.supabase).toBeDefined();
  });

  it.each([
    ["db:start", "supabase start"],
    ["db:stop", "supabase stop"],
    ["db:reset", "supabase db reset"],
  ])("%s llama a la CLI del proyecto con %s", (script, command) => {
    expect(packageJson.scripts[script]).toBe(command);
  });
});

describe("la guía de incorporación explica la base local", () => {
  const guide = readRepoFile("docs/onboarding-equipo.md");

  it.each(["npm run db:start", "npm run db:stop", "npx supabase status"])(
    "nombra %s",
    (command) => {
      expect(guide).toContain(command);
    },
  );

  it("sigue explicando cómo usar seadragons-dev", () => {
    expect(guide).toContain("seadragons-dev");
  });
});
