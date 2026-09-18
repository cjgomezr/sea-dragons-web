import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENTORNOS_DOC_PATH = "docs/entornos.md";
const FIRST_ADMIN_HEADING = "## El primer Admin del club";

// El correo de ejemplo tiene que ser de un dominio reservado para ejemplos
// (RFC 2606): la sentencia se copia y se pega, y un correo real en el ejemplo
// acabaría convertido en Admin por accidente.
const EXAMPLE_EMAIL_PATTERN = /[\w.+-]+@example\.com/;
const ANY_EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function readFirstAdminSection(): string {
  const doc = readFileSync(ENTORNOS_DOC_PATH, "utf-8");
  const start = doc.indexOf(FIRST_ADMIN_HEADING);
  if (start === -1) {
    throw new Error(`${ENTORNOS_DOC_PATH} no tiene "${FIRST_ADMIN_HEADING}"`);
  }
  return doc.slice(start + FIRST_ADMIN_HEADING.length).split(/^## /m)[0] ?? "";
}

function readSqlBlocks(section: string): string[] {
  return [...section.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map(
    (match) => match[1] ?? "",
  );
}

function findPromotionStatement(section: string): string {
  const statement = readSqlBlocks(section).find((sql) =>
    /update\s+public\.members/i.test(sql),
  );
  if (statement === undefined) {
    throw new Error("la sección no tiene un `update public.members`");
  }
  return statement;
}

describe("documentación del primer Admin", () => {
  it("existe como sección de docs/entornos.md", () => {
    expect(() => readFirstAdminSection()).not.toThrow();
  });

  it("su sentencia pone role = 'Admin' en public.members filtrando por correo", () => {
    const statement = findPromotionStatement(readFirstAdminSection());

    expect(statement).toMatch(/set\s+role\s*=\s*'Admin'/i);
    expect(statement).toMatch(/where[\s\S]*\bemail\s*=\s*'[^']+'/i);
  });

  it("la sentencia solo toca una cuenta activa", () => {
    const statement = findPromotionStatement(readFirstAdminSection());

    expect(statement).toMatch(/account_status\s*=\s*'active'/i);
  });

  it("enseña a comprobar antes que el correo es de una cuenta activa", () => {
    const checks = readSqlBlocks(readFirstAdminSection()).filter((sql) =>
      /^\s*select\b/i.test(sql),
    );

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.join("\n")).toMatch(/account_status/i);
  });

  it("usa solo correos de ejemplo, nunca datos reales", () => {
    const section = readFirstAdminSection();
    const emails = section.match(ANY_EMAIL_PATTERN) ?? [];

    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email).toMatch(EXAMPLE_EMAIL_PATTERN);
    }
  });

  it("dice dónde se ejecuta: el SQL Editor de cada proyecto", () => {
    const section = readFirstAdminSection();

    expect(section).toContain("SQL Editor");
    expect(section).toContain("seadragons-dev");
    expect(section).toContain("seadragons-prod");
  });

  it("avisa que es un acto manual y único", () => {
    const section = readFirstAdminSection();

    expect(section).toMatch(/manual/i);
    expect(section).toMatch(/una sola vez/i);
  });

  it("dice que los demás Admin se nombran desde la aplicación", () => {
    expect(readFirstAdminSection()).toMatch(/desde la aplicación/i);
  });

  it("avisa que el cambio a mano no queda en la bitácora", () => {
    const section = readFirstAdminSection();

    expect(section).toMatch(/bitácora/i);
    expect(section).toContain("audit_log");
  });
});
