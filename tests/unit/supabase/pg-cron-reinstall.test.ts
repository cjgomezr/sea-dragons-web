import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `migraciones-produccion.yml` vuelve a aplicar todo el histórico en cada
 * merge. En Supabase, cada `create extension pg_cron` dispara su event trigger
 * `grant_pg_cron_access` aunque la extensión ya esté (`if not exists` no lo
 * evita), y ese trigger falla con "dependent privileges exist" cuando los
 * permisos sobre `cron` ya están dados. Así se cayó el merge del #591 y la
 * `0063` no llegó a producción.
 *
 * El Postgres de CI no trae `pg_cron`, así que ningún test con base llega a
 * esa rama: se fija en el texto de la migración. Lo reprodujimos contra
 * `seadragons-dev`, donde la sentencia sin guarda falla igual.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/0062_schedule_nightly_cleanup.sql",
);

const EXTENSION_ALREADY_INSTALLED_GUARD =
  /not\s+exists\s*\(\s*select\s+from\s+pg_extension\s+where\s+extname\s*=\s*'pg_cron'\s*\)/i;

function readMigration(): string {
  return readFileSync(MIGRATION, "utf8");
}

/** La condición del `if` que envuelve el `create extension pg_cron`. */
function readCreateExtensionCondition(sql: string): string {
  const match =
    /\bif\s+((?:(?!\bthen\b)[\s\S])*?)\s+then\s+create\s+extension\b[^;]*pg_cron/i.exec(
      sql,
    );
  if (!match) {
    throw new Error("la migración no crea pg_cron dentro de un if");
  }
  const [, condition = ""] = match;
  return condition;
}

describe("instalar pg_cron al reaplicar la 0062", () => {
  it("sólo crea la extensión si todavía no está instalada", () => {
    const condition = readCreateExtensionCondition(readMigration());

    expect(condition).toMatch(EXTENSION_ALREADY_INSTALLED_GUARD);
  });

  it("sigue creándola sólo donde la extensión está disponible", () => {
    const condition = readCreateExtensionCondition(readMigration());

    expect(condition).toMatch(/pg_available_extensions/);
  });
});
