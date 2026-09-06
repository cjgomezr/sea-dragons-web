import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Los documentos que gobiernan a un worker: si uno de ellos le dice que
 * guarde la línea base, el mecanismo de aceptación humana deja de valer nada
 * por muy bien construido que esté el workflow (#58). Ya pasó dos veces, en
 * la skill de Next y en la definición del ui-reviewer, y ninguna de las dos
 * la atrapó un test de frase literal.
 */
const GOVERNED_DIRS = [
  ".claude/skills",
  ".claude/agents",
  "user-level/agents",
];
const GOVERNED_FILES = ["CLAUDE.md", "GUIA-DE-LA-FABRICA.md"];

/** Un texto que menciona la línea base junto a un verbo de escritura. */
const MENTIONS_BASELINE = /baseline|l[ií]nea[s]? base/i;
const WRITES_IT =
  /\b(save|saving|commit|commits|committing|commitea|commitéalas|guarda|acepta|ejecuta|genera|run)\w*/i;

/**
 * Las únicas menciones que pueden emparejar línea base con un verbo de
 * escritura, cada una con su motivo. Cualquier otra es un hallazgo que
 * alguien tiene que mirar a mano, no algo que este test deba decidir.
 */
const ALLOWED: ReadonlyArray<{ file: string; contains: string }> = [
  // El commit inicial de un proyecto: no hay PR ni historia contra la que
  // comparar todavía, y alguien tiene que crear la primera.
  { file: ".claude/skills/bootstrap/SKILL.md", contains: "Genera las líneas base visuales" },
  { file: ".claude/skills/bootstrap/SKILL.md", contains: "commitéalas" },
  { file: ".claude/skills/bootstrap/SKILL.md", contains: "ninguna línea base se guarda a mano" },
  // La prohibición explícita: menciona el verbo justamente para negarlo.
  { file: ".claude/skills/nextjs-supabase-practices/SKILL.md", contains: "la acepta una persona" },
  { file: ".claude/skills/nextjs-supabase-practices/SKILL.md", contains: "No ejecutes" },
  { file: ".claude/skills/nextjs-supabase-practices/SKILL.md", contains: "comando es el que ACEPTA" },
  { file: ".claude/agents/ui-reviewer.md", contains: "is the exact loop" },
  { file: "user-level/agents/ui-reviewer.md", contains: "is the exact loop" },
];

function collectDocs(): string[] {
  const found: string[] = [];
  for (const dir of GOVERNED_DIRS) {
    const absolute = path.join(REPO_ROOT, dir);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { recursive: true })) {
      const relative = path.join(dir, String(entry)).split(path.sep).join("/");
      if (relative.endsWith(".md")) found.push(relative);
    }
  }
  for (const file of GOVERNED_FILES) {
    if (existsSync(path.join(REPO_ROOT, file))) found.push(file);
  }
  return found;
}

function isAllowed(file: string, line: string): boolean {
  return ALLOWED.some(
    (entry) => entry.file === file && line.includes(entry.contains),
  );
}

function findUnreviewedInstructions(): string[] {
  const offenders: string[] = [];
  for (const file of collectDocs()) {
    const contents = readFileSync(path.join(REPO_ROOT, file), "utf8");
    contents.split("\n").forEach((line, index) => {
      if (!MENTIONS_BASELINE.test(line) || !WRITES_IT.test(line)) return;
      if (isAllowed(file, line)) return;
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return offenders;
}

describe("doctrina de la línea base visual", () => {
  it("mira de verdad los documentos que gobiernan al worker", () => {
    const docs = collectDocs();

    expect(docs).toContain(".claude/agents/ui-reviewer.md");
    expect(docs).toContain("user-level/agents/ui-reviewer.md");
    expect(docs).toContain(
      ".claude/skills/nextjs-supabase-practices/SKILL.md",
    );
    expect(docs).toContain("CLAUDE.md");
  });

  it("ningún documento le dice a un worker que guarde la línea base", () => {
    expect(findUnreviewedInstructions()).toEqual([]);
  });
});
