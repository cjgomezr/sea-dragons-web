import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `psql` dentro del contenedor de la base local, como en
 * `scripts/lib/local-db.sh`: así no hace falta instalarlo ni una dependencia
 * de npm para hablar con Postgres, y la conexión no puede salir de la
 * máquina. El nombre del contenedor lo pone la CLI de Supabase con el
 * `project_id` de `supabase/config.toml`.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const SUPABASE_CONFIG = path.join(REPO_ROOT, "supabase/config.toml");

export type PsqlOptions = {
  /** Envuelve la entrada en una transacción. Sin ella, quien llama decide. */
  readonly singleTransaction: boolean;
};

function localDatabaseContainer(): string {
  const config = readFileSync(SUPABASE_CONFIG, "utf8");
  const projectId = /^project_id = "([^"]+)"/m.exec(config)?.[1];
  if (!projectId) {
    throw new Error(`No encuentro project_id en ${SUPABASE_CONFIG}.`);
  }
  return `supabase_db_${projectId}`;
}

function psqlArguments(container: string, options: PsqlOptions): string[] {
  return [
    "exec",
    "-i",
    container,
    "psql",
    "--username=postgres",
    "--dbname=postgres",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--set=ON_ERROR_STOP=1",
    ...(options.singleTransaction ? ["--single-transaction"] : []),
    "--file=-",
  ];
}

/** Ejecuta `sql` parando en el primer error, y devuelve lo que imprime. */
export function runLocalPsql(
  sql: string,
  options: PsqlOptions,
): Promise<string> {
  const container = localDatabaseContainer();
  const psql = spawn("docker", psqlArguments(container, options));
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  psql.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  psql.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  // Si psql para en el primer error, deja de leer y escribirle el resto da
  // EPIPE. Ese fallo no dice nada: el que importa llega con `close`.
  psql.stdin.on("error", () => undefined);
  psql.stdin.end(sql);
  return new Promise((resolve, reject) => {
    psql.on("error", (error) =>
      reject(new Error(`No se pudo lanzar docker: ${error.message}`)),
    );
    psql.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const errors = Buffer.concat(stderr).toString("utf8");
      reject(
        new Error(
          `psql terminó con código ${code} en ${container}.\n${errors}`,
        ),
      );
    });
  });
}
