import { formatAudCents, formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { formatCardBrand } from "./card-brand";
import type { MembershipCard } from "./membership";

/**
 * El cobro de una renovación tal como se le cuenta al socio (#470, RF-8 del
 * PRD de E13, D3). Lo comparten el aviso de la campana y el correo, para que
 * los dos digan lo mismo con las mismas palabras.
 */
export type RenewalCharge = {
  /** Centavos enteros en AUD (CON-005). */
  readonly amountCents: number;
  /** `YYYY-MM-DD`: el día de Melbourne en que se cobra. */
  readonly chargeOn: string;
  readonly card: Pick<MembershipCard, "brand" | "last4"> | null;
};

export function formatRenewalDay(
  translate: Translator,
  charge: RenewalCharge,
): string {
  return formatCalendarDay(translate.locale, charge.chargeOn);
}

/** Sin tarjeta guardada no se nombra ninguna: Stripe cobra con la que tenga. */
export function describeRenewalCharge(
  translate: Translator,
  charge: RenewalCharge,
): string {
  const amount = formatAudCents(translate.locale, charge.amountCents);
  const date = formatRenewalDay(translate, charge);
  if (charge.card === null) {
    return translate("membership.renewal.chargeWithoutCard", { amount, date });
  }
  return translate("membership.renewal.charge", {
    amount,
    date,
    card: translate("membership.renewal.card", {
      brand: formatCardBrand(charge.card.brand),
      last4: charge.card.last4,
    }),
  });
}
