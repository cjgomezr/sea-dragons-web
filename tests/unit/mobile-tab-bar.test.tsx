import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/MobileTabBar";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

describe("barra de pestañas móvil", () => {
  it("muestra las cuatro secciones frecuentes como pestañas fijas", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar />);

    const tabs = screen.getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Dashboard",
      "Calendario",
      "Equipos",
      "Noticias",
    ]);
  });

  it("mantiene las secciones restantes fuera del alcance hasta abrir Más", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar />);

    expect(screen.queryByRole("link", { name: "Pagos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("revela las tres secciones restantes al pulsar Más", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/dashboard");
    render(<MobileTabBar />);

    await user.click(screen.getByRole("button", { name: "Más" }));

    expect(screen.getByRole("link", { name: "Directorio" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Evaluaciones" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("marca como actual la pestaña que corresponde a la ruta activa, y solo esa", () => {
    usePathname.mockReturnValue("/calendario");
    render(<MobileTabBar />);

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Calendario");
  });

  it("marca el botón Más cuando la ruta activa vive en el desbordamiento", () => {
    usePathname.mockReturnValue("/pagos");
    render(<MobileTabBar />);

    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("no marca nada cuando la ruta no pertenece al menú", () => {
    usePathname.mockReturnValue("/");
    render(<MobileTabBar />);

    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Más" }),
    ).not.toHaveAttribute("aria-current");
  });
});
