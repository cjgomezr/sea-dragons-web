"use client";

import { useSearchParams } from "next/navigation";
import {
  CLUB_SETTINGS_SECTION_QUERY_PARAM,
  type ClubSettingsSection,
  readClubSettingsSection,
  searchWithClubSettingsSection,
} from "@/lib/club/club-settings-sections";

/**
 * La sección de la configuración del club que dice la dirección (#718, D9)
 * y cómo cambiarla. Sólo la usa el Admin: el Committee no elige sección.
 *
 * Se cambia con `pushState`, que el router de Next.js sigue desde
 * `useSearchParams`, como las pestañas de Pagos: no se pide la página otra
 * vez y el atrás del navegador vuelve a la sección anterior.
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
    window.history.pushState(null, "", `${window.location.pathname}${search}`);
  }
  return { requested, select };
}
