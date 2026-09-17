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
  | "pagos";

/** Las etiquetas de la navegación viven en el catálogo bajo `nav.label.`.
 * Ninguna lleva datos que rellenar, y acotar el tipo a ese prefijo es lo que
 * deja traducirlas sin pasar parámetros. */
export type NavLabelKey = Extract<MessageKey, `nav.label.${string}`>;

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
  readonly mobileLabelKey?: NavLabelKey;
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
];

// Una barra de pestañas deja de ser alcanzable con el pulgar pasadas las cinco
// ranuras, y la quinta se gasta en el acceso al resto. El mockup móvil define
// cinco, así que cuatro secciones quedan fijas y las demás viven detrás de
// "Más". Cuáles van fijas es una decisión de producto, no de layout: estas son
// las de uso diario (#22).
const MOBILE_PRIMARY_HREFS: readonly string[] = [
  "/dashboard",
  "/calendario",
  "/equipos",
  "/noticias",
];

function isPrimaryOnMobile(section: NavSection): boolean {
  return MOBILE_PRIMARY_HREFS.includes(section.href);
}

export const MOBILE_PRIMARY_SECTIONS: readonly NavSection[] =
  NAV_SECTIONS.filter(isPrimaryOnMobile);

export const MOBILE_OVERFLOW_SECTIONS: readonly NavSection[] =
  NAV_SECTIONS.filter((section) => !isPrimaryOnMobile(section));

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
