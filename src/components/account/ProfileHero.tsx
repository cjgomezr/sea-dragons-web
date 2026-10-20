import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { SealCheck } from "@phosphor-icons/react/dist/ssr/SealCheck";
import { SealQuestion } from "@phosphor-icons/react/dist/ssr/SealQuestion";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { MemberAvatar } from "@/components/MemberAvatar";
import { membershipMarkOf } from "@/components/directory/membership-mark";
import type { Role } from "@/lib/auth/roles";
import { type PositionNames, positionName } from "@/lib/club/club-positions";
import { countryName } from "@/lib/geo/countries";
import { formatCalendarMonth } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { ExperienceLevel } from "@/lib/members/profile-fields";
import {
  type MembershipStatus,
  isStatusCurrent,
} from "@/lib/membership/membership";
import { HERO_AVATAR_SIZE, ProfilePhoto } from "./ProfilePhoto";

/**
 * La cabecera que comparten el perfil propio y la ficha de un socio (#771,
 * RF-2 del PRD de E30): la foto de 96 px con su anillo, el nombre, la píldora
 * del rol, "posición · experiencia · país" y las fichas de estado.
 *
 * Sólo el socio cambia su foto: en su perfil la foto es `ProfilePhoto`, con
 * el botón de cámara; en la ficha, el círculo a secas. La ficha del AUF no la
 * ve quien no debe ver el AUF (Committee y Coach): para ellos llega null.
 *
 * A la derecha, la ficha pone sus acciones (#775): los botones de contacto y
 * el ⋯ del Admin. El perfil propio no lleva ninguna.
 */

export type HeroAuf = {
  readonly isVerified: boolean;
  readonly isExpired: boolean;
};

export type HeroMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly role: Role;
  readonly positionNames: PositionNames | null;
  readonly experienceLevel: ExperienceLevel | null;
  /** El código del país, o null sin país. */
  readonly country: string | null;
  readonly membershipStatus: MembershipStatus | null;
  /** Null sin AUF, o para quien no debe verlo. */
  readonly auf: HeroAuf | null;
  /** YYYY-MM-DD, el día en que ingresó, o null para quien no lo ve: el
   * Committee y el Coach (#770). */
  readonly joinedOn: string | null;
  readonly photoUrl: string | null;
};

type Tone = "success" | "warning" | "danger";

type Chip = {
  readonly text: string;
  readonly tone: Tone;
  readonly icon: typeof CheckCircle;
};

/** El mismo texto que la fila del directorio ("Membresía activa", "Pago
 * atrasado"): al día va en éxito y, si no, en peligro. */
function membershipChipOf(
  translate: Translator,
  status: MembershipStatus | null,
): Chip {
  const { text } = membershipMarkOf(translate, status);
  return status !== null && isStatusCurrent(status)
    ? { text, tone: "success", icon: CheckCircle }
    : { text, tone: "danger", icon: WarningCircle };
}

function aufChipsOf(translate: Translator, auf: HeroAuf | null): Chip[] {
  if (auf === null) {
    return [];
  }
  const verification: Chip = auf.isVerified
    ? {
        text: translate("directory.mark.aufVerified"),
        tone: "success",
        icon: SealCheck,
      }
    : {
        text: translate("profileHero.auf.pending"),
        tone: "warning",
        icon: SealQuestion,
      };
  const expiry: Chip = {
    text: translate("directory.mark.aufExpired"),
    tone: "danger",
    icon: WarningCircle,
  };
  return auf.isExpired ? [verification, expiry] : [verification];
}

/** "Posición · Experiencia · País", sin lo que no tiene. */
function detailsLineOf(translate: Translator, member: HeroMember): string {
  const { locale } = translate;
  return [
    member.positionNames === null
      ? null
      : positionName(member.positionNames, locale),
    member.experienceLevel === null
      ? null
      : translate(`level.${member.experienceLevel}`),
    member.country === null ? null : countryName(locale, member.country),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function HeroIdentity({
  translate,
  member,
}: {
  translate: Translator;
  member: HeroMember;
}): React.JSX.Element {
  const details = detailsLineOf(translate, member);
  const chips = [
    membershipChipOf(translate, member.membershipStatus),
    ...aufChipsOf(translate, member.auf),
  ];
  return (
    <>
      <div className="profile-hero-title">
        <h1>{member.fullName}</h1>
        <span className="profile-hero-role">
          {translate(`role.${member.role}`)}
        </span>
      </div>
      {details === "" ? null : (
        <p className="profile-hero-details">{details}</p>
      )}
      <div className="profile-hero-chips">
        {chips.map(({ text, tone, icon: Icon }) => (
          <span key={text} className={`profile-chip profile-chip-${tone}`}>
            <Icon aria-hidden="true" weight="fill" />
            {text}
          </span>
        ))}
        {member.joinedOn === null ? null : (
          <span className="profile-hero-since">
            {translate("profileHero.memberSince", {
              date: formatCalendarMonth(
                translate.locale,
                member.joinedOn.slice(0, "YYYY-MM".length),
              ),
            })}
          </span>
        )}
      </div>
    </>
  );
}

export function ProfileHero({
  locale,
  member,
  isOwnProfile,
  actions = null,
}: {
  locale: Locale;
  member: HeroMember;
  /** El socio en su perfil: su foto lleva la cámara. */
  isOwnProfile: boolean;
  /** Lo que va a la derecha, o null. */
  actions?: React.ReactNode;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const identity = <HeroIdentity translate={translate} member={member} />;
  return (
    <header className="profile-hero">
      {isOwnProfile ? (
        <ProfilePhoto
          locale={locale}
          userId={member.userId}
          fullName={member.fullName}
          initialPhotoUrl={member.photoUrl}
        >
          {identity}
        </ProfilePhoto>
      ) : (
        <>
          <span className="profile-hero-photo">
            <MemberAvatar
              className="profile-hero-avatar"
              fullName={member.fullName}
              photoUrl={member.photoUrl}
              size={HERO_AVATAR_SIZE}
              alt={translate("memberRecord.photoAlt", {
                name: member.fullName,
              })}
              viewer={{ userId: member.userId, translate }}
            />
          </span>
          <div className="profile-hero-identity">{identity}</div>
        </>
      )}
      {actions}
    </header>
  );
}
