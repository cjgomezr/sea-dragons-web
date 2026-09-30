import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeLocalDb,
  installFakeLocalDb,
} from "../../support/fake-local-db";

const SCRIPT = "scripts/restore-local-backup.sh";
const BACKUP_CONTENT =
  '-- respaldo guardado\nINSERT INTO "public"."members" ("id") VALUES (7);\n';

let fake: FakeLocalDb | undefined;

async function setup(options: { withBackup: boolean }): Promise<FakeLocalDb> {
  fake = await installFakeLocalDb(undefined);
  if (options.withBackup) {
    const backupDir = path.join(fake.workDir, ".factory", "db-backup");
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, "data.sql"), BACKUP_CONTENT);
  }
  return fake;
}

afterEach(async () => {
  if (fake) {
    await rm(fake.workDir, { recursive: true, force: true });
    fake = undefined;
  }
});

describe("restore-local-backup.sh", () => {
  it("sin --yes dice qué va a hacer y no llama a nada", async () => {
    const db = await setup({ withBackup: true });

    const { code, stdout } = await db.run(SCRIPT, []);

    expect(code).toBe(0);
    expect(stdout).toContain("127.0.0.1:54322");
    expect(stdout).toContain(".factory/db-backup");
    expect(stdout).toContain("--yes");
    expect(await db.calls()).toEqual([]);
  });

  it("sin respaldo lo dice y termina sin tocar nada", async () => {
    const db = await setup({ withBackup: false });

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/no hay respaldo/i);
    expect(await db.calls()).toEqual([]);
  });

  it("se niega cuando el destino no es la base local", async () => {
    const db = await setup({ withBackup: true });
    db.env.SUPABASE_LOCAL_DB_URL =
      "postgresql://postgres:postgres@db.example.com:5432/postgres";

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("db.example.com");
    expect(await db.calls()).toEqual([]);
  });

  it("con el stack local apagado dice cómo arrancarlo y no restaura", async () => {
    const db = await setup({ withBackup: true });
    await db.setFixture("status.exit", "1");

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("npm run db:start");
    expect(await db.restoreInput()).toBe("");
  });

  it("camino feliz: vacía y restaura el respaldo en una transacción", async () => {
    const db = await setup({ withBackup: true });

    const { code } = await db.run(SCRIPT, ["--yes"]);

    expect(code).toBe(0);
    const restoreCall = (await db.calls()).find((call) =>
      call.includes("--single-transaction"),
    );
    expect(restoreCall).toContain("supabase_db_sea-dragons-web");
    expect(restoreCall).toContain("[target 127.0.0.1:5432]");
    const input = await db.restoreInput();
    expect(input).toMatch(/truncate/i);
    expect(input.search(/truncate/i)).toBeLessThan(
      input.indexOf("-- respaldo guardado"),
    );
  });

  it("si la restauración falla, sale con error y nombra la tabla", async () => {
    const db = await setup({ withBackup: true });
    await db.setFixture("restore.exit", "3");
    await db.setFixture(
      "restore.stderr",
      'psql:<stdin>:4: ERROR:  column "x" of relation "members" does not exist\nLINE 1: INSERT INTO "public"."members" ("id", "x") VALUES\n',
    );

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("public.members");
  });

  it("si psql ni siquiera llega a correr, muestra la causa y no inventa una tabla", async () => {
    const db = await setup({ withBackup: true });
    const dockerError =
      "Error response from daemon: container supabase_db_sea-dragons-web is not running";
    await db.setFixture("restore.exit", "1");
    await db.setFixture("restore.stderr", `${dockerError}\n`);

    const { code, stderr } = await db.run(SCRIPT, ["--yes"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain(dockerError);
    expect(stderr).not.toContain("tabla desconocida");
  });
});
