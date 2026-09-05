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

export function isSectionActive(
  sectionHref: string,
  pathname: string,
): boolean {
  return sectionHref === pathname;
}
