import type { NavIconId } from "@/lib/navigation";

// Ocho SVG inline, sin librería: el repo no traía ninguna y instalar una para
// ocho glifos habría sido peso de bundle sin uso real (#53). Todos comparten
// trazo para leerse como un mismo set.
const STROKE_WIDTH = 1.8;

function IconBase({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** No es un icono de sección: lo usa el control de cerrar sesión de la
 * cabecera, que el mockup del panel dibuja también como un icono. Vive aquí
 * para compartir trazo y tamaño con los ocho de la navegación, en vez de ser
 * un noveno dibujo suelto con otro grosor.
 *
 * El marco de la puerta va a la izquierda y la flecha sale hacia fuera. Con el
 * marco a la derecha, el mismo dibujo se lee como "entrar". */
export function SignOutIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M10 5.5H5.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H10" />
      <path d="M16 15.5 19.5 12 16 8.5" />
      <path d="M19.5 12H9" />
    </IconBase>
  );
}

/** Tampoco es de sección: es el enlace a Mi cuenta de la cabecera (#209),
 * junto a cerrar sesión, y comparte trazo con él por la misma razón. */
export function AccountIcon(): React.JSX.Element {
  return (
    <IconBase>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </IconBase>
  );
}

function DashboardIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9.5h13V10" />
    </IconBase>
  );
}

function DirectorioIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9.5" cy="12" r="2" />
      <path d="M14 10h4M14 14h4" />
    </IconBase>
  );
}

function CalendarioIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v3M16 3.5v3" />
    </IconBase>
  );
}

function EquiposIcon(): React.JSX.Element {
  return (
    <IconBase>
      <circle cx="8.5" cy="9" r="3" />
      <circle cx="16" cy="10" r="2.5" />
      <path d="M3 20c0-3.3 2.5-5.5 5.5-5.5S14 16.7 14 20" />
      <path d="M14.5 20c0-2.3 1.3-4.1 3-4.8" />
    </IconBase>
  );
}

function EvaluacionesIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="6" y="3.5" width="12" height="17" rx="2" />
      <path d="M9.5 3.5h5v3h-5z" />
      <path d="M9 13l2 2 4-4.5" />
    </IconBase>
  );
}

function NoticiasIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7 9h6M7 12.5h6M7 16h4" />
      <path d="M16.5 9h1M16.5 12.5h1" />
    </IconBase>
  );
}

function PagosIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M6.5 14.5h3" />
    </IconBase>
  );
}

export function OverflowIcon(): React.JSX.Element {
  return (
    <IconBase>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </IconBase>
  );
}

export const NAV_SECTION_ICONS: Record<NavIconId, () => React.JSX.Element> = {
  dashboard: DashboardIcon,
  directorio: DirectorioIcon,
  calendario: CalendarioIcon,
  equipos: EquiposIcon,
  evaluaciones: EvaluacionesIcon,
  noticias: NoticiasIcon,
  pagos: PagosIcon,
};
