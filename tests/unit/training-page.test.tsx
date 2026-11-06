import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";

/**
 * La ruta de Entrenamiento (#900, RF-12 del PRD de E35): lee el rol en el
 * servidor y sólo al Admin y al Coach les ofrece Planificar (D3). Lo que la
 * pantalla pinta se prueba en `components/training-screen.test.tsx`.
 */

const callerRole = { current: "Player" as Role };
const CALLER_ID = "aaaaaaaa-0000-4000-8000-0000000000a1";

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));
vi.mock("@/lib/auth/caller-role", () => ({
  readCallerRole: async () => callerRole.current,
  readCallerId: async () => CALLER_ID,
}));
vi.mock("@/components/training/TrainingScreen", () => ({
  TrainingScreen: ({
    canPlan,
    userId,
  }: {
    readonly canPlan: boolean;
    readonly userId: string;
  }) => (
    <>
      <p>{canPlan ? "offers planning" : "member only"}</p>
      <p>remembers for {userId}</p>
    </>
  ),
}));

const { default: TrainingPage } =
  await import("@/app/(app)/entrenamiento/page");

describe("Entrenamiento", () => {
  it.each([
    ["Admin", "offers planning"],
    ["Coach", "offers planning"],
    ["Committee", "member only"],
    ["Player", "member only"],
  ] as const)("a un %s le dice: %s", async (role, expected) => {
    callerRole.current = role;

    render(await TrainingPage());

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("le pasa a la pantalla la cuenta de quien la pide, para recordar su ciclo", async () => {
    render(await TrainingPage());

    expect(screen.getByText(`remembers for ${CALLER_ID}`)).toBeInTheDocument();
  });
});
