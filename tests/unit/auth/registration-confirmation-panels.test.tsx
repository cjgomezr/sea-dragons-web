import { describe, expect, it, vi } from "vitest";
import {
  REGISTERING_AGAIN_SENDS_A_LINK,
  RESEND_BUTTON_LABEL,
  expectNoneMatch,
} from "../helpers/confirmation-copy";
import {
  STATES_WITHOUT_A_VALID_LINK,
  readConfirmationPanel,
} from "../helpers/confirmation-panels";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

/**
 * Lo que leen el enlace caducado y el fallo del servidor. Hasta el #179 los
 * dos contaban un camino que no existe: volver a registrarse no emite ningún
 * enlace.
 */
describe("paneles del desenlace del enlace de confirmación", () => {
  it.each(STATES_WITHOUT_A_VALID_LINK)(
    "el panel de %s no promete que registrarse otra vez mande otro enlace",
    async (state) => {
      const text = await readConfirmationPanel(state);

      expectNoneMatch(text, REGISTERING_AGAIN_SENDS_A_LINK, `panel ${state}`);
    },
  );

  it.each(STATES_WITHOUT_A_VALID_LINK)(
    "el panel de %s manda al botón de reenviar, que es lo que sí pide otro enlace",
    async (state) => {
      const text = await readConfirmationPanel(state);

      expect(text).toContain(RESEND_BUTTON_LABEL);
      expect(text).toMatch(/pantalla de confirmación/i);
    },
  );

});
