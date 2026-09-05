import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

describe("app shell", () => {
  it("renderiza marca, navegación, contenido y conmutador de tema", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell>
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(screen.getByText("Victoria Seadragons")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Principal" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tema/i })).toBeInTheDocument();
  });

  it("muestra el contenido recibido dentro del área principal", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell>
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByText("Contenido de la sección"));
  });
});
