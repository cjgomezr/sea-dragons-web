import {
  type ContactDraft,
  contactDraftOf,
  toContactSubmission,
} from "@/components/account/OwnContactSection";
import type { Translator } from "@/lib/i18n/translator";
import type { MemberRecord } from "@/lib/members/member-record";
import {
  type ContactField,
  type ProfileContactSubmission,
  isSamePhone,
} from "@/lib/members/profile-contact";
import { TextField } from "./record-fields";

/**
 * El teléfono y el contacto de emergencia de un socio en su ficha (#499,
 * RF-3 del PRD de E19): el Admin los corrige, por ejemplo si se los pasaron
 * por mensaje. Son los mismos controles y las mismas reglas que el perfil
 * propio (#496), con los textos escritos sobre el socio y no sobre quien
 * rellena.
 *
 * Sin tocar no se mandan: el socio puede haberlos cambiado desde que se
 * abrió la ficha, y mandar los de entonces los pisaría.
 */

const PHONE_ID = "ficha-telefono";
const EMERGENCY_HINT_ID = "ficha-emergencia-pista";
const SAME_PHONE_ID = "ficha-emergencia-mismo-telefono";

export function recordContactDraftOf(record: MemberRecord): ContactDraft {
  return contactDraftOf(record, null);
}

function isContactUntouched(
  record: MemberRecord,
  draft: ContactDraft,
): boolean {
  const saved = recordContactDraftOf(record);
  return (
    draft.phone === saved.phone &&
    draft.emergencyContactName === saved.emergencyContactName &&
    draft.emergencyContactPhone === saved.emergencyContactPhone &&
    draft.emergencyContactRelationship === saved.emergencyContactRelationship
  );
}

/** Null es no tocarlo. Vacío va como null, y a medias va tal cual, para que
 * el aviso diga qué falta. */
export function toRecordContactSubmission(
  record: MemberRecord,
  draft: ContactDraft,
): ProfileContactSubmission | null {
  return isContactUntouched(record, draft)
    ? null
    : toContactSubmission(draft, null);
}

export function MemberRecordContact({
  translate,
  fullName,
  draft,
  issueTextOf,
  onChange,
}: {
  translate: Translator;
  /** El nombre del socio, que los textos usan para no hablarle a quien
   * rellena. */
  fullName: string;
  draft: ContactDraft;
  /** El aviso de un campo, o null si no tiene ninguno. */
  issueTextOf: (field: ContactField) => string | null;
  onChange: (change: Partial<ContactDraft>) => void;
}): React.JSX.Element {
  const isOwnPhone = isSamePhone(draft.phone, draft.emergencyContactPhone);
  return (
    <section className="auth-fields" aria-labelledby="ficha-contacto">
      <h2 id="ficha-contacto">{translate("memberRecord.contact.title")}</h2>
      <TextField
        id={PHONE_ID}
        label={translate("memberRecord.contact.phone")}
        type="tel"
        value={draft.phone}
        issueText={issueTextOf("phone")}
        onChange={(phone) => onChange({ phone })}
      />
      <fieldset
        className="account-emergency-contact"
        aria-describedby={EMERGENCY_HINT_ID}
      >
        <legend>{translate("memberRecord.contact.emergencyLegend")}</legend>
        <p className="auth-hint" id={EMERGENCY_HINT_ID}>
          {translate("memberRecord.contact.emergencyHint", { name: fullName })}
        </p>
        <TextField
          id="ficha-emergencia-nombre"
          label={translate("memberRecord.contact.emergencyName")}
          type="text"
          value={draft.emergencyContactName}
          issueText={issueTextOf("emergencyContactName")}
          onChange={(emergencyContactName) =>
            onChange({ emergencyContactName })
          }
        />
        <TextField
          id="ficha-emergencia-telefono"
          label={translate("memberRecord.contact.emergencyPhone")}
          type="tel"
          value={draft.emergencyContactPhone}
          issueText={issueTextOf("emergencyContactPhone")}
          hintIds={isOwnPhone ? [SAME_PHONE_ID] : []}
          onChange={(emergencyContactPhone) =>
            onChange({ emergencyContactPhone })
          }
        />
        {isOwnPhone ? (
          <p className="auth-hint" id={SAME_PHONE_ID}>
            {translate("memberRecord.contact.samePhone", { name: fullName })}
          </p>
        ) : null}
        <TextField
          id="ficha-emergencia-relacion"
          label={translate("memberRecord.contact.emergencyRelationship")}
          type="text"
          value={draft.emergencyContactRelationship}
          issueText={issueTextOf("emergencyContactRelationship")}
          onChange={(emergencyContactRelationship) =>
            onChange({ emergencyContactRelationship })
          }
        />
      </fieldset>
    </section>
  );
}
