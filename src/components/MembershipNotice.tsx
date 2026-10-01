import Link from "next/link";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipBlock } from "@/lib/membership/membership";

const BLOCK_REASON_KEYS = {
  pending: "membership.block.pending",
  past_due: "membership.block.pastDue",
  cancelled: "membership.block.cancelled",
} as const satisfies Record<MembershipBlock, MessageKey>;

/**
 * El aviso de quien no tiene la membresía al día (#453): el motivo y lo que
 * pierde hasta ponerse al día. Fuera de Pagos lleva además el enlace a Pagos,
 * que es donde se arregla.
 */
export function MembershipNotice({
  translate,
  block,
  linksToPayments,
}: {
  readonly translate: Translator;
  readonly block: MembershipBlock;
  readonly linksToPayments: boolean;
}): React.JSX.Element {
  return (
    <div className="membership-notice">
      <p>{translate(BLOCK_REASON_KEYS[block])}</p>
      <p>{translate("membership.block.scope")}</p>
      {linksToPayments ? (
        <Link href={PAYMENTS_PATH}>
          {translate("calendar.membership.toPayments")}
        </Link>
      ) : null}
    </div>
  );
}
