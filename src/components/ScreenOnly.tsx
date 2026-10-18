"use client";

import type { ReactNode } from "react";
import { useIsPhoneOnceKnown } from "@/components/use-is-phone";

type ScreenKind = "phone" | "desktop";

/**
 * Lo que sólo se monta en un tamaño de pantalla (#717): la campana y la
 * cuenta van en la cabecera del móvil o en la barra de arriba de escritorio,
 * nunca en las dos. Montarlas dos veces duplicaría la consulta de avisos de
 * cada minuto y los menús que escuchan la misma petición de abrirse.
 *
 * Hasta hidratar no se sabe el ancho y se pintan las dos copias: cada una vive
 * en un contenedor que la hoja de estilos ya esconde en el otro tamaño, así
 * que ninguno de los dos ve la cabecera vacía mientras carga.
 */
export function ScreenOnly({
  screen,
  children,
}: {
  screen: ScreenKind;
  children: ReactNode;
}): ReactNode {
  const isPhone = useIsPhoneOnceKnown();
  if (isPhone === null || isPhone === (screen === "phone")) {
    return children;
  }
  return null;
}
