import type { Role } from "@/lib/auth/roles";
import { isAllowedForRole } from "@/lib/auth/session-boundary";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";

// Un id por sección, no el componente de icono en sí: este archivo es .ts
// (sin JSX) y lo consume tanto la barra de pestañas móvil (con icono) como
// SidebarNav (sin icono). NavIcons.tsx es quien traduce el id a SVG.
export type NavIconId =
  | "dashboard"
  | "directorio"
  | "calendario"
  | "equipos"
  | "evaluaciones"
  | "noticias"
  | "pagos"
  | "administracion";

/** Las etiquetas de la navegación viven en el catálogo bajo `nav.label.`.
 * Ninguna lleva datos que rellenar, y acotar el tipo a ese prefijo es lo que
 * deja traducirlas sin pasar parámetros. */
type AnyNavLabelKey = Extract<MessageKey, `nav.label.${string}`>;

/** Las cortas sólo caben en la barra móvil. Separarlas por tipo impide que
 * una acabe titulando una pantalla ("Events" en vez de "Calendar"). */
export type NavShortLabelKey = Extract<AnyNavLabelKey, `${string}Short`>;

export type NavLabelKey = Exclude<AnyNavLabelKey, NavShortLabelKey>;

export type NavSection = {
  readonly labelKey: NavLabelKey;
  readonly href: string;
  readonly icon: NavIconId;
  // Overrides `labelKey` only in the mobile tab bar. Its strip is narrower
  // than the sidebar, and the fonts Linux resolves make "Dashboard" wrap to
  // two lines there while Windows fonts let it fit (#85). Absent unless a
  // section's full label doesn't survive that width in some language. Each
  // catalog fills the short key to its own measure, so a language where the
  // full label fits may simply repeat it.
  readonly mobileLabelKey?: NavShortLabelKey;
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    labelKey: "nav.label.dashboard",
    href: "/dashboard",
    icon: "dashboard",
    mobileLabelKey: "nav.label.dashboardShort",
  },
  { labelKey: "nav.label.directory", href: "/directorio", icon: "directorio" },
  {
    labelKey: "nav.label.calendar",
    href: "/calendario",
    icon: "calendario",
    mobileLabelKey: "nav.label.calendarShort",
  },
  { labelKey: "nav.label.teams", href: "/equipos", icon: "equipos" },
  {
    labelKey: "nav.label.evaluations",
    href: "/evaluaciones",
    icon: "evaluaciones",
  },
  { labelKey: "nav.label.news", href: "/noticias", icon: "noticias" },
  { labelKey: "nav.label.payments", href: "/pagos", icon: "pagos" },
  // Sólo en "Más" y en la barra lateral, donde cabe entera: no necesita
  // etiqueta corta.
  {
    labelKey: "nav.label.admin",
    href: "/administracion",
    icon: "administracion",
  },
];

/** Las secciones que el rol puede abrir, en el orden de `NAV_SECTIONS`.
 * Esconder el resto es comodidad: quien escriba la dirección a mano se topa
 * igual con la frontera, que es la que decide. */
export function getVisibleSections(role: Role): readonly NavSection[] {
  return NAV_SECTIONS.filter((section) => isAllowedForRole(section.href, role));
}

export type MobileSections = {
  readonly primary: readonly NavSection[];
  readonly overflow: readonly NavSection[];
};

// Una barra de pestañas deja de ser alcanzable con el pulgar pasadas las cinco
// ranuras, y la quinta se gasta en el acceso al resto. El mockup móvil define
// cinco, así que cuatro secciones quedan fijas y las demás viven detrás de
// "Más". Cuáles van fijas es una decisión de producto, no de layout: las de uso
// diario (#22) que el rol puede abrir (#213). Cada ranura lista sus candidatas
// por preferencia y se queda con la primera que el rol alcance: quien no ve
// Equipos tiene Directorio en ese mismo hueco.
const MOBILE_PRIMARY_SLOTS: readonly (readonly string[])[] = [
  ["/dashboard"],
  ["/calendario"],
  ["/equipos", "/directorio"],
  ["/noticias"],
];

function pickSlotSection(
  candidates: readonly string[],
  visible: readonly NavSection[],
): NavSection | undefined {
  return candidates
    .map((href) => visible.find((section) => section.href === href))
    .find((section) => section !== undefined);
}

export function getMobileSections(role: Role): MobileSections {
  const visible = getVisibleSections(role);
  const primary = MOBILE_PRIMARY_SLOTS.map((candidates) =>
    pickSlotSection(candidates, visible),
  ).filter((section) => section !== undefined);
  return {
    primary,
    overflow: visible.filter((section) => !primary.includes(section)),
  };
}

export function isSectionActive(
  sectionHref: string,
  pathname: string,
): boolean {
  return sectionHref === pathname;
}

export function getSectionLabel(
  section: NavSection,
  translate: Translator,
): string {
  return translate(section.labelKey);
}

export function getMobileLabel(
  section: NavSection,
  translate: Translator,
): string {
  return translate(section.mobileLabelKey ?? section.labelKey);
}
