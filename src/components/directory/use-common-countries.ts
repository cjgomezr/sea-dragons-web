import { useEffect, useState } from "react";
import type { CountryCode } from "@/lib/geo/countries";
import { loadCommonCountries } from "./common-countries-client";

/** Ninguno mientras llegan o si la petición falla. */
const NO_COMMON_COUNTRIES: readonly CountryCode[] = [];

/**
 * Los países más comunes del club para el selector del panel de invitar
 * (#864). No bloquean el formulario como los grupos y las posiciones: hasta
 * que llegan, o si fallan, el selector ofrece sólo la lista entera.
 */
export function useCommonCountries(): readonly CountryCode[] {
  const [countries, setCountries] =
    useState<readonly CountryCode[]>(NO_COMMON_COUNTRIES);

  useEffect(() => {
    let isCurrent = true;
    void loadCommonCountries().then((loaded) => {
      if (isCurrent && loaded.kind === "loaded") {
        setCountries(loaded.countries);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  return countries;
}
