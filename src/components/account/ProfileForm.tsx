"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { RequestFailure } from "@/components/auth/request-failure";
import type { ClubPositions } from "@/lib/club/club-positions";
import type { CountryOption } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type MissingProfileItem,
  profileCompletenessOf,
} from "@/lib/members/contact-reminder";
import {
  type AufProposal,
  type EmergencyContactProposal,
  type OwnAuf,
  type OwnProfile,
  type OwnProfileSubmission,
  type ProfileIssueCode,
  validateAufNumber,
} from "@/lib/members/own-profile";
import { AboutCard, COUNTRY_ID, FULL_NAME_ID } from "./AboutCard";
import { type AufDraft, OwnAufSection } from "./OwnAufSection";
import {
  EMERGENCY_NAME_ID,
  type GuardianProposal,
  OwnContactCard,
  PHONE_ID,
} from "./OwnContactSection";
import { ProfileCompletionStrip } from "./ProfileCompletionStrip";
import {
  describeProfileFailure,
  describeProfileIssue,
  saveOwnProfile,
} from "./profile-client";
import { type CardRequest, useOpenCard } from "./use-open-card";

/**
 * Lo que el socio edita de su perfil (#241, FR-084): Sobre mí y Contacto, en
 * tarjetas que se leen primero y se editan aparte (#772), y el AUF que propone
 * (#274), que sigue siendo un formulario hasta su propio ticket de E30. Nada
 * más de lo que la decisión B3 reserva al Admin aparece aquí, ni siquiera
 * desactivado.
 *
 * Encima va la franja de lo que falta (#771): cada ficha abre su tarjeta con
 * el foco en el campo de ese dato. La franja sale de la ficha que trajo la
 * página, así que se va cuando el guardado la refresca.
 *
 * Es de cliente por el estado de las tarjetas. Da un cambio por hecho sólo
 * cuando el servidor lo confirma, y entonces refresca la página para que la
 * cabecera enseñe el nombre nuevo.
 */

type ProfileCard = "about" | "contact";

const MISSING_ITEM_TARGETS = {
  emergency_contact: { card: "contact", focusFieldId: EMERGENCY_NAME_ID },
  phone: { card: "contact", focusFieldId: PHONE_ID },
  country: { card: "about", focusFieldId: COUNTRY_ID },
} as const satisfies Record<MissingProfileItem, CardRequest<ProfileCard>>;

type AufStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "saved" }
  | {
      readonly kind: "failed";
      readonly failure: RequestFailure;
      readonly reason: string | null;
    };

function aufDraftOf(auf: OwnAuf): AufDraft {
  return {
    aufNumber: auf.status === "none" ? "" : auf.number,
    aufExpiry: auf.status === "none" ? "" : (auf.expiry ?? ""),
  };
}

/** Un AUF verificado no se manda: sólo lo cambia un Admin. Tampoco unos
 * campos que siguen vacíos sin haber AUF, que no proponen nada. */
function toAufProposal(draft: AufDraft, auf: OwnAuf): AufProposal | null {
  const isUntouchedEmpty =
    auf.status === "none" && draft.aufNumber === "" && draft.aufExpiry === "";
  if (auf.status === "verified" || isUntouchedEmpty) {
    return null;
  }
  return {
    number: draft.aufNumber,
    expiry: draft.aufExpiry === "" ? null : draft.aufExpiry,
  };
}

/** El AUF va con el resto del perfil tal como está guardado: la API pide los
 * campos del perfil siempre. */
function toAufSubmission(
  profile: OwnProfile,
  auf: AufProposal | null,
): OwnProfileSubmission {
  return {
    fullName: profile.fullName,
    country: profile.country ?? "",
    positionId: profile.positionId,
    experienceLevel: profile.experienceLevel,
    gender: profile.gender,
    phone: profile.phone,
    emergencyContact: profile.emergencyContact,
    auf,
  };
}

function guardianProposalOf(
  translate: Translator,
  proposal: EmergencyContactProposal | null,
): GuardianProposal | null {
  return proposal === null
    ? null
    : {
        name: proposal.guardianName,
        relationship: translate("account.profile.contact.guardianRelationship"),
      };
}

function AufOutcome({
  translate,
  status,
}: {
  translate: Translator;
  status: AufStatus;
}): React.JSX.Element | null {
  switch (status.kind) {
    case "saved":
      return (
        <p className="profile-strip profile-strip-success" role="status">
          <CheckCircle aria-hidden="true" weight="regular" />
          {translate("account.profile.saved")}
        </p>
      );
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {describeProfileFailure(translate, status.failure, status.reason)}
        </p>
      );
    default:
      return null;
  }
}

/** El AUF que propone el socio (#274), con su Guardar de siempre. */
function AufForm({
  translate,
  locale,
  profile,
  onSaved,
}: {
  translate: Translator;
  locale: Locale;
  profile: OwnProfile;
  onSaved: (profile: OwnProfile) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => aufDraftOf(profile.auf));
  const [numberIssue, setNumberIssue] = useState<ProfileIssueCode | null>(null);
  const [status, setStatus] = useState<AufStatus>({ kind: "editing" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  function update(change: Partial<AufDraft>): void {
    setDraft((current) => ({ ...current, ...change }));
    if ("aufNumber" in change) {
      setNumberIssue(null);
    }
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "editing" },
    );
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSendingRef.current) {
      return;
    }
    const proposal = toAufProposal(draft, profile.auf);
    const issue = proposal === null ? null : validateAufNumber(proposal.number);
    if (issue !== null) {
      setNumberIssue(issue);
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await saveOwnProfile(toAufSubmission(profile, proposal));
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus(result);
      return;
    }
    setDraft(aufDraftOf(result.profile.auf));
    setStatus({ kind: "saved" });
    onSaved(result.profile);
  }

  const isSending = status.kind === "sending";
  return (
    <form className="auth-pending" onSubmit={handleSubmit} noValidate>
      <OwnAufSection
        translate={translate}
        locale={locale}
        auf={profile.auf}
        draft={draft}
        numberIssueText={
          numberIssue === null
            ? null
            : describeProfileIssue(translate, numberIssue)
        }
        onChange={update}
      />
      <AufOutcome translate={translate} status={status} />
      <button type="submit" className="auth-submit" disabled={isSending}>
        {translate(
          isSending ? "account.profile.saving" : "account.profile.save",
        )}
      </button>
    </form>
  );
}

export function ProfileForm({
  locale,
  email,
  profile: initialProfile,
  positionOptions,
  countries,
  emergencyContactProposal,
}: {
  locale: Locale;
  /** El correo de la cuenta, que Contacto enseña bajo el teléfono. */
  email: string;
  profile: OwnProfile;
  positionOptions: ClubPositions;
  countries: readonly CountryOption[];
  emergencyContactProposal: EmergencyContactProposal | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  // La propuesta es para la primera vez: quien guardó su contacto ya decidió,
  // aunque fuera dejarlo vacío.
  const [guardian, setGuardian] = useState(() =>
    guardianProposalOf(translate, emergencyContactProposal),
  );
  const cards = useOpenCard<ProfileCard>(
    translate("profileCard.discardQuestion"),
  );

  function applySaved(saved: OwnProfile): void {
    setProfile(saved);
    router.refresh();
  }

  function handleCardSaved(card: ProfileCard, saved: OwnProfile): void {
    if (card === "contact") {
      setGuardian(null);
    }
    cards.closeSavedCard(card);
    applySaved(saved);
  }

  function cardStateOf(card: ProfileCard): {
    readonly isEditing: boolean;
    readonly focusFieldId: string;
    readonly savedText: string | null;
  } {
    const isEditing = cards.open !== null && cards.open.card === card;
    return {
      isEditing,
      focusFieldId: isEditing ? cards.open.focusFieldId : "",
      savedText:
        cards.savedCard === card
          ? translate(`profileCard.${card}.saved`)
          : null,
    };
  }

  return (
    <>
      <ProfileCompletionStrip
        locale={locale}
        completeness={profileCompletenessOf(initialProfile)}
        onAdd={(item) => cards.openCard(MISSING_ITEM_TARGETS[item])}
      />
      <AboutCard
        translate={translate}
        profile={profile}
        positionOptions={positionOptions}
        countries={countries}
        {...cardStateOf("about")}
        onEdit={() =>
          cards.openCard({ card: "about", focusFieldId: FULL_NAME_ID })
        }
        onSaved={(saved) => handleCardSaved("about", saved)}
        onCancel={cards.closeCard}
        onChanges={cards.reportChanges}
      />
      <OwnContactCard
        translate={translate}
        profile={profile}
        email={email}
        guardian={guardian}
        {...cardStateOf("contact")}
        onEdit={() =>
          cards.openCard({ card: "contact", focusFieldId: PHONE_ID })
        }
        onSaved={(saved) => handleCardSaved("contact", saved)}
        onCancel={cards.closeCard}
        onChanges={cards.reportChanges}
      />
      <AufForm
        translate={translate}
        locale={locale}
        profile={profile}
        onSaved={applySaved}
      />
    </>
  );
}
