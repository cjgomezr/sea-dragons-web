"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClubPositions } from "@/lib/club/club-positions";
import type { CountryOption } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type MissingProfileItem,
  profileCompletenessOf,
} from "@/lib/members/contact-reminder";
import type {
  EmergencyContactProposal,
  OwnProfile,
} from "@/lib/members/own-profile";
import { AboutCard, COUNTRY_ID, FULL_NAME_ID } from "./AboutCard";
import { AUF_NUMBER_ID, OwnAufCard } from "./OwnAufCard";
import {
  EMERGENCY_NAME_ID,
  type GuardianProposal,
  OwnContactCard,
  PHONE_ID,
} from "./OwnContactSection";
import { ProfileCompletionStrip } from "./ProfileCompletionStrip";
import { type CardRequest, useOpenCard } from "./use-open-card";

/**
 * Lo que el socio edita de su perfil (#241, FR-084): Sobre mí y Contacto
 * (#772) y el AUF que propone (#274, #773), en tarjetas que se leen primero y
 * se editan aparte. Nada más de lo que la decisión B3 reserva al Admin
 * aparece aquí, ni siquiera desactivado.
 *
 * Encima va la franja de lo que falta (#771): cada ficha abre su tarjeta con
 * el foco en el campo de ese dato. La franja sale de la ficha que trajo la
 * página, así que se va cuando el guardado la refresca.
 *
 * Es de cliente por el estado de las tarjetas. Da un cambio por hecho sólo
 * cuando el servidor lo confirma, y entonces refresca la página para que la
 * cabecera enseñe el nombre nuevo.
 */

type ProfileCard = "about" | "contact" | "auf";

const MISSING_ITEM_TARGETS = {
  emergency_contact: { card: "contact", focusFieldId: EMERGENCY_NAME_ID },
  phone: { card: "contact", focusFieldId: PHONE_ID },
  country: { card: "about", focusFieldId: COUNTRY_ID },
} as const satisfies Record<MissingProfileItem, CardRequest<ProfileCard>>;

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

  function handleCardSaved(card: ProfileCard, saved: OwnProfile): void {
    if (card === "contact") {
      setGuardian(null);
    }
    cards.closeSavedCard(card);
    setProfile(saved);
    router.refresh();
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
      <OwnAufCard
        translate={translate}
        profile={profile}
        {...cardStateOf("auf")}
        onEdit={() =>
          cards.openCard({ card: "auf", focusFieldId: AUF_NUMBER_ID })
        }
        onSaved={(saved) => handleCardSaved("auf", saved)}
        onCancel={cards.closeCard}
        onChanges={cards.reportChanges}
      />
    </>
  );
}
