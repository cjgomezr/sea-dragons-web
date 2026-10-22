import type { ProfileContact } from "./profile-contact";

/**
 * El aviso que recuerda los datos de contacto que faltan (#498, RF-2 del PRD
 * de E19). El contacto de emergencia es obligatorio pero no bloquea nada
 * (D2): su aviso no se cierra hasta que se complete. El teléfono propio es un
 * favor que se pide, y su aviso sí se cierra. Cuando faltan los dos, un solo
 * aviso pide los dos.
 */

export type ContactReminder = "none" | "phone" | "emergency_contact" | "both";

export function contactReminderOf(contact: ProfileContact): ContactReminder {
  const isPhoneMissing = contact.phone === null;
  if (contact.emergencyContact !== null) {
    return isPhoneMissing ? "phone" : "none";
  }
  return isPhoneMissing ? "both" : "emergency_contact";
}

/** Sólo el del teléfono: mientras falte el contacto, el aviso se queda. */
export function isDismissibleReminder(reminder: ContactReminder): boolean {
  return reminder === "phone";
}

/** Lo que la franja del perfil (#771, D8 del PRD de E30) pide completar, en
 * el orden en que lo pide: primero lo obligatorio, y después los datos de
 * jugador que el alta ya no exige (#861, D13 del PRD de E33). */
export const MISSING_PROFILE_ITEMS = [
  "emergency_contact",
  "phone",
  "country",
  "position",
  "experience_level",
  "gender",
] as const;

export type MissingProfileItem = (typeof MISSING_PROFILE_ITEMS)[number];

export type ProfileCompleteness = {
  readonly missing: readonly MissingProfileItem[];
  /** De 0 a 100, entero. */
  readonly percent: number;
};

/** Lo que la franja mira de la ficha. */
export type CompletableProfile = ProfileContact & {
  readonly country: string | null;
  readonly positionId: string | null;
  readonly experienceLevel: string | null;
  readonly gender: string | null;
};

/** Lo que la franja necesita saber del club: sin posiciones activas no hay
 * cuál elegir, así que la posición ni se pide ni se cuenta. */
export type CompletenessContext = { readonly hasActivePositions: boolean };

/** El nombre y el correo: sin ellos no hay cuenta, así que siempre están y
 * cuentan como hechos. Por eso a quien le falta todo no le sale un 0. */
const ALWAYS_PRESENT_ITEMS = 2;
/** El porcentaje va de 0 a esto. */
export const PERCENT_MAX = 100;

const MISSING_CONTACT: Readonly<
  Record<ContactReminder, readonly MissingProfileItem[]>
> = {
  none: [],
  phone: ["phone"],
  emergency_contact: ["emergency_contact"],
  both: ["emergency_contact", "phone"],
};

/** Los datos de la ficha que no son de contacto, cada uno con si falta. */
function missingProfileDataOf(
  profile: CompletableProfile,
  { hasActivePositions }: CompletenessContext,
): readonly MissingProfileItem[] {
  const isMissing: readonly (readonly [MissingProfileItem, boolean])[] = [
    ["country", profile.country === null],
    ["position", hasActivePositions && profile.positionId === null],
    ["experience_level", profile.experienceLevel === null],
    ["gender", profile.gender === null],
  ];
  return isMissing.flatMap(([item, missing]) => (missing ? [item] : []));
}

/** El contacto de emergencia y el teléfono, con la misma regla que el aviso
 * de contacto (D8); después el país y los datos de jugador (D13). */
export function profileCompletenessOf(
  profile: CompletableProfile,
  context: CompletenessContext,
): ProfileCompleteness {
  const missing: readonly MissingProfileItem[] = [
    ...MISSING_CONTACT[contactReminderOf(profile)],
    ...missingProfileDataOf(profile, context),
  ];
  const askedItems = MISSING_PROFILE_ITEMS.filter(
    (item) => context.hasActivePositions || item !== "position",
  );
  const countedItems = ALWAYS_PRESENT_ITEMS + askedItems.length;
  return {
    missing,
    percent: Math.round(
      ((countedItems - missing.length) / countedItems) * PERCENT_MAX,
    ),
  };
}
