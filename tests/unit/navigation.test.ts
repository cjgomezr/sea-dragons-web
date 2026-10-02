import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  type ActiveAccess,
  decideSessionBoundary,
} from "@/lib/auth/session-boundary";
import { createTranslator } from "@/lib/i18n/translator";
import {
  NAV_SECTIONS,
  getMobileLabel,
  getMobileSections,
  getSectionLabel,
  getVisibleSections,
  isSectionActive,
} from "@/lib/navigation";

/** Un socio de ese rol con la membresía al día: el menú de siempre. */
function currentAs(role: Role): ActiveAccess {
  return { role, membershipCurrent: true };
}

/** Un socio de ese rol cuya membresía no está al día (#453). */
function notCurrentAs(role: Role): ActiveAccess {
  return { role, membershipCurrent: false };
}

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
  it("contiene las secciones de socio, Asistencia entre Calendario y Equipos como el mockup, y Grupos al final, cada una con su ruta", () => {
    expect(NAV_SECTIONS.map((section) => [section.href, section.icon])).toEqual(
      [
        ["/dashboard", "dashboard"],
        ["/directorio", "directorio"],
        ["/calendario", "calendario"],
        ["/asistencia", "asistencia"],
        ["/equipos", "equipos"],
        ["/evaluaciones", "evaluaciones"],
        ["/noticias", "noticias"],
        ["/pagos", "pagos"],
        ["/grupos", "grupos"],
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
      "Attendance",
      "Teams",
      "Evaluations",
      "News",
      "Payments",
      "Groups",
    ]);
  });

  it("nombra las nueve secciones en español igual que antes de traducirlas", () => {
    expect(
      NAV_SECTIONS.map((section) => getSectionLabel(section, spanish)),
    ).toEqual([
      "Dashboard",
      "Directorio",
      "Calendario",
      "Asistencia",
      "Equipos",
      "Evaluaciones",
      "Noticias",
      "Pagos",
      "Grupos",
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

// La pantalla de administración se mudó al directorio (#240): la bandeja y el
// cambio de rol viven ahí, y la navegación ya no tiene a dónde llevar.
describe("navegación", () => {
  it.each(ROLES)("no ofrece ninguna sección Administración a un %s", (role) => {
    const labels = getVisibleSections(currentAs(role)).map((section) =>
      getSectionLabel(section, english),
    );

    expect(labels).not.toContain("Administration");
    expect(hrefsOf(getVisibleSections(currentAs(role)))).not.toContain(
      "/administracion",
    );
  });

  it("no guarda la sección en ninguna lista, ni para quien la pudiera abrir", () => {
    expect(hrefsOf(NAV_SECTIONS)).not.toContain("/administracion");
  });
});

// FR-013 (#213): la navegación ofrece sólo lo que la frontera deja abrir.
describe("secciones por rol", () => {
  it("un Player ve Panel, Directorio, Calendario, Noticias y Pagos", () => {
    expect(hrefsOf(getVisibleSections(currentAs("Player")))).toEqual(
      MEMBER_SECTIONS,
    );
  });

  it.each(["Player", "Committee"] as const)(
    "un %s no ve Asistencia, que su rol no registra",
    (role) => {
      expect(hrefsOf(getVisibleSections(currentAs(role)))).not.toContain(
        "/asistencia",
      );
    },
  );

  it("un Player no ve Grupos, que su rol no gestiona", () => {
    expect(hrefsOf(getVisibleSections(currentAs("Player")))).not.toContain(
      "/grupos",
    );
  });

  it("un Committee ve lo mismo que un Player, y además Grupos", () => {
    expect(hrefsOf(getVisibleSections(currentAs("Committee")))).toEqual([
      ...MEMBER_SECTIONS,
      "/grupos",
    ]);
  });

  it("un Coach ve además Asistencia, Equipos, Evaluaciones y Grupos", () => {
    expect(hrefsOf(getVisibleSections(currentAs("Coach")))).toEqual([
      "/dashboard",
      "/directorio",
      "/calendario",
      "/asistencia",
      "/equipos",
      "/evaluaciones",
      "/noticias",
      "/pagos",
      "/grupos",
    ]);
  });

  it("un Admin ve todas las secciones", () => {
    expect(hrefsOf(getVisibleSections(currentAs("Admin")))).toEqual(
      hrefsOf(NAV_SECTIONS),
    );
  });
});

describe("barra móvil por rol", () => {
  it.each([
    ["Player", ["/pagos"]],
    ["Committee", ["/pagos", "/grupos"]],
  ] as const)(
    "un %s tiene fijas Inicio, Eventos, Directorio y Noticias, y el resto en Más",
    (role, overflowHrefs) => {
      const { primary, overflow } = getMobileSections(currentAs(role));

      expect(hrefsOf(primary)).toEqual([
        "/dashboard",
        "/calendario",
        "/directorio",
        "/noticias",
      ]);
      expect(hrefsOf(overflow)).toEqual(overflowHrefs);
    },
  );

  it("un Coach tiene fijas Inicio, Eventos, Equipos y Noticias, y en Más Directorio, Asistencia, Evaluaciones, Pagos y Grupos", () => {
    const { primary, overflow } = getMobileSections(currentAs("Coach"));

    expect(hrefsOf(primary)).toEqual([
      "/dashboard",
      "/calendario",
      "/equipos",
      "/noticias",
    ]);
    expect(hrefsOf(overflow)).toEqual([
      "/directorio",
      "/asistencia",
      "/evaluaciones",
      "/pagos",
      "/grupos",
    ]);
  });

  it("un Admin tiene las mismas fijas y el mismo Más que un Coach", () => {
    const { primary, overflow } = getMobileSections(currentAs("Admin"));

    expect(hrefsOf(primary)).toEqual(
      hrefsOf(getMobileSections(currentAs("Coach")).primary),
    );
    expect(hrefsOf(overflow)).toEqual([
      "/directorio",
      "/asistencia",
      "/evaluaciones",
      "/pagos",
      "/grupos",
    ]);
  });

  it.each(ROLES)(
    "reparte las secciones visibles de un %s sin perder ni duplicar ninguna",
    (role) => {
      const { primary, overflow } = getMobileSections(currentAs(role));
      const repartidas = hrefsOf([...primary, ...overflow]);

      expect(repartidas).toHaveLength(
        getVisibleSections(currentAs(role)).length,
      );
      expect(new Set(repartidas)).toEqual(
        new Set(hrefsOf(getVisibleSections(currentAs(role)))),
      );
    },
  );
});

function isOpenedByBoundary(href: string, role: Role): boolean {
  return (
    decideSessionBoundary({
      pathname: href,
      session: { kind: "active", role, membershipCurrent: true },
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

      expect(hrefsOf(getVisibleSections(currentAs(role)))).toEqual(
        hrefsOf(opened),
      );
    },
  );

  it.each(ROLES)(
    "no pone en la barra móvil de un %s nada que la frontera le cierre",
    (role) => {
      const { primary, overflow } = getMobileSections(currentAs(role));

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

    expect(getMobileLabel(directorio, spanish)).toBe("Gente");
    expect(getMobileLabel(directorio, english)).toBe("People");
  });

  it("acorta Calendario, que se partía a 360px, y Calendar, que rozaba el margen", () => {
    const calendario = sectionAt("/calendario");

    expect(getMobileLabel(calendario, spanish)).toBe("Agenda");
    expect(getMobileLabel(calendario, english)).toBe("Events");
  });
});

describe("navegación de quien no tiene la membresía al día (#453)", () => {
  it("a un Player le deja Inicio, Calendario y Pagos, y nada más", () => {
    expect(hrefsOf(getVisibleSections(notCurrentAs("Player")))).toEqual([
      "/dashboard",
      "/calendario",
      "/pagos",
    ]);
  });

  it("a un Coach le deja además lo que gestiona, sin Directorio ni Noticias", () => {
    expect(hrefsOf(getVisibleSections(notCurrentAs("Coach")))).toEqual([
      "/dashboard",
      "/calendario",
      "/asistencia",
      "/equipos",
      "/evaluaciones",
      "/pagos",
      "/grupos",
    ]);
  });

  it("a un Committee le deja Noticias, que publica, y no el Directorio", () => {
    expect(hrefsOf(getVisibleSections(notCurrentAs("Committee")))).toEqual([
      "/dashboard",
      "/calendario",
      "/noticias",
      "/pagos",
      "/grupos",
    ]);
  });

  it("a un Admin le deja todas sus pantallas de gestión", () => {
    expect(hrefsOf(getVisibleSections(notCurrentAs("Admin")))).toEqual(
      hrefsOf(NAV_SECTIONS),
    );
  });

  it("pone Pagos como pestaña fija del Player, sin nada en Más", () => {
    const { primary, overflow } = getMobileSections(notCurrentAs("Player"));

    expect(hrefsOf(primary)).toEqual(["/dashboard", "/calendario", "/pagos"]);
    expect(overflow).toEqual([]);
  });

  it.each(ROLES)(
    "a un %s no le ofrece nada que la frontera no le abra",
    (role) => {
      for (const section of getVisibleSections(notCurrentAs(role))) {
        expect(
          decideSessionBoundary({
            pathname: section.href,
            session: { kind: "active", ...notCurrentAs(role) },
          }),
        ).toEqual({ kind: "allow" });
      }
    },
  );
});
