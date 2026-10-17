"use client";

import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/locale";
import { localeCookie } from "@/lib/i18n/locale-cookie";

/**
 * Cambiar de idioma (E17 RF-3). A diferencia del tema, el idioma no se puede
 * aplicar en el navegador: los textos los arma el servidor, que lo lee de la
 * cookie en cada petición. Por eso se escribe la cookie y se pide la pantalla
 * otra vez, y el idioma que muestra cada control llega como prop de esa
 * respuesta en vez de adivinarse en el navegador.
 *
 * `router.refresh()` y no una recarga completa: rehace los componentes de
 * servidor conservando el estado del navegador, así que lo escrito en un
 * formulario no se pierde. También invalida lo que el router tenía guardado
 * de otras pantallas, que estaba en el idioma anterior.
 *
 * Lo comparten el botón de las pantallas de entrada y el menú de la cuenta
 * (#716).
 */
export function useChooseLocale(): (locale: Locale) => void {
  const router = useRouter();
  return (locale) => {
    document.cookie = localeCookie(locale);
    router.refresh();
  };
}
