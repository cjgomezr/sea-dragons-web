import { TextField } from "@/components/directory/record-fields";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ContactField,
  type EmergencyContact,
  type ProfileContact,
  type ProfileContactSubmission,
  isSamePhone,
} from "@/lib/members/profile-contact";

/**
 * El teléfono y el contacto de emergencia dentro del perfil propio (#496).
 * Los dos son opcionales; el contacto va entero o no va, y el aviso de cada
 * dato que falta va junto a él. Que el contacto tenga el teléfono propio no
 * se impide: se avisa, porque quien llame en una emergencia necesita a otra
 * persona.
 */

const PHONE_ID = "perfil-telefono";
const EMERGENCY_HINT_ID = "perfil-emergencia-pista";
const GUARDIAN_PROPOSED_ID = "perfil-emergencia-tutor";
const SAME_PHONE_ID = "perfil-emergencia-mismo-telefono";

/** Lo que hay en los controles, con el nombre del campo al que se refiere
 * cada aviso. */
export type ContactDraft = Readonly<Record<ContactField, string>>;

/** Lo que el formulario propone a quien no tiene contacto: su tutor, con la
 * relación ya en el idioma de la pantalla y sin teléfono, porque del tutor
 * sólo se guarda el correo. */
export type GuardianProposal = Omit<EmergencyContact, "phone">;

export function contactDraftOf(
  contact: ProfileContact,
  proposal: GuardianProposal | null,
): ContactDraft {
  const emergency = contact.emergencyContact ?? {
    name: proposal === null ? "" : proposal.name,
    phone: "",
    relationship: proposal === null ? "" : proposal.relationship,
  };
  return {
    phone: contact.phone ?? "",
    emergencyContactName: emergency.name,
    emergencyContactPhone: emergency.phone,
    emergencyContactRelationship: emergency.relationship,
  };
}

/** La propuesta del tutor tal como se rellenó, sin que el socio la tocara. */
function isUntouchedProposal(
  draft: ContactDraft,
  proposal: GuardianProposal | null,
): boolean {
  return (
    proposal !== null &&
    draft.emergencyContactPhone.trim() === "" &&
    draft.emergencyContactName === proposal.name &&
    draft.emergencyContactRelationship === proposal.relationship
  );
}

/** Un teléfono vacío va como null, y un contacto con los tres datos vacíos
 * también. A medias va tal cual, para que el dominio diga qué falta. La
 * propuesta del tutor sin tocar va como null: es nuestra, no del socio, y no
 * debe impedirle guardar el resto del perfil. */
export function toContactSubmission(
  draft: ContactDraft,
  proposal: GuardianProposal | null,
): ProfileContactSubmission {
  const emergencyContact = {
    name: draft.emergencyContactName,
    phone: draft.emergencyContactPhone,
    relationship: draft.emergencyContactRelationship,
  };
  const isEmergencyEmpty = Object.values(emergencyContact).every(
    (value) => value.trim() === "",
  );
  return {
    phone: draft.phone.trim() === "" ? null : draft.phone,
    emergencyContact:
      isEmergencyEmpty || isUntouchedProposal(draft, proposal)
        ? null
        : emergencyContact,
  };
}

export function OwnContactSection({
  translate,
  draft,
  issueTextOf,
  isGuardianProposed,
  onChange,
}: {
  translate: Translator;
  draft: ContactDraft;
  /** El aviso de un campo, o null si no tiene ninguno. */
  issueTextOf: (field: ContactField) => string | null;
  /** El formulario rellenó al tutor (FR-082) porque no había contacto. */
  isGuardianProposed: boolean;
  onChange: (change: Partial<ContactDraft>) => void;
}): React.JSX.Element {
  const isOwnPhone = isSamePhone(draft.phone, draft.emergencyContactPhone);
  const groupHintIds = isGuardianProposed
    ? [EMERGENCY_HINT_ID, GUARDIAN_PROPOSED_ID]
    : [EMERGENCY_HINT_ID];
  return (
    <section className="auth-fields" aria-labelledby="perfil-contacto">
      <h3 id="perfil-contacto">{translate("account.profile.contact.title")}</h3>
      <TextField
        id={PHONE_ID}
        label={translate("account.profile.contact.phone")}
        type="tel"
        autoComplete="tel"
        value={draft.phone}
        issueText={issueTextOf("phone")}
        onChange={(phone) => onChange({ phone })}
      />
      <fieldset
        className="account-emergency-contact"
        aria-describedby={groupHintIds.join(" ")}
      >
        <legend>{translate("account.profile.contact.emergencyLegend")}</legend>
        <p className="auth-hint" id={EMERGENCY_HINT_ID}>
          {translate("account.profile.contact.emergencyHint")}
        </p>
        {isGuardianProposed ? (
          <p className="auth-hint" id={GUARDIAN_PROPOSED_ID}>
            {translate("account.profile.contact.guardianProposed")}
          </p>
        ) : null}
        <TextField
          id="perfil-emergencia-nombre"
          label={translate("account.profile.contact.emergencyName")}
          type="text"
          value={draft.emergencyContactName}
          issueText={issueTextOf("emergencyContactName")}
          onChange={(emergencyContactName) =>
            onChange({ emergencyContactName })
          }
        />
        <TextField
          id="perfil-emergencia-telefono"
          label={translate("account.profile.contact.emergencyPhone")}
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
            {translate("account.profile.contact.samePhone")}
          </p>
        ) : null}
        <TextField
          id="perfil-emergencia-relacion"
          label={translate("account.profile.contact.emergencyRelationship")}
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
