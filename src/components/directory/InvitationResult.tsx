"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { EnvelopeOpen } from "@phosphor-icons/react/dist/ssr/EnvelopeOpen";
import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/lib/auth/password-recovery";
import { memberRecordHref } from "@/lib/auth/routes";
import { firstNameOf } from "@/lib/dashboard/dashboard-view";
import type { Translator } from "@/lib/i18n/translator";
import { InvitationResend } from "./InvitationResend";
import type { CreatedMemberView } from "./new-member-client";

/**
 * Lo que enseña el panel de invitar después del alta (#863, RF-10 del PRD de
 * E33; docs/design/design_handoff_invite, "Result states"): la invitación
 * enviada, o el socio añadido sin correo, con Reenviar. Un reenvío que sale
 * pasa a "enviada otra vez". Los dos estados ofrecen invitar a otro y abrir
 * la ficha del socio nuevo.
 */

type Outcome = "sent" | "resent" | "notSent";

function outcomeOf(created: CreatedMemberView, hasResent: boolean): Outcome {
  if (hasResent) {
    return "resent";
  }
  return created.invitation === "sent" ? "sent" : "notSent";
}

function describeOutcome(
  translate: Translator,
  outcome: Outcome,
  member: CreatedMemberView["member"],
): { readonly title: string; readonly text: string } {
  const { fullName: name, email } = member;
  if (outcome === "notSent") {
    return {
      title: translate("newMember.result.notSentTitle", {
        name: firstNameOf(name),
      }),
      text: translate("newMember.result.notSentText", { name }),
    };
  }
  return {
    title: translate(
      outcome === "sent"
        ? "newMember.result.sentTitle"
        : "newMember.result.resentTitle",
      { email },
    ),
    text: translate("newMember.result.sentText", {
      name,
      count: RECOVERY_LINK_LIFETIME_MINUTES,
    }),
  };
}

export function InvitationResult({
  translate,
  created,
  onInviteAnother,
}: {
  readonly translate: Translator;
  readonly created: CreatedMemberView;
  readonly onInviteAnother: () => void;
}): React.JSX.Element {
  const [hasResent, setHasResent] = useState(false);
  const outcome = outcomeOf(created, hasResent);
  const isSent = outcome !== "notSent";
  const { email, userId, fullName } = created.member;
  const { title, text } = describeOutcome(translate, outcome, created.member);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // El formulario, y con él el botón que tenía el foco, ya no está; tras un
  // reenvío tampoco está Reenviar.
  useEffect(() => {
    titleRef.current?.focus();
  }, [outcome]);

  return (
    <div className="invite-result">
      <div className="invite-result-message" role={isSent ? "status" : "alert"}>
        <span
          className={
            isSent
              ? "invite-result-icon"
              : "invite-result-icon invite-result-icon-warning"
          }
          aria-hidden="true"
        >
          <Icon glyph={isSent ? Check : EnvelopeOpen} />
        </span>
        <h3 ref={titleRef} tabIndex={-1}>
          {title}
        </h3>
        <p>{text}</p>
      </div>
      <div className="invite-result-actions">
        {isSent ? null : (
          <InvitationResend
            translate={translate}
            userId={userId}
            isPrimary
            sentText={translate("newMember.result.resentTitle", { email })}
            onSent={() => setHasResent(true)}
          />
        )}
        <button
          type="button"
          className="admin-secondary invite-another"
          onClick={onInviteAnother}
        >
          <Icon glyph={UserPlus} />
          {translate("newMember.result.inviteAnother")}
        </button>
      </div>
      <Link className="invite-result-profile" href={memberRecordHref(userId)}>
        {translate("newMember.result.openProfile", {
          name: firstNameOf(fullName),
        })}
        <Icon glyph={ArrowRight} />
      </Link>
    </div>
  );
}
