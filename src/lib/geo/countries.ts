/** Códigos ISO 3166-1 alfa-2. FR-001 pide el país en el registro, y guardarlo
 * como código en vez de como texto libre es lo que permite validarlo en el
 * servidor y traducirlo después sin migrar datos. El nombre visible lo pone
 * `Intl.DisplayNames`, así que esta lista no se traduce a mano. */
// prettier-ignore
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT",
  "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI",
  "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY",
  "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK",
  "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL",
  "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR",
  "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS",
  "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW",
  "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP",
  "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM",
  "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF",
  "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW",
  "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(COUNTRY_CODES);

/** Acepta el código en cualquier caja: un cliente de la API puede mandar "au"
 * y sigue siendo Australia. */
export function isKnownCountryCode(value: string): boolean {
  return KNOWN_CODES.has(value.trim().toUpperCase());
}

/** El nombre visible de un país en el idioma pedido, para enseñar un código
 * que ya está guardado (el directorio, #239). Un código que no está en el
 * catálogo devuelve `null`: quien llama decide qué pone en su lugar, en vez de
 * recibir de vuelta un código que nadie reconoce. */
export function countryName(locale: string, code: string): string | null {
  const normalized = code.trim().toUpperCase();
  if (!KNOWN_CODES.has(normalized)) {
    return null;
  }
  return (
    new Intl.DisplayNames([locale], { type: "region" }).of(normalized) ?? null
  );
}

export type CountryOption = {
  readonly code: CountryCode;
  readonly name: string;
};

/** Opciones del selector de país, ya ordenadas por nombre en el idioma pedido.
 * Ordenar por código dejaría el desplegable en un orden que nadie reconoce. */
export function listCountryOptions(locale: string): readonly CountryOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  return COUNTRY_CODES.map((code) => ({
    code,
    name: displayNames.of(code) ?? code,
  })).sort((first, second) => first.name.localeCompare(second.name, locale));
}
