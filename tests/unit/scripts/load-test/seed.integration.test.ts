import { describe, expect, it } from "vitest";
import { runLocalPsql } from "../../../../scripts/load-test/local-database";
import {
  generateSeedDataset,
  LOGIN_IDENTITY_COUNT,
} from "../../../../scripts/load-test/seed-dataset";
import { DATASET_SEED } from "../../../../scripts/load-test/seed-runner";
import { renderSeedSql } from "../../../../scripts/load-test/seed-sql";

/**
 * El sembrado de NFR-008 contra un Supabase local de verdad (#524). Corre
 * dentro de una transacción que se deshace al final: deja la base local como
 * estaba.
 *
 * Necesita el Supabase local arrancado (`npm run db:start`) y vacío de
 * socios, así que no basta con `RUN_INTEGRATION_TESTS=1`: CI corre los de
 * integración contra seadragons-dev, sin Supabase local. Se enciende con
 * `LOAD_TEST_LOCAL_SUPABASE=1`, que pondrá la épica de CI con su propio
 * Supabase cuando exista.
 */
const isEnabled = process.env.LOAD_TEST_LOCAL_SUPABASE === "1";

/** RF-6: el sembrado entero tarda menos de 5 minutos. */
const SEED_TIME_LIMIT_MS = 5 * 60_000;

const COUNTS_MARKER = "RECUENTOS:";

const COUNTS_QUERY = `select '${COUNTS_MARKER}' || json_build_object(
  'members', (select count(*) from public.members),
  'events', (select count(*) from public.events),
  'attendance', (select count(*) from public.attendance_records),
  'futureAttendance', (select count(*) from public.attendance_records a
    join public.events e on e.id = a.event_id where e.starts_at > now()),
  'signInIdentities', (select count(*) from auth.users
    where encrypted_password is not null),
  'groups', (select count(*) from public.groups),
  'rsvps', (select count(*) from public.event_rsvps),
  'newsPosts', (select count(*) from public.news_posts),
  'notifications', (select count(*) from public.notifications),
  'ratings', (select count(*) from public.member_evaluation_ratings),
  'memberships', (select count(*) from public.memberships)
)::text;`;

type Counts = Record<string, number>;

function parseCounts(output: string): Counts {
  const line = output
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text.startsWith(COUNTS_MARKER));
  if (!line) {
    throw new Error(`psql no imprimió los recuentos. Salida:\n${output}`);
  }
  return JSON.parse(line.slice(COUNTS_MARKER.length)) as Counts;
}

function todayInMelbourne(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
  }).format(new Date());
}

describe.skipIf(!isEnabled)("seed against the local Supabase", () => {
  it(
    "leaves the NFR-008 counts in under five minutes",
    async () => {
      const dataset = generateSeedDataset({
        seed: DATASET_SEED,
        anchorDate: todayInMelbourne(),
      });
      const sql = `begin;\n${renderSeedSql(dataset)}\n${COUNTS_QUERY}\nrollback;`;
      const startedAt = Date.now();

      const counts = parseCounts(
        await runLocalPsql(sql, { singleTransaction: false }),
      );

      expect(Date.now() - startedAt).toBeLessThan(SEED_TIME_LIMIT_MS);
      expect(counts).toMatchObject({
        members: dataset.members.length,
        events: dataset.events.length,
        attendance: dataset.attendance.length,
        futureAttendance: 0,
        signInIdentities: LOGIN_IDENTITY_COUNT,
        groups: dataset.groups.length,
        rsvps: dataset.rsvps.length,
        newsPosts: dataset.newsPosts.length,
        notifications: dataset.notifications.length,
        memberships: dataset.memberships.length,
      });
      expect(counts.ratings).toBeGreaterThan(0);
    },
    SEED_TIME_LIMIT_MS,
  );
});
