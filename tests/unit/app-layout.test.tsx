import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLETE_REGISTRATION_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * La disposición de dentro de la aplicación (#213): el rol con el que se
 * dibuja la navegación lo lee el servidor con la misma lectura que usa la
 * frontera, no llega del navegador.
 */

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect(${to})`);
  }
}

const { createSessionClient, readSessionState } = vi.hoisted(() => ({
  createSessionClient: vi.fn(),
  readSessionState: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/supabase/session-client", () => ({
  createSessionClient: (...args: unknown[]) => createSessionClient(...args),
}));
vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
}));
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => ({ name: "Hobart Orcas", initials: "HO" }),
}));

const { default: AppLayout } = await import("@/app/(app)/layout");

function givenSession(state: SessionState): void {
  createSessionClient.mockReturnValue({ kind: "ready", client: {} });
  readSessionState.mockResolvedValue(state);
}

async function renderAppLayout(): Promise<void> {
  render(await AppLayout({ children: <p>Contenido</p> }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("disposición de la aplicación", () => {
  // #292: la cabecera enseña la marca que guarda la base.
  it("pone en la cabecera el nombre guardado del club", async () => {
    givenSession({ kind: "active", role: "Player" });

    await renderAppLayout();

    expect(screen.getByText("Hobart Orcas")).toBeInTheDocument();
  });

  it("dibuja la navegación de un Player sin Equipos, Evaluaciones ni Administración", async () => {
    givenSession({ kind: "active", role: "Player" });

    await renderAppLayout();

    const sidebar = screen.getByRole("navigation", { name: "Main" });
    expect(sidebar).toHaveTextContent("Directory");
    expect(sidebar).not.toHaveTextContent("Teams");
    expect(sidebar).not.toHaveTextContent("Evaluations");
    expect(sidebar).not.toHaveTextContent("Administration");
  });

  it("dibuja la navegación de un Admin sin Administración, que vive en el directorio", async () => {
    givenSession({ kind: "active", role: "Admin" });

    await renderAppLayout();

    const sidebar = screen.getByRole("navigation", { name: "Main" });
    expect(sidebar).toHaveTextContent("Groups");
    expect(sidebar).not.toHaveTextContent("Administration");
  });

  it("manda a la entrada a quien ya no tiene sesión", async () => {
    givenSession({ kind: "anonymous" });

    await expect(renderAppLayout()).rejects.toEqual(
      new RedirectSignal(SIGN_IN_PATH),
    );
  });

  it("manda a completar registro a una cuenta incompleta", async () => {
    givenSession({ kind: "incomplete" });

    await expect(renderAppLayout()).rejects.toEqual(
      new RedirectSignal(COMPLETE_REGISTRATION_PATH),
    );
  });

  it("falla nombrando las variables que faltan si Supabase no está configurado", async () => {
    createSessionClient.mockReturnValue({
      kind: "unconfigured",
      missingKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
    });

    await expect(renderAppLayout()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
