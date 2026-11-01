"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useIsPhone } from "@/components/use-is-phone";

/** La declara `:root` en globals.css con el alto de una sola línea; aquí se
 * sustituye por el que mide de verdad la cabecera. */
const HEIGHT_PROPERTY = "--app-phone-header-height";

function publishHeight(header: HTMLElement): void {
  const height = header.getBoundingClientRect().height;
  document.documentElement.style.setProperty(HEIGHT_PROPERTY, `${height}px`);
}

function clearHeight(): void {
  document.documentElement.style.removeProperty(HEIGHT_PROPERTY);
}

/**
 * La cabecera de la app (#957). En el móvil se queda fija arriba, y las
 * barras de las pantallas que se pegan arriba empiezan justo debajo de ella.
 * Su alto no es fijo (un nombre largo junto al logo se parte en dos líneas),
 * así que lo mide y lo publica en `:root` mientras esté montada. Desde
 * 768 px es la barra lateral, del alto de la ventana: no publica nada.
 */
export function PhoneHeader({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const headerRef = useRef<HTMLElement>(null);
  const isPhone = useIsPhone();

  useEffect(() => {
    const header = headerRef.current;
    if (!isPhone || header === null) return;
    publishHeight(header);
    const observer = new ResizeObserver(() => publishHeight(header));
    observer.observe(header);
    return () => {
      observer.disconnect();
      clearHeight();
    };
  }, [isPhone]);

  return (
    <aside ref={headerRef} className="app-sidebar">
      {children}
    </aside>
  );
}
