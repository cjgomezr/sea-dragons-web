import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PRD_PATH = "docs/prd/e2-autenticacion-cuentas.md";
const DOMAIN_QUESTION_HEADING = "**¿Compra el club un dominio propio?**";

/** El punto de la sección 9 que pregunta por el dominio, hasta el siguiente. */
function readDomainQuestion(): string {
  const prd = readFileSync(PRD_PATH, "utf-8");
  const start = prd.indexOf(DOMAIN_QUESTION_HEADING);
  if (start < 0) {
    throw new Error(`${PRD_PATH} ya no pregunta por el dominio propio`);
  }
  const lineStart = prd.lastIndexOf("\n", start) + 1;
  const next = prd.indexOf("\n- [", start);
  // El formateador parte los párrafos por donde le cabe, así que el texto se
  // compara con los espacios aplanados.
  return prd.slice(lineStart, next < 0 ? undefined : next).replace(/\s+/g, " ");
}

describe("PRD de E2 · la pregunta del dominio (issue #137)", () => {
  // El remitente prestado resuelve el correo, no la pregunta: el club sigue
  // sin dominio propio y quien lea el PRD tiene que verlo abierto.
  it("sigue abierta", () => {
    expect(readDomainQuestion()).toMatch(/^- \[ \] /);
  });

  it("dice que ya no bloquea el ticket del correo, y por qué", () => {
    const question = readDomainQuestion();

    expect(question).toContain("volleytip.com");
    expect(question).toMatch(/ya no bloquea/i);
    expect(question).toContain("EMAIL_FROM");
  });
});
