import { clubDaysBetween } from "@/lib/time/club-calendar";
import { isAufExpired } from "./member-record";

/**
 * Lo que la tarjeta del AUF dice junto al vencimiento (#773, RF-4 del PRD de
 * E30): cuántos días faltan, en aviso si son pocos, o que ya venció. Vence hoy
 * cuenta como vigente, igual que en `isAufExpired`.
 */

/** Por debajo de estos días el vencimiento sale en aviso (RF-4). */
export const AUF_EXPIRY_SOON_DAYS = 90;

export type AufExpiryOutlook =
  | { readonly kind: "expired" }
  | {
      readonly kind: "upcoming";
      readonly days: number;
      readonly isSoon: boolean;
    };

export function aufExpiryOutlookOf(
  expiry: string,
  todayInClub: string,
): AufExpiryOutlook {
  if (isAufExpired(expiry, todayInClub)) {
    return { kind: "expired" };
  }
  const days = clubDaysBetween(todayInClub, expiry);
  return { kind: "upcoming", days, isSoon: days < AUF_EXPIRY_SOON_DAYS };
}
