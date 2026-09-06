import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Los documentos que gobiernan a un worker: si uno le dice que guarde la
 * línea base, el mecanismo de aceptación humana deja de valer nada por muy
 * bien construido que esté el workflow (#58). Ya pasó dos veces, en la skill
 * de Next y en la definición del ui-reviewer, y ninguna de las dos la atrapó
 * un test de frase literal.
 */
const GOVERNED_DIRS = [".claude/skills", ".claude/agents", "user-level/agents"];
const GOVERNED_FILES = ["CLAUDE.md", "GUIA-DE-LA-FABRICA.md"];

/**
 * Se normaliza el archivo entero y se parte en frases, no en líneas: estos
 * documentos se envuelven a 80 columnas, así que una frase partida en dos
 * escondería la mitad de la señal de un escaneo línea a línea. La frase es
 * además la unidad natural de una instrucción, así que una mención suelta en
 * un párrafo ajeno no arrastra consigo texto que nadie necesita revisar.
 */
const MENTIONS_BASELINE =
  /baseline|l[ií]nea[s]? base|toHaveScreenshot|ui\.spec\.ts-snapshots/i;
const WRITES_IT =
  /\b(save|saves|saving|write|writes|writing|overwrit\w*|commit\w*|push\w*|update\w*|guarda\w*|commitea\w*|commitéalas|escrib\w+|coloca\w*|sube|subir|actualiza\w*|reemplaza\w*|sobrescrib\w+|acepta\w*|ejecuta\w*|genera\w*|corre)\b/i;

/**
 * Las únicas frases que pueden emparejar la línea base con un verbo de
 * escritura. Se fija la frase COMPLETA y normalizada, no un fragmento: con un
 * `includes` bastaría añadir "salvo que..." al final de una frase ya aprobada
 * para invertir su sentido sin que el test se enterara.
 */
const ALLOWED_SENTENCES: readonly string[] = [
  // Bootstrap: el commit inicial del proyecto, cuando no hay PR ni historia
  // contra la que comparar y alguien tiene que crear la primera.
  "Genera las líneas base visuales (`npx playwright test --update-snapshots`) y commitéalas: si no, el Stop gate del primer ticket falla por baselines faltantes.",
  // Bootstrap: la frase que acota lo anterior al commit inicial.
  "De ahí en adelante ninguna línea base se guarda a mano: los cambios pasan por `visual-baselines.yml`, que compara en cada PR y deja que una persona acepte la nueva.",
  // La prohibición de la skill: nombra la aceptación para negársela al worker.
  "**La línea base visual la acepta una persona, nunca tú.** Sólo se versiona la de Linux (`-linux`); las demás son informativas y están ignoradas.",
  // La prohibición de la skill: explica por qué ese comando no es para él.
  "Ese comando es el que ACEPTA la línea base nueva, y aceptarla sin haber mirado el diff es exactamente lo que la regresión visual existe para impedir: darías por bueno cualquier píxel que estuviera renderizando en ese momento.",
  // ui-reviewer: niega explícitamente la autorización a escribir.
  "It does NOT authorise anyone to write them into `tests/ui.spec.ts-snapshots/`.",
  // ui-reviewer: nombra el bucle que el gate existe para romper.
  "An agent approving its own pixels and then saving them as the baseline is the exact loop the visual gate exists to break.",
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

function sentencesOf(file: string): string[] {
  const contents = readFileSync(path.join(REPO_ROOT, file), "utf8");
  return contents
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function findUnreviewedInstructions(): string[] {
  const offenders: string[] = [];
  for (const file of collectDocs()) {
    for (const sentence of sentencesOf(file)) {
      if (!MENTIONS_BASELINE.test(sentence)) continue;
      if (!WRITES_IT.test(sentence)) continue;
      if (ALLOWED_SENTENCES.includes(sentence)) continue;
      offenders.push(`${file} :: ${sentence}`);
    }
  }
  return offenders;
}

describe("doctrina de la línea base visual", () => {
  it("mira de verdad los documentos que gobiernan al worker", () => {
    const docs = collectDocs();

    expect(docs).toContain(".claude/agents/ui-reviewer.md");
    expect(docs).toContain("user-level/agents/ui-reviewer.md");
    expect(docs).toContain(".claude/skills/nextjs-supabase-practices/SKILL.md");
    expect(docs).toContain("CLAUDE.md");
  });

  it("ningún documento le dice a un worker que guarde la línea base", () => {
    expect(findUnreviewedInstructions()).toEqual([]);
  });
});
