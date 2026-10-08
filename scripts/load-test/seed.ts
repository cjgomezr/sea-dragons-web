import { runLocalPsql } from "./local-database";
import { runSeed } from "./seed-runner";

/**
 * `npm run db:seed-load-test`: siembra el club de NFR-008 en el Supabase
 * local (#524). Sobre una base recién levantada (`npm run db:reset`), nunca
 * sobre una con socios: el propio SQL se niega. Todo va en una transacción:
 * si algo falla, la base queda como estaba.
 */

const CLUB_TIME_ZONE = "Australia/Melbourne";

function todayInMelbourne(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE }).format(
    new Date(),
  );
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const outcome = await runSeed({
    env: process.env,
    today: todayInMelbourne,
    runSql: (sql) => runLocalPsql(sql, { singleTransaction: true }),
    log: (line) => console.log(line),
  });
  if (outcome.kind === "refused") {
    console.error(`error: ${outcome.message}`);
    process.exitCode = 1;
    return;
  }
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`Sembrado en ${seconds} s.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
