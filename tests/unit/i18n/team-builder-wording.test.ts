import { describe, expect, it } from "vitest";
import { englishMessages } from "@/lib/i18n/messages/en";
import { spanishMessages } from "@/lib/i18n/messages/es";

/**
 * El Team builder ya no tiene el segmento Manual/Auto ni un botón aparte para
 * equilibrar (#758, D8 del PRD de E28): un solo Auto-balance hace las dos
 * cosas. Sus textos viejos no deben quedar en los catálogos.
 */

const CATALOGS = [
  ["en", englishMessages],
  ["es", spanishMessages],
] as const;

const RETIRED_KEYS = ["teams.mode.manual", "teams.mode.auto"];

const RETIRED_TEXTS = ["Equilibrar equipos", "Balancear equipos"];

describe.each(CATALOGS)("el catálogo %s", (_locale, messages) => {
  it.each(RETIRED_KEYS)("ya no tiene %s", (key) => {
    expect(Object.keys(messages)).not.toContain(key);
  });

  it.each(RETIRED_TEXTS)("ya no dice %s", (text) => {
    expect(JSON.stringify(messages)).not.toContain(text);
  });
});
