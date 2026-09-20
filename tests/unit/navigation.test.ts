import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { decideSessionBoundary } from "@/lib/auth/session-boundary";
import { createTranslator } from "@/lib/i18n/translator";
import {
  NAV_SECTIONS,
  getMobileLabel,
  getMobileSections,
  getSectionLabel,
  getVisibleSections,
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
  it("contiene las siete secciones de socio, Grupos y Administración al final, cada una con su ruta", () => {
    expect(NAV_SECTIONS.map((section) => [section.href, section.icon])).toEqual(
      [
        ["/dashboard", "dashboard"],
        ["/directorio", "directorio"],
        ["/calendario", "calendario"],
        ["/equipos", "equipos"],
        ["/evaluaciones", "evaluaciones"],
        ["/noticias", "noticias"],
        ["/pagos", "pagos"],
        ["/grupos", "grupos"],
        ["/administracion", "administracion"],
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
  it("nombra las nueve secciones en inglés", () => {
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
      "Groups",
      "Administration",
    ]);
  });

  it("nombra las nueve secciones en español igual que antes de traducirlas", () => {
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
      "Grupos",
      "Administración",
    ]);
  });
});

function hrefsOf(sections: readonly { readonly href: string }[]): string[] {
  return sections.map((section) => section.href);
}

const MEMBER_SECTIONS = [
  "/dashboard",
  "/directorio",
  "/calendario",
  "/noticias",
  "/pagos",
];

// FR-013 (#213): la navegación ofrece sólo lo que la frontera deja abrir.
describe("secciones por rol", () => {
  it("un Player ve Panel, Directorio, Calendario, Noticias y Pagos", () => {
    expect(hrefsOf(getVisibleSections("Player"))).toEqual(MEMBER_SECTIONS);
  });

  it("un Player no ve Grupos, que su rol no gestiona", () => {
    expect(hrefsOf(getVisibleSections("Player"))).not.toContain("/grupos");
  });

  it("un Committee ve lo mismo que un Player, y además Grupos", () => {
    expect(hrefsOf(getVisibleSections("Committee"))).toEqual([
      ...MEMBER_SECTIONS,
      "/grupos",
    ]);
  });

  it("un Coach ve además Equipos, Evaluaciones y Grupos, y no Administración", () => {
    expect(hrefsOf(getVisibleSections("Coach"))).toEqual([
      "/dashboard",
      "/directorio",
      "/calendario",
      "/equipos",
      "/evaluaciones",
      "/noticias",
      "/pagos",
      "/grupos",
    ]);
  });

  it("un Admin ve todas las secciones y Administración", () => {
    expect(hrefsOf(getVisibleSections("Admin"))).toEqual(hrefsOf(NAV_SECTIONS));
  });
});

describe("barra móvil por rol", () => {
  it.each([
    ["Player", ["/pagos"]],
    ["Committee", ["/pagos", "/grupos"]],
  ] as const)(
    "un %s tiene fijas Inicio, Eventos, Directorio y Noticias, y el resto en Más",
    (role, overflowHrefs) => {
      const { primary, overflow } = getMobileSections(role);

      expect(hrefsOf(primary)).toEqual([
        "/dashboard",
        "/calendario",
        "/directorio",
        "/noticias",
      ]);
      expect(hrefsOf(overflow)).toEqual(overflowHrefs);
    },
  );

  it("un Coach tiene fijas Inicio, Eventos, Equipos y Noticias, y en Más Directorio, Evaluaciones, Pagos y Grupos", () => {
    const { primary, overflow } = getMobileSections("Coach");

    expect(hrefsOf(primary)).toEqual([
      "/dashboard",
      "/calendario",
      "/equipos",
      "/noticias",
    ]);
    expect(hrefsOf(overflow)).toEqual([
      "/directorio",
      "/evaluaciones",
      "/pagos",
      "/grupos",
    ]);
  });

  it("un Admin tiene las fijas del Coach, y en Más además Administración", () => {
    const { primary, overflow } = getMobileSections("Admin");

    expect(hrefsOf(primary)).toEqual(
      hrefsOf(getMobileSections("Coach").primary),
    );
    expect(hrefsOf(overflow)).toEqual([
      "/directorio",
      "/evaluaciones",
      "/pagos",
      "/grupos",
      "/administracion",
    ]);
  });

  it.each(ROLES)(
    "reparte las secciones visibles de un %s sin perder ni duplicar ninguna",
    (role) => {
      const { primary, overflow } = getMobileSections(role);
      const repartidas = hrefsOf([...primary, ...overflow]);

      expect(repartidas).toHaveLength(getVisibleSections(role).length);
      expect(new Set(repartidas)).toEqual(
        new Set(hrefsOf(getVisibleSections(role))),
      );
    },
  );
});

function isOpenedByBoundary(href: string, role: Role): boolean {
  return (
    decideSessionBoundary({
      pathname: href,
      session: { kind: "active", role },
    }).kind === "allow"
  );
}

// El criterio de "misma matriz": se recorren todas las secciones contra la
// decisión real de la frontera, no contra una lista escrita a mano aquí.
describe("navegación y matriz", () => {
  it.each(ROLES)(
    "muestra a un %s exactamente las secciones que la frontera le deja abrir",
    (role) => {
      const opened = NAV_SECTIONS.filter((section) =>
        isOpenedByBoundary(section.href, role),
      );

      expect(hrefsOf(getVisibleSections(role))).toEqual(hrefsOf(opened));
    },
  );

  it.each(ROLES)(
    "no pone en la barra móvil de un %s nada que la frontera le cierre",
    (role) => {
      const { primary, overflow } = getMobileSections(role);

      for (const section of [...primary, ...overflow]) {
        expect(isOpenedByBoundary(section.href, role)).toBe(true);
      }
    },
  );
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

  it("acorta Directorio y Directory, que pasan del margen como pestaña fija (#213)", () => {
    const directorio = sectionAt("/directorio");

    expect(getMobileLabel(directorio, spanish)).toBe("Miembros");
    expect(getMobileLabel(directorio, english)).toBe("People");
  });

  it("acorta Calendario, que se partía a 360px, y Calendar, que rozaba el margen", () => {
    const calendario = sectionAt("/calendario");

    expect(getMobileLabel(calendario, spanish)).toBe("Agenda");
    expect(getMobileLabel(calendario, english)).toBe("Events");
  });
});
