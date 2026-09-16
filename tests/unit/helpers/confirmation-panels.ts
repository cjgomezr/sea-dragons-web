import { render, screen } from "@testing-library/react";
import { expect } from "vitest";
import RegistrationPage from "@/app/(auth)/registro/page";
import type { ConfirmationState } from "@/lib/auth/registration-screen";

/** Los dos desenlaces que dejan a alguien sin enlace válido: el caducado o ya
 * usado, y el fallo del servidor, que gasta el enlace al intentarlo. Los dos
 * tienen que contar cómo conseguir otro. */
export const STATES_WITHOUT_A_VALID_LINK: readonly ConfirmationState[] = [
  "invalida",
  "error",
];

/**
 * Pinta el panel de un desenlace y devuelve su texto.
 *
 * Comprueba antes que hay panel, y no por cortesía: casi todo lo que se le
 * pregunta a ese texto son ausencias, y un panel que dejara de pintarse
 * devolvería la cadena vacía, donde no aparece nada. Todas esas aserciones
 * pasarían en verde sin haber leído una sola palabra.
 *
 * Quien lo use tiene que mockear `next/link` en su propio archivo: `vi.mock`
 * se iza dentro del módulo donde se escribe, así que desde aquí llegaría tarde.
 */
export async function readConfirmationPanel(
  state: ConfirmationState,
): Promise<string> {
  const { container } = render(
    await RegistrationPage({
      searchParams: Promise.resolve({ confirmacion: state }),
    }),
  );
  expect(
    screen.getByRole("link", { name: "Volver al registro" }),
  ).toBeInTheDocument();
  return container.textContent ?? "";
}
