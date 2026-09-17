import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translator";
import {
  MOBILE_OVERFLOW_SECTIONS,
  MOBILE_PRIMARY_SECTIONS,
  NAV_SECTIONS,
  getMobileLabel,
  getSectionLabel,
  isSectionActive,
} from "@/lib/navigation";

const english = createTranslator("en");
const spanish = createTranslator("es");

function sectionAt(href: string): (typeof NAV_SECTIONS)[number] {
  const section = NAV_SECTIONS.find((candidate) => candidate.href === href);
  if (section === undefined) {
    throw new Error(`No hay sección en ${href}`);
  }
  return section;
}

describe("navegación", () => {
  it("contiene exactamente las siete secciones esperadas, cada una con su ruta", () => {
    expect(NAV_SECTIONS.map((section) => [section.href, section.icon])).toEqual(
      [
        ["/dashboard", "dashboard"],
        ["/directorio", "directorio"],
        ["/calendario", "calendario"],
        ["/equipos", "equipos"],
        ["/evaluaciones", "evaluaciones"],
        ["/noticias", "noticias"],
        ["/pagos", "pagos"],
      ],
    );
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

// E17 RF-5: los nombres en inglés son los del mockup de escritorio
// (docs/mockups/dashboard-light.png).
describe("navegación traducida", () => {
  it("nombra las siete secciones en inglés", () => {
    expect(
      NAV_SECTIONS.map((section) => getSectionLabel(section, english)),
    ).toEqual([
      "Dashboard",
      "Directory",
      "Calendar",
      "Teams",
      "Evaluations",
      "News",
      "Payments",
    ]);
  });

  it("nombra las siete secciones en español igual que antes de traducirlas", () => {
    expect(
      NAV_SECTIONS.map((section) => getSectionLabel(section, spanish)),
    ).toEqual([
      "Dashboard",
      "Directorio",
      "Calendario",
      "Equipos",
      "Evaluaciones",
      "Noticias",
      "Pagos",
    ]);
  });
});

describe("reparto de secciones para móvil", () => {
  it("deja como pestañas fijas las cuatro secciones de uso más frecuente", () => {
    expect(MOBILE_PRIMARY_SECTIONS.map((section) => section.href)).toEqual([
      "/dashboard",
      "/calendario",
      "/equipos",
      "/noticias",
    ]);
  });

  it("manda al desbordamiento las tres secciones restantes", () => {
    expect(MOBILE_OVERFLOW_SECTIONS.map((section) => section.href)).toEqual([
      "/directorio",
      "/evaluaciones",
      "/pagos",
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

// #85: "Dashboard" no cabe en una línea en la barra móvil bajo las métricas
// de fuente que resuelve Linux. La etiqueta corta solo se usa ahí; el
// sidebar de escritorio sigue mostrando "Dashboard".
describe("etiqueta corta para la barra móvil (#85)", () => {
  it("acorta Dashboard en los dos idiomas", () => {
    const dashboard = sectionAt("/dashboard");

    expect(getMobileLabel(dashboard, spanish)).toBe("Inicio");
    expect(getMobileLabel(dashboard, english)).toBe("Home");
  });

  it("usa la etiqueta completa cuando la sección no tiene una corta", () => {
    const equipos = sectionAt("/equipos");

    expect(getMobileLabel(equipos, spanish)).toBe("Equipos");
    expect(getMobileLabel(equipos, english)).toBe("Teams");
  });

  it("acorta Calendario, que se partía a 360px, y Calendar, que rozaba el margen", () => {
    const calendario = sectionAt("/calendario");

    expect(getMobileLabel(calendario, spanish)).toBe("Agenda");
    expect(getMobileLabel(calendario, english)).toBe("Events");
  });
});
