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

export type NavSection = {
  readonly label: string;
  readonly href: string;
  readonly icon: NavIconId;
  // Overrides `label` only in the mobile tab bar. Its strip is narrower than
  // the sidebar, and the fonts Linux resolves make "Dashboard" wrap to two
  // lines there while Windows fonts let it fit (#85). Absent unless a
  // section's full label doesn't survive that width.
  readonly mobileLabel?: string;
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    mobileLabel: "Inicio",
  },
  { label: "Directorio", href: "/directorio", icon: "directorio" },
  { label: "Calendario", href: "/calendario", icon: "calendario" },
  { label: "Equipos", href: "/equipos", icon: "equipos" },
  { label: "Evaluaciones", href: "/evaluaciones", icon: "evaluaciones" },
  { label: "Noticias", href: "/noticias", icon: "noticias" },
  { label: "Pagos", href: "/pagos", icon: "pagos" },
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

export function getMobileLabel(section: NavSection): string {
  return section.mobileLabel ?? section.label;
}
