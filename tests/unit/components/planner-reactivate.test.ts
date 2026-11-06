import { describe, expect, it } from "vitest";
import { reactivateConfirmText } from "@/components/training/planner-format";
import { createTranslator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";

/**
 * El texto de volver a activar un archivado (#952): si las fechas ya
 * pasaron en Melbourne, avisa de que terminó. Qué se archiva lo dice la API
 * al activar (#980).
 */

/** Del lunes 4 de mayo al domingo 12 de julio de 2026. */
const WINTER: ManagedCycle = {
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Winter 2026",
  status: "archived",
  weeks: 10,
  startDate: "2026-05-04",
  event: null,
  ownRoutines: 3,
  audience: { kind: "club" },
};

/** El lunes 13 de julio de 2026 a las 00:30 en Melbourne (AEST). */
const DAY_AFTER_END = new Date("2026-07-12T14:30:00.000Z");
/** El domingo 12 de julio de 2026 a las 23:30 en Melbourne. */
const LAST_DAY = new Date("2026-07-12T13:30:00.000Z");
/** Antes de empezar. */
const BEFORE_START = new Date("2026-04-01T02:00:00.000Z");

const english = createTranslator("en");

describe("reactivateConfirmText", () => {
  it("si terminó ayer en Melbourne, dice cuándo terminó", () => {
    const text = reactivateConfirmText(english, {
      cycle: WINTER,
      now: DAY_AFTER_END,
    });

    expect(text).toBe(
      'Make "Winter 2026" active again? It ended on 12 Jul. Members will see a finished cycle.',
    );
  });

  it("si termina hoy en Melbourne, no dice que terminó", () => {
    const text = reactivateConfirmText(english, {
      cycle: WINTER,
      now: LAST_DAY,
    });

    expect(text).toBe('Make "Winter 2026" active again?');
  });

  it("si aún no empezó, no dice que terminó", () => {
    const text = reactivateConfirmText(english, {
      cycle: WINTER,
      now: BEFORE_START,
    });

    expect(text).toBe('Make "Winter 2026" active again?');
  });

  // Qué activo se archiva ya no lo adivina la pantalla: con varios activos
  // (E38) lo dice el 409 de la API, en su propia confirmación (#980).
  it("no nombra ningún otro ciclo", () => {
    const text = reactivateConfirmText(english, {
      cycle: WINTER,
      now: DAY_AFTER_END,
    });

    expect(text).not.toContain("will be archived");
  });

  it("en español", () => {
    const text = reactivateConfirmText(createTranslator("es"), {
      cycle: WINTER,
      now: DAY_AFTER_END,
    });

    expect(text).toBe(
      '¿Volver a activar "Winter 2026"? Terminó el 12 jul. Los miembros verán un ciclo terminado.',
    );
  });
});
