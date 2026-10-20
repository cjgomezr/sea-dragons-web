"use client";

import { useSearchParams } from "next/navigation";
import {
  CLUB_SETTINGS_SECTION_QUERY_PARAM,
  type ClubSettingsSection,
  readClubSettingsSection,
  searchWithClubSettingsSection,
} from "@/lib/club/club-settings-sections";

/** La marca de las entradas de la historia que abrió esta pantalla. */
const SECTION_ENTRY_KEY = "seadragonsClubSettingsSection";

function isSectionEntry(state: unknown): boolean {
  return (
    typeof state === "object" && state !== null && SECTION_ENTRY_KEY in state
  );
}

/** Si la sección se abrió desde la lista, se deshace con el atrás; si se
 * llegó por un enlace a ella, se reemplaza. Ninguno deja entrada nueva. */
function returnToList(listUrl: string): void {
  if (isSectionEntry(window.history.state)) {
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", listUrl);
}

/**
 * La sección de la configuración del club que dice la dirección (#718, D9)
 * y cómo cambiarla. Sólo la usa el Admin: el Committee no elige sección.
 *
 * Se cambia con `pushState`, que el router de Next.js sigue desde
 * `useSearchParams`, como las pestañas de Pagos: no se pide la página otra
 * vez y el atrás del navegador vuelve a la sección anterior. Volver a la
 * lista del móvil no deja entrada nueva: con otra de /club en la historia,
 * el atrás de la lista caía en la sección que se acababa de dejar.
 */
export function useClubSettingsSection(): {
  /** `null` si la dirección no pide ninguna que exista. */
  readonly requested: ClubSettingsSection | null;
  readonly select: (section: ClubSettingsSection | null) => void;
} {
  const searchParams = useSearchParams();
  const requested = readClubSettingsSection(
    searchParams.get(CLUB_SETTINGS_SECTION_QUERY_PARAM),
    true,
  );
  function select(section: ClubSettingsSection | null): void {
    if (section === requested) {
      return;
    }
    const search = searchWithClubSettingsSection(searchParams, section);
    const url = `${window.location.pathname}${search}`;
    if (section === null) {
      returnToList(url);
      return;
    }
    window.history.pushState({ [SECTION_ENTRY_KEY]: true }, "", url);
  }
  return { requested, select };
}
