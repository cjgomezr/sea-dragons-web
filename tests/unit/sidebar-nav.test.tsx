import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "@/components/SidebarNav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

describe("navegación", () => {
  it("contiene exactamente las siete secciones esperadas, cada una con su ruta", () => {
    usePathname.mockReturnValue("/dashboard");
    render(<SidebarNav />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Directorio",
      "Calendario",
      "Equipos",
      "Evaluaciones",
      "Noticias",
      "Pagos",
    ]);
    expect(screen.getByRole("link", { name: "Calendario" })).toHaveAttribute(
      "href",
      "/calendario",
    );
  });

  it("marca como actual la sección que corresponde a la ruta activa, y solo esa", () => {
    usePathname.mockReturnValue("/calendario");
    render(<SidebarNav />);

    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Calendario");
    expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
  });

  it("no marca ninguna sección como actual fuera del menú", () => {
    usePathname.mockReturnValue("/");
    render(<SidebarNav />);

    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
  });
});
