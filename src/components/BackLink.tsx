import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import Link from "next/link";
import { Icon } from "@/components/Icon";

/**
 * El enlace de volver a la sección de arriba en escritorio: la ficha y el
 * alta vuelven al directorio, las categorías a Evaluaciones y las noticias a
 * su lista o a la publicación. Se pinta como un botón discreto, con la flecha
 * de icono, en vez de un enlace subrayado. En el móvil cada pantalla tiene
 * su barra con volver, y ésta no sale.
 */
export function BackLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link href={href} className="back-link">
      <Icon glyph={ArrowLeft} weight="bold" />
      {children}
    </Link>
  );
}
