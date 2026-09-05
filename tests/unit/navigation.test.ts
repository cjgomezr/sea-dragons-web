import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, isSectionActive } from "@/lib/navigation";

describe("navegación", () => {
  it("contiene exactamente las siete secciones esperadas, cada una con su ruta", () => {
    expect(NAV_SECTIONS).toEqual([
      { label: "Dashboard", href: "/dashboard" },
      { label: "Directorio", href: "/directorio" },
      { label: "Calendario", href: "/calendario" },
      { label: "Equipos", href: "/equipos" },
      { label: "Evaluaciones", href: "/evaluaciones" },
      { label: "Noticias", href: "/noticias" },
      { label: "Pagos", href: "/pagos" },
    ]);
  });

  it("marca como actual la sección que corresponde a la ruta activa, y solo esa", () => {
    const activeCount = NAV_SECTIONS.filter((section) =>
      isSectionActive(section.href, "/calendario"),
    ).length;

    expect(activeCount).toBe(1);
    expect(isSectionActive("/calendario", "/calendario")).toBe(true);
    expect(isSectionActive("/dashboard", "/calendario")).toBe(false);
  });

  it("no marca ninguna sección como actual cuando la ruta no es del menú", () => {
    const activeCount = NAV_SECTIONS.filter((section) =>
      isSectionActive(section.href, "/"),
    ).length;

    expect(activeCount).toBe(0);
  });
});
