import { describe, expect, it } from "vitest";
import { englishMessages } from "@/lib/i18n/messages/en";
import { spanishMessages } from "@/lib/i18n/messages/es";

/**
 * Con ciclos de grupos un socio al día ya no ve todos los ciclos activos,
 * solo los suyos y los de todo el club (#988, D4 del PRD de E38). La cabecera
 * de Planificar lo dice así.
 */

describe("la cabecera de Planificar", () => {
  it("dice en inglés que cada socio ve los ciclos activos que le tocan", () => {
    expect(englishMessages["training.manage.lead"]).toBe(
      "Each member with an active membership sees the active cycles meant for them.",
    );
  });

  it("dice en español que cada socio ve los ciclos activos que le tocan", () => {
    expect(spanishMessages["training.manage.lead"]).toBe(
      "Cada miembro con la membresía activa ve los ciclos activos que le tocan.",
    );
  });
});
