import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import {
  type MembershipStatus,
  isStatusCurrent,
} from "@/lib/membership/membership";
import type { RowMark } from "./auf-marks";

const STATUS_KEYS = {
  pending: "directory.mark.membership.pending",
  trialing: "directory.mark.membership.trialing",
  active: "directory.mark.membership.active",
  past_due: "directory.mark.membership.pastDue",
  cancelled: "directory.mark.membership.cancelled",
  waived: "directory.mark.membership.waived",
} as const satisfies Record<MembershipStatus, MessageKey>;

/**
 * El chip del estado de la membresía que sólo ve un Admin (#453), el mismo en
 * la fila del directorio y en la cabecera de la ficha. Lo que no está al día
 * pide hacer algo, como el AUF vencido; sin membresía tampoco lo está.
 */
export function membershipMarkOf(
  translate: Translator,
  status: MembershipStatus | null,
): RowMark {
  if (status === null) {
    return {
      text: translate("directory.mark.membership.none"),
      tone: "warning",
    };
  }
  return {
    text: translate(STATUS_KEYS[status]),
    tone: isStatusCurrent(status) ? "neutral" : "warning",
  };
}
