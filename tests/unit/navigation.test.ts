import { describe, expect, it } from "vitest";
import {
  MOBILE_OVERFLOW_SECTIONS,
  MOBILE_PRIMARY_SECTIONS,
  NAV_SECTIONS,
  isSectionActive,
} from "@/lib/navigation";

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

describe("reparto de secciones para móvil", () => {
  it("deja como pestañas fijas las cuatro secciones de uso más frecuente", () => {
    expect(MOBILE_PRIMARY_SECTIONS.map((section) => section.label)).toEqual([
      "Dashboard",
      "Calendario",
      "Equipos",
      "Noticias",
    ]);
  });

  it("manda al desbordamiento las tres secciones restantes", () => {
    expect(MOBILE_OVERFLOW_SECTIONS.map((section) => section.label)).toEqual([
      "Directorio",
      "Evaluaciones",
      "Pagos",
    ]);
  });

  it("reparte todas las secciones sin perder ni duplicar ninguna", () => {
    const repartidas = [
      ...MOBILE_PRIMARY_SECTIONS,
      ...MOBILE_OVERFLOW_SECTIONS,
    ];

    expect(repartidas).toHaveLength(NAV_SECTIONS.length);
    expect(new Set(repartidas.map((section) => section.href))).toEqual(
      new Set(NAV_SECTIONS.map((section) => section.href)),
    );
  });
});
