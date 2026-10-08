import { SUPABASE_URL_ENV } from "../../src/lib/supabase/config";
import { generateSeedDataset } from "./seed-dataset";
import { checkSeedTarget } from "./seed-guard";
import { renderSeedSql } from "./seed-sql";

/** La semilla del dataset: siempre la misma, para que dos sembrados den el
 * mismo club. 8008 por NFR-008. */
export const DATASET_SEED = 8008;

/** Para reproducir un sembrado de otro día con las mismas fechas. */
export const ANCHOR_DATE_ENV = "SEED_ANCHOR_DATE";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Environment = Readonly<Record<string, string | undefined>>;

export type SeedDependencies = {
  readonly env: Environment;
  /** Hoy en Melbourne, `YYYY-MM-DD`. */
  readonly today: () => string;
  /** Ejecuta el SQL entero en una transacción y devuelve lo que imprime. */
  readonly runSql: (sql: string) => Promise<string>;
  readonly log: (line: string) => void;
};

export type SeedOutcome =
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "seeded"; readonly anchorDate: string };

/** La vuelta completa descarta fechas como el 30 de febrero, que `Date`
 * acepta y convierte en marzo sin avisar. */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Comprueba el destino y la fecha antes de generar nada, y sólo entonces
 * escribe: una negativa nunca llega a `runSql`. */
export async function runSeed(
  dependencies: SeedDependencies,
): Promise<SeedOutcome> {
  const target = checkSeedTarget(dependencies.env[SUPABASE_URL_ENV]);
  if (target.kind === "refused") {
    return target;
  }
  const anchorDate =
    dependencies.env[ANCHOR_DATE_ENV]?.trim() || dependencies.today();
  if (!isValidIsoDate(anchorDate)) {
    return {
      kind: "refused",
      message: `${ANCHOR_DATE_ENV} tiene que ser una fecha YYYY-MM-DD, y vale "${anchorDate}". No se escribe nada.`,
    };
  }
  dependencies.log(
    `Sembrando el club de NFR-008 con fecha de anclaje ${anchorDate}…`,
  );
  const sql = renderSeedSql(
    generateSeedDataset({ seed: DATASET_SEED, anchorDate }),
  );
  dependencies.log(await dependencies.runSql(sql));
  return { kind: "seeded", anchorDate };
}
