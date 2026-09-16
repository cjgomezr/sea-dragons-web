import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RegistrationPage from "@/app/(auth)/registro/page";
import type { ConfirmationState } from "@/lib/auth/registration-screen";
import {
  REGISTERING_AGAIN_SENDS_A_LINK,
  RESEND_BUTTON_LABEL,
  expectNoneMatch,
} from "../helpers/confirmation-copy";

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
 * Los dos desenlaces que dejan a alguien sin enlace válido: el caducado o ya
 * usado, y el fallo del servidor, que gasta el enlace al intentarlo. Los dos
 * tienen que contar cómo conseguir otro, y hasta el #179 los dos contaban un
 * camino que no existe.
 */
const WITHOUT_A_VALID_LINK: readonly ConfirmationState[] = [
  "invalida",
  "error",
];

async function renderConfirmation(state: ConfirmationState): Promise<string> {
  const { container } = render(
    await RegistrationPage({
      searchParams: Promise.resolve({ confirmacion: state }),
    }),
  );
  return container.textContent ?? "";
}

describe("paneles del desenlace del enlace de confirmación", () => {
  it.each(WITHOUT_A_VALID_LINK)(
    "el panel de %s no promete que registrarse otra vez mande otro enlace",
    async (state) => {
      const text = await renderConfirmation(state);

      expectNoneMatch(text, REGISTERING_AGAIN_SENDS_A_LINK, `panel ${state}`);
    },
  );

  it.each(WITHOUT_A_VALID_LINK)(
    "el panel de %s manda al botón de reenviar, que es lo que sí pide otro enlace",
    async (state) => {
      const text = await renderConfirmation(state);

      expect(text).toContain(RESEND_BUTTON_LABEL);
      expect(text).toMatch(/pantalla de confirmación/i);
    },
  );

  it.each(WITHOUT_A_VALID_LINK)(
    "el panel de %s sigue ofreciendo volver al registro",
    async (state) => {
      await renderConfirmation(state);

      expect(
        screen.getByRole("link", { name: "Volver al registro" }),
      ).toBeInTheDocument();
    },
  );
});
