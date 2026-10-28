import { IdentificationCard } from "@phosphor-icons/react/dist/ssr/IdentificationCard";
import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import Link from "next/link";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipBlock } from "@/lib/membership/membership";

/**
 * La tarjeta de quien no está al día (#902, RF-6 y D2 del PRD de E35, §4.3
 * del handoff): por qué no ve el plan, según el motivo, y el botón a Pagos.
 * El handoff solo trae el de la membresía vencida; el PRD pide uno por
 * motivo.
 */

type LockTitle = Extract<
  MessageKey,
  | "training.member.lockedPending"
  | "training.member.lockedPastDue"
  | "training.member.lockedCancelled"
>;

const TITLE_BY_BLOCK: Readonly<Record<MembershipBlock, LockTitle>> = {
  pending: "training.member.lockedPending",
  past_due: "training.member.lockedPastDue",
  cancelled: "training.member.lockedCancelled",
};

export function TrainingLockCard({
  translate,
  block,
}: {
  readonly translate: Translator;
  readonly block: MembershipBlock;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section className="training-lock" aria-labelledby={headingId}>
      <span className="training-lock-tile">
        <Icon glyph={LockSimple} weight="fill" />
      </span>
      <h2 id={headingId}>{translate(TITLE_BY_BLOCK[block])}</h2>
      <p>{translate("training.member.lockedText")}</p>
      <Link href={PAYMENTS_PATH} className="training-lock-renew">
        <Icon glyph={IdentificationCard} />
        {translate("training.member.renewMembership")}
      </Link>
    </section>
  );
}
