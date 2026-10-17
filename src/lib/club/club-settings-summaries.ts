import type { Translator } from "@/lib/i18n/translator";
import type { ClubSettings } from "./club-settings";
import type { ManagedPositions } from "./manage-club-positions";
import type { SignInTexts, SignInTextsInLocale } from "./sign-in-texts";

/**
 * Los resúmenes de una línea de la lista de la configuración en el móvil
 * (#718, #3a del handoff de E26). Salen de lo que el club tiene guardado,
 * no de un texto fijo: "6 posiciones · 1 archivada".
 */

const LIST_SEPARATOR = ", ";
const PART_SEPARATOR = " · ";

/** Lo que el club tiene puesto de su identidad: el nombre y el color
 * siempre, las iniciales y el logo si los hay. */
export function summarizeGeneral(
  translate: Translator,
  settings: ClubSettings,
): string {
  const parts = [
    translate("clubSettings.summary.general.name"),
    settings.initials === null
      ? null
      : translate("clubSettings.summary.general.initials"),
    translate("clubSettings.summary.general.colour", {
      colour: settings.accentColor.toUpperCase(),
    }),
    settings.logoUrl === null
      ? null
      : translate("clubSettings.summary.general.logo"),
  ];
  return parts.filter((part) => part !== null).join(LIST_SEPARATOR);
}

function hasOwnText(texts: SignInTextsInLocale): boolean {
  return texts.tagline !== null || texts.welcome !== null;
}

function describeSignInSource(
  translate: Translator,
  texts: SignInTextsInLocale,
): string {
  return translate(
    hasOwnText(texts)
      ? "clubSettings.summary.signIn.custom"
      : "clubSettings.summary.signIn.appText",
  );
}

/** Qué idioma usa un texto propio del club y cuál el de la aplicación. */
export function summarizeSignInTexts(
  translate: Translator,
  texts: SignInTexts,
): string {
  return [
    `${translate("clubSettings.summary.signIn.english")}: ${describeSignInSource(translate, texts.en)}`,
    `${translate("clubSettings.summary.signIn.spanish")}: ${describeSignInSource(translate, texts.es)}`,
  ].join(PART_SEPARATOR);
}

/** Cuántas activas y, si las hay, cuántas archivadas. */
export function summarizePositions(
  translate: Translator,
  positions: ManagedPositions,
): string {
  const archived = positions.filter((position) => position.isArchived).length;
  const active = translate("clubSettings.summary.positions.active", {
    count: positions.length - archived,
  });
  if (archived === 0) {
    return active;
  }
  return [
    active,
    translate("clubSettings.summary.positions.archived", { count: archived }),
  ].join(PART_SEPARATOR);
}

/** Cuántos packs y sus sesiones en el orden del club. El plural de
 * "sesiones" lo pone el último número, que es el que va pegado. */
export function summarizeSessionPacks(
  translate: Translator,
  sizes: readonly number[],
): string {
  const last = sizes.at(-1);
  if (last === undefined) {
    return translate("clubSettings.summary.packs.none");
  }
  return [
    translate("clubSettings.summary.packs.count", { count: sizes.length }),
    translate("clubSettings.summary.packs.sessions", {
      count: last,
      sizes: sizes.join(LIST_SEPARATOR),
    }),
  ].join(PART_SEPARATOR);
}
