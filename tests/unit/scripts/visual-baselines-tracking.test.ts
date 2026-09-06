import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SNAPSHOTS_DIR = "tests/ui.spec.ts-snapshots";
const UI_SPEC_PATH = path.join(REPO_ROOT, "tests/ui.spec.ts");
const SKILL_PATH = path.join(
  REPO_ROOT,
  ".claude/skills/nextjs-supabase-practices/SKILL.md",
);

/**
 * Sólo Linux es la línea base vinculante (issue #58): CI la regenera y la
 * commitea, así que es la única que tiene sentido versionar. Windows se
 * genera en el momento localmente y nunca debe volver a colarse en un commit,
 * o el conflicto binario entre PRs paralelos que este ticket elimina vuelve.
 */
function listTrackedSnapshots(): string[] {
  const output = execFileSync("git", ["ls-files", SNAPSHOTS_DIR], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

function isIgnored(relativePath: string): boolean {
  const result = spawnGitCheckIgnore(relativePath);
  return result === 0;
}

function spawnGitCheckIgnore(relativePath: string): number {
  try {
    execFileSync("git", ["check-ignore", "--quiet", relativePath], {
      cwd: REPO_ROOT,
    });
    return 0;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return status ?? 1;
  }
}

describe("líneas base", () => {
  it("sólo versiona capturas de Linux", () => {
    const tracked = listTrackedSnapshots();

    expect(tracked.length).toBeGreaterThan(0);
    for (const file of tracked) {
      expect(file).toMatch(/-linux\.png$/);
    }
  });

  it("ignora capturas de Windows para que nadie vuelva a commitearlas", () => {
    const aWindowsCapture = `${SNAPSHOTS_DIR}/home-desktop-light-chromium-win32.png`;

    expect(isIgnored(aWindowsCapture)).toBe(true);
  });

  it("ignora también las capturas de macOS, que nadie ha generado todavía", () => {
    const aMacCapture = `${SNAPSHOTS_DIR}/home-desktop-light-chromium-darwin.png`;

    expect(isIgnored(aMacCapture)).toBe(true);
  });

  it("no ignora las capturas de Linux, que siguen siendo la línea base vinculante", () => {
    const aLinuxCapture = `${SNAPSHOTS_DIR}/home-desktop-light-chromium-linux.png`;

    expect(isIgnored(aLinuxCapture)).toBe(false);
  });

  it("el header de ui.spec.ts ya no describe el mecanismo manual que este ticket reemplaza", () => {
    const header = readFileSync(UI_SPEC_PATH, "utf8");

    expect(header).not.toMatch(/gh workflow run visual-baselines/);
    expect(header).toMatch(/visual-baselines\.yml/);
    expect(header).toMatch(/informative only|informativ/i);
  });

  it("el header no promete que el PR se autocorrija, porque ya no lo hace", () => {
    const header = readFileSync(UI_SPEC_PATH, "utf8");

    expect(header).not.toMatch(/pushes the fix/i);
    expect(header).not.toMatch(/regenerates it and/i);
    expect(header).toMatch(/only COMPARES/);
  });

  it("la skill obligatoria no le dice a un worker que acepte la línea base él solo", () => {
    const skill = readFileSync(SKILL_PATH, "utf8");

    expect(skill).toMatch(/nextjs|Next\.js/);
    expect(skill).not.toMatch(/ejecuta `gh workflow run visual-baselines/);
    expect(skill).toMatch(/No ejecutes `gh workflow run visual-baselines/);
  });
});
