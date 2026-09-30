import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_PROJECT_REF,
} from "@/lib/supabase/environment-guard";
import {
  DEFAULT_SCHEMA,
  type FakeLocalDb,
  REPO_ROOT,
  installFakeLocalDb,
} from "../../support/fake-local-db";

const SCRIPT = "scripts/copy-dev-to-local.sh";
const LOCAL_DB_LIB = "scripts/lib/local-db.sh";
const DEV_PASSWORD = "contrasena-de-dev";
const POOLER_HOST = "aws-0-ap-southeast-2.pooler.supabase.com";

function poolerUrl(ref: string): string {
  return `postgresql://postgres.${ref}:${DEV_PASSWORD}@${POOLER_HOST}:5432/postgres`;
}

const DEV_URL = poolerUrl(DEVELOPMENT_SUPABASE_PROJECT_REF);
const BACKUP_FILE = path.join(".factory", "db-backup", "data.sql");

const RESTORE_ERROR = [
  'psql:<stdin>:12: ERROR:  column "nickname" of relation "members" does not exist',
  'LINE 1: INSERT INTO "public"."members" ("id", "nickname") VALUES',
  "",
].join("\n");

let fake: FakeLocalDb | undefined;

/** `null` es "sin SUPABASE_DEV_DB_URL"; sin argumento, la de desarrollo. */
async function setup(devUrl: string | null = DEV_URL): Promise<FakeLocalDb> {
  fake = await installFakeLocalDb(devUrl ?? undefined);
  return fake;
}

afterEach(async () => {
  if (fake) {
    await rm(fake.workDir, { recursive: true, force: true });
    fake = undefined;
  }
});

function writingCalls(calls: readonly string[]): string[] {
  return calls.filter(
    (call) => call.includes("db dump") || call.includes("--single-transaction"),
  );
}

describe("copy-dev-to-local.sh · sin --yes", () => {
  it("dice qué vacía, de dónde copia y dónde respalda, y no llama a nada", async () => {
    const db = await setup();

    const { code, stdout } = await db.run(SCRIPT, []);

    expect(code).toBe(0);
    expect(stdout).toContain("127.0.0.1:54322");
    expect(stdout).toContain(POOLER_HOST);
    expect(stdout).toContain(".factory/db-backup");
    expect(stdout).toContain("--yes");
    expect(await db.calls()).toEqual([]);
  });

  it("lee SUPABASE_DEV_DB_URL de .env.local cuando no está en el entorno", async () => {
    const db = await setup(null);
    await writeFile(
      path.join(db.workDir, ".env.local"),
      `OTRA=1\nSUPABASE_DEV_DB_URL="${DEV_URL}"\n`,
    );

    const { code, stdout } = await db.run(SCRIPT, []);

    expect(code).toBe(0);
    expect(stdout).toContain(POOLER_HOST);
  });

  it("acepta la conexión directa de seadragons-dev además del pooler", async () => {
    const db = await setup(
      `postgresql://postgres:${DEV_PASSWORD}@db.${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`,
    );

    const { code } = await db.run(SCRIPT, []);

    expect(code).toBe(0);
  });

  it("nunca imprime la contraseña de la conexión", async () => {
    const db = await setup();

    const { stdout, stderr } = await db.run(SCRIPT, []);

    expect(stdout + stderr).not.toContain(DEV_PASSWORD);
  });
});

describe("copy-dev-to-local.sh · protecciones", () => {
  it("se niega a copiar desde producción y lo nombra, sin volcar nada", async () => {
    const db = await setup(poolerUrl(PRODUCTION_SUPABASE_PROJECT_REF));

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain(PRODUCTION_SUPABASE_PROJECT_REF);
    expect(stderr).toMatch(/PRODUCCIÓN/);
    expect(stderr).not.toContain(DEV_PASSWORD);
    expect(await db.calls()).toEqual([]);
  });

  it("se niega a copiar desde un proyecto desconocido y nombra el que encontró", async () => {
    const db = await setup(poolerUrl("abcdefghijklmnopqrst"));

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("abcdefghijklmnopqrst");
    expect(await db.calls()).toEqual([]);
  });

  it("se niega cuando el origen no es un proyecto de Supabase y nombra el host", async () => {
    const db = await setup(
      "postgresql://postgres:x@db.example.com:5432/postgres",
    );

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("db.example.com");
    expect(await db.calls()).toEqual([]);
  });

  it.each([
    [
      "otro host",
      "postgresql://postgres:postgres@db.example.com:54322/postgres",
    ],
    ["otro puerto", "postgresql://postgres:postgres@127.0.0.1:5432/postgres"],
  ])("se niega cuando el destino no es la base local (%s)", async (_, url) => {
    const db = await setup();
    db.env.SUPABASE_LOCAL_DB_URL = url;

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/54322/);
    expect(await db.calls()).toEqual([]);
  });

  it("acepta localhost:54322 como destino", async () => {
    const db = await setup();
    db.env.SUPABASE_LOCAL_DB_URL =
      "postgresql://postgres:postgres@localhost:54322/postgres";

    const { code } = await db.run(SCRIPT, []);

    expect(code).toBe(0);
  });

  it("sin SUPABASE_DEV_DB_URL dice qué falta y de dónde sale", async () => {
    const db = await setup(null);

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("SUPABASE_DEV_DB_URL");
    expect(stderr).toContain(".env.local");
    expect(stderr).toMatch(/Session pooler/);
    expect(await db.calls()).toEqual([]);
  });

  it("con el stack local apagado dice cómo arrancarlo y no vuelca nada", async () => {
    const db = await setup();
    await db.setFixture("status.exit", "1");

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("npm run db:start");
    expect(writingCalls(await db.calls())).toEqual([]);
  });

  it("no escribe los refs de los proyectos a mano: los lee del guardia de entorno", async () => {
    const sources = await Promise.all(
      [SCRIPT, LOCAL_DB_LIB].map((file) =>
        readFile(path.join(REPO_ROOT, file), "utf8"),
      ),
    );
    const combined = sources.join("\n");

    expect(combined).not.toContain(DEVELOPMENT_SUPABASE_PROJECT_REF);
    expect(combined).not.toContain(PRODUCTION_SUPABASE_PROJECT_REF);
    expect(combined).toContain("environment-guard.ts");
  });
});

describe("copy-dev-to-local.sh · esquema", () => {
  it("copia cuando los dos esquemas son iguales", async () => {
    const db = await setup();

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    expect(await db.restoreInput()).toContain("-- volcado dev");
  });

  it("copia cuando la base local va por delante (repositorio-por-delante)", async () => {
    const db = await setup();
    await db.setFixture(
      "schema-local.txt",
      `${DEFAULT_SCHEMA}table public.tabla_nueva\n`,
    );

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    expect(await db.restoreInput()).toContain("-- volcado dev");
  });

  it("no cuenta como esquema de desarrollo la función que Supabase instala sola en los proyectos alojados", async () => {
    const db = await setup();
    await db.setFixture(
      "schema-dev.txt",
      `${DEFAULT_SCHEMA}funcion rls_auto_enable()\n`,
    );

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    expect(await db.restoreInput()).toContain("-- volcado dev");
  });

  it.each([
    [
      "base-por-delante",
      DEFAULT_SCHEMA,
      `${DEFAULT_SCHEMA}table public.solo_dev\n`,
    ],
    [
      "divergieron",
      `${DEFAULT_SCHEMA}table public.solo_local\n`,
      `${DEFAULT_SCHEMA}table public.solo_dev\n`,
    ],
  ])(
    "se detiene antes de respaldar y restaurar cuando el estado es %s",
    async (state, local, dev) => {
      const db = await setup();
      await db.setFixture("schema-local.txt", local);
      await db.setFixture("schema-dev.txt", dev);

      const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

      expect(code).not.toBe(0);
      expect(stderr).toContain(state);
      expect(stderr).toContain("main");
      expect(stderr).toContain("npm run db:reset");
      expect(writingCalls(await db.calls())).toEqual([]);
    },
  );
});

describe("copy-dev-to-local.sh · respaldo", () => {
  it("guarda public y auth de la base local en .factory/db-backup, reemplazando el anterior", async () => {
    const db = await setup();
    await mkdir(path.join(db.workDir, ".factory", "db-backup"), {
      recursive: true,
    });
    await writeFile(path.join(db.workDir, BACKUP_FILE), "respaldo viejo");

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    const backup = await readFile(path.join(db.workDir, BACKUP_FILE), "utf8");
    expect(backup).toContain("-- volcado local");
    expect(backup).not.toContain("respaldo viejo");
    const backupCall = (await db.calls()).find((call) =>
      call.includes("--local"),
    );
    expect(backupCall).toMatch(/db dump/);
    expect(backupCall).toContain("--data-only");
    expect(backupCall).toContain("--schema public,auth");
  });

  it("si el respaldo falla, se detiene sin vaciar la base local y conserva el anterior", async () => {
    const db = await setup();
    await mkdir(path.join(db.workDir, ".factory", "db-backup"), {
      recursive: true,
    });
    await writeFile(path.join(db.workDir, BACKUP_FILE), "respaldo viejo");
    await db.setFixture("backup.exit", "1");

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/respaldo/);
    expect(await db.restoreInput()).toBe("");
    expect(await readFile(path.join(db.workDir, BACKUP_FILE), "utf8")).toBe(
      "respaldo viejo",
    );
  });

  it(".factory/db-backup/ está ignorado por git", () => {
    const run = (): string =>
      execFileSync("git", ["check-ignore", ".factory/db-backup/data.sql"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

    expect(run).not.toThrow();
  });
});

describe("copy-dev-to-local.sh · restauración", () => {
  it("camino feliz: respalda, vuelca sólo datos de public y auth, vacía y restaura en una transacción", async () => {
    const db = await setup();

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    const calls = await db.calls();
    const backupIndex = calls.findIndex((call) => call.includes("--local"));
    const devDumpIndex = calls.findIndex((call) => call.includes("--db-url"));
    const restoreIndex = calls.findIndex((call) =>
      call.includes("--single-transaction"),
    );
    expect(backupIndex).toBeGreaterThanOrEqual(0);
    expect(devDumpIndex).toBeGreaterThan(backupIndex);
    expect(restoreIndex).toBeGreaterThan(devDumpIndex);
    expect(calls[devDumpIndex]).toContain("--data-only");
    expect(calls[devDumpIndex]).toContain("--schema public,auth");
    expect(calls[restoreIndex]).toContain("127.0.0.1:54322");
    expect(calls[restoreIndex]).toContain("ON_ERROR_STOP=1");

    const input = await db.restoreInput();
    expect(input).toMatch(/session_replication_role = replica/);
    expect(input).toMatch(/truncate/i);
    expect(input).toContain("'public'");
    expect(input).toContain("'auth'");
    expect(input.search(/truncate/i)).toBeLessThan(
      input.indexOf("-- volcado dev"),
    );
  });

  it("vuelca desarrollo fuera del repositorio y borra el archivo al terminar", async () => {
    const db = await setup();

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    const devDump = await db.dumpFile("dev");
    expect(path.resolve(devDump).startsWith(path.resolve(db.workDir))).toBe(
      false,
    );
    expect(existsSync(devDump)).toBe(false);
  });

  it("si la restauración falla, sale con error, nombra la tabla y borra el volcado igual", async () => {
    const db = await setup();
    await db.setFixture("restore.exit", "3");
    await db.setFixture("restore.stderr", RESTORE_ERROR);

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("public.members");
    expect(stderr).toMatch(/como estaba/);
    expect(existsSync(await db.dumpFile("dev"))).toBe(false);
  });

  it("nombra la tabla aunque el error sólo traiga la relación", async () => {
    const db = await setup();
    await db.setFixture("restore.exit", "3");
    await db.setFixture(
      "restore.stderr",
      'psql:<stdin>:9: ERROR:  null value in column "club_id" of relation "groups" violates not-null constraint\n',
    );

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("groups");
  });
});
