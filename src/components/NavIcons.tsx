import type { NavIconId } from "@/lib/navigation";

// Diez SVG inline, sin librería: el repo no traía ninguna y instalar una para
// tan pocos glifos habría sido peso de bundle sin uso real (#53). Todos
// comparten trazo para leerse como un mismo set.
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

/** No es un icono de sección: acompaña al texto de la entrada de cerrar
 * sesión del menú de la cuenta (#287). Vive aquí para compartir trazo y
 * tamaño con los de la navegación, en vez de ser un dibujo suelto con otro
 * grosor.
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

/** Tampoco es de sección: es el botón que abre el menú de la cuenta en la
 * cabecera (#287) y su entrada Mi perfil, y comparte trazo con los demás por
 * la misma razón. */
export function AccountIcon(): React.JSX.Element {
  return (
    <IconBase>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </IconBase>
  );
}

/** Acompaña a la entrada de la configuración del club en el menú de la cuenta
 * (#296): dos controles deslizantes, el glifo de "ajustes" que no se
 * confunde con el engranaje del sistema operativo. */
export function SettingsIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </IconBase>
  );
}

/** La campana de avisos de la cabecera (#266), con el mismo trazo que los
 * otros iconos de esa esquina. */
export function BellIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
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

/** Dos siluetas, una detrás de otra: un grupo de socios (#228). Se distingue
 * de Directorio, que dibuja una sola ficha, en que aquí hay más de una
 * persona y ninguna tarjeta alrededor. */
function GruposIcon(): React.JSX.Element {
  return (
    <IconBase>
      <circle cx="9.5" cy="8.5" r="3" />
      <path d="M3.5 19.5c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M16 5.6a3 3 0 0 1 0 5.8" />
      <path d="M17.5 14.9c1.9.6 3 2.3 3 4.6" />
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
  grupos: GruposIcon,
};

/** Tampoco es de sección: marca los adjuntos de una publicación (#329), en
 * el feed y en la publicación abierta. */
export function AttachmentIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </IconBase>
  );
}
