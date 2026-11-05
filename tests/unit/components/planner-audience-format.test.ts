import { describe, expect, it } from "vitest";
import {
  conflictsConfirmText,
  cycleAudienceLabel,
} from "@/components/training/planner-format";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Cómo dice Planificar para quién es un ciclo y qué se archiva al activarlo
 * (#980, RF-5 y D9 del PRD de E38), en los dos idiomas.
 */

const english = createTranslator("en");
const spanish = createTranslator("es");

const JUNIORS = { id: "g1", name: "Juniors" };
const MASTERS = { id: "g2", name: "Masters" };

describe("cycleAudienceLabel", () => {
  it("dice Whole club de un ciclo de todo el club", () => {
    expect(cycleAudienceLabel(english, { kind: "club" })).toBe("Whole club");
  });

  it("dice los nombres de sus grupos", () => {
    expect(
      cycleAudienceLabel(english, {
        kind: "groups",
        groups: [JUNIORS, MASTERS],
      }),
    ).toBe("Juniors, Masters");
  });

  it("avisa de que nadie ve un ciclo de grupos sin grupos", () => {
    expect(cycleAudienceLabel(english, { kind: "groups", groups: [] })).toBe(
      "No groups: no member sees it",
    );
  });

  it("en español dice Todo el club y Sin grupos", () => {
    expect(cycleAudienceLabel(spanish, { kind: "club" })).toBe("Todo el club");
    expect(cycleAudienceLabel(spanish, { kind: "groups", groups: [] })).toBe(
      "Sin grupos: ningún miembro lo ve",
    );
  });
});

describe("conflictsConfirmText", () => {
  it("nombra el ciclo que se archiva", () => {
    expect(conflictsConfirmText(english, [{ id: "c1", name: "Road" }])).toBe(
      "Road will be archived: it's active for some of the same members.",
    );
  });

  it("nombra todos los que se archivan", () => {
    expect(
      conflictsConfirmText(english, [
        { id: "c1", name: "Road" },
        { id: "c2", name: "Juniors block" },
      ]),
    ).toBe(
      "Road, Juniors block will be archived: they're active for some of the same members.",
    );
  });

  it("en español habla de pasar a archivado", () => {
    expect(conflictsConfirmText(spanish, [{ id: "c1", name: "Road" }])).toBe(
      "Road pasará a archivado: está activo para algunos de los mismos miembros.",
    );
    expect(
      conflictsConfirmText(spanish, [
        { id: "c1", name: "Road" },
        { id: "c2", name: "Juniors block" },
      ]),
    ).toBe(
      "Road, Juniors block pasarán a archivado: están activos para algunos de los mismos miembros.",
    );
  });
});
