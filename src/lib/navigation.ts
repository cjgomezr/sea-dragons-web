export type NavSection = {
  readonly label: string;
  readonly href: string;
};

export const NAV_SECTIONS: readonly NavSection[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Directorio", href: "/directorio" },
  { label: "Calendario", href: "/calendario" },
  { label: "Equipos", href: "/equipos" },
  { label: "Evaluaciones", href: "/evaluaciones" },
  { label: "Noticias", href: "/noticias" },
  { label: "Pagos", href: "/pagos" },
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
