"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretUp } from "@phosphor-icons/react/dist/ssr/CaretUp";
import { EnvelopeOpen } from "@phosphor-icons/react/dist/ssr/EnvelopeOpen";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/lib/auth/password-recovery";
import { memberInvitationContent } from "@/lib/email/member-invitation-content";
import type { Translator } from "@/lib/i18n/translator";

/**
 * "Lo que recibirá {nombre}" (#862, RF-9 del PRD de E33): el correo de la
 * invitación tal como sale, con el mismo texto que arma la plantilla y el
 * mismo enlace de una hora que usa quien lo manda. El botón es de mentira:
 * en la vista previa no lleva a ninguna parte.
 */

export function InvitationPreview({
  translate,
  clubName,
  firstName,
  email,
}: {
  readonly translate: Translator;
  readonly clubName: string;
  /** Null mientras no se ha escrito el nombre. */
  readonly firstName: string | null;
  readonly email: string;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const toggleId = useId();
  const regionId = useId();
  const content = memberInvitationContent(translate, {
    clubName,
    linkLifetimeMinutes: RECOVERY_LINK_LIFETIME_MINUTES,
  });
  const trimmedEmail = email.trim();
  return (
    <div className="invite-preview">
      <button
        type="button"
        id={toggleId}
        className="invite-preview-toggle"
        aria-expanded={isOpen}
        aria-controls={regionId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Icon glyph={EnvelopeOpen} />
        <span className="invite-preview-title">
          {firstName === null
            ? translate("newMember.preview.titleUnnamed")
            : translate("newMember.preview.titleNamed", { name: firstName })}
        </span>
        <Icon glyph={isOpen ? CaretUp : CaretDown} />
      </button>
      <div
        className="invite-preview-body"
        id={regionId}
        role="region"
        aria-labelledby={toggleId}
        hidden={!isOpen}
      >
        <p className="invite-preview-envelope">
          {translate("newMember.preview.from")} <strong>{clubName}</strong>
          {" · "}
          {translate("newMember.preview.to")}{" "}
          <strong>
            {trimmedEmail === ""
              ? translate("newMember.preview.noEmail")
              : trimmedEmail}
          </strong>
        </p>
        <p className="invite-preview-subject">{content.subject}</p>
        {content.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <span className="invite-preview-button">{content.buttonLabel}</span>
        {content.outro.map((paragraph) => (
          <p className="invite-preview-note" key={paragraph}>
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
