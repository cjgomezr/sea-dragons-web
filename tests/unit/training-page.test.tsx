import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";

/**
 * La ruta de Entrenamiento (#900, RF-12 del PRD de E35): lee el rol en el
 * servidor y sólo al Admin y al Coach les ofrece Planificar (D3). Lo que la
 * pantalla pinta se prueba en `components/training-screen.test.tsx`.
 */

const callerRole = { current: "Player" as Role };

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));
vi.mock("@/lib/auth/caller-role", () => ({
  readCallerRole: async () => callerRole.current,
}));
vi.mock("@/components/training/TrainingScreen", () => ({
  TrainingScreen: ({ canPlan }: { readonly canPlan: boolean }) => (
    <p>{canPlan ? "offers planning" : "member only"}</p>
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
});
