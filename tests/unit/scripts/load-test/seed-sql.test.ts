import { describe, expect, it } from "vitest";
import {
  generateSeedDataset,
  LOAD_TEST_PASSWORD,
} from "../../../../scripts/load-test/seed-dataset";
import {
  INSERT_BATCH_SIZE,
  renderSeedSql,
} from "../../../../scripts/load-test/seed-sql";

const dataset = generateSeedDataset({ seed: 524, anchorDate: "2026-10-08" });
const sql = renderSeedSql(dataset);

function countOccurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

describe("renderSeedSql", () => {
  it("refuses a database that already has members before inserting", () => {
    const check = sql.indexOf("if exists (select 1 from public.members)");
    const firstInsert = sql.indexOf("insert into");

    expect(check).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(firstInsert);
  });

  it("inserts attendance in batches instead of row by row", () => {
    const statements = countOccurrences(
      sql,
      "insert into public.attendance_records",
    );

    expect(statements).toBe(
      Math.ceil(dataset.attendance.length / INSERT_BATCH_SIZE),
    );
  });

  it("hashes the known password once, only for identities that sign in", () => {
    expect(countOccurrences(sql, `'${LOAD_TEST_PASSWORD}'`)).toBe(1);
    expect(sql).toContain("case when v.can_sign_in::boolean then");
  });

  it("escapes quotes inside values", () => {
    const quoted = generateSeedDataset({ seed: 524, anchorDate: "2026-10-08" });
    const withQuote = {
      ...quoted,
      members: quoted.members.map((member, index) =>
        index === 0 ? { ...member, fullName: "Siobhan O'Brien" } : member,
      ),
    };

    expect(renderSeedSql(withQuote)).toContain("'Siobhan O''Brien'");
  });
});
