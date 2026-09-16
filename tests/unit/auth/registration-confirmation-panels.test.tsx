import { describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import {
  CONFIRMATION_SCREEN_NAME,
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
const LOCALES: readonly Locale[] = ["en", "es"];

const CASES = LOCALES.flatMap((locale) =>
  STATES_WITHOUT_A_VALID_LINK.map((state) => ({ state, locale })),
);

describe("paneles del desenlace del enlace de confirmación", () => {
  it.each(CASES)(
    "el panel de $state en $locale no promete que registrarse otra vez mande otro enlace",
    ({ state, locale }) => {
      const text = readConfirmationPanel(state, locale);

      expectNoneMatch(text, REGISTERING_AGAIN_SENDS_A_LINK, `panel ${state}`);
    },
  );

  it.each(CASES)(
    "el panel de $state en $locale manda al botón de reenviar, que es lo que sí pide otro enlace",
    ({ state, locale }) => {
      const text = readConfirmationPanel(state, locale);

      expect(text).toContain(RESEND_BUTTON_LABEL[locale]);
      expect(text).toMatch(CONFIRMATION_SCREEN_NAME[locale]);
    },
  );
});
