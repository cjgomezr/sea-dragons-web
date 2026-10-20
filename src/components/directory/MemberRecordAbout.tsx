import { DetailList } from "@/components/account/DetailList";
import { EditableCard } from "@/components/account/EditableCard";
import { positionName } from "@/lib/club/club-positions";
import { countryName } from "@/lib/geo/countries";
import type { Translator } from "@/lib/i18n/translator";
import type { MemberRecordReading } from "@/lib/members/member-record";

/**
 * Sobre mí en la ficha de un socio (#772, RF-3 del PRD de E30): el nombre,
 * el país, la posición y la experiencia, sólo para leer. Los cambia el socio
 * desde su perfil. El género no sale: es sólo suyo (D4), y la API de la ficha
 * ni lo devuelve. Es la misma en todas las vistas (#776).
 */

export function MemberRecordAbout({
  translate,
  record,
}: {
  translate: Translator;
  record: MemberRecordReading;
}): React.JSX.Element {
  const { locale } = translate;
  return (
    <EditableCard
      translate={translate}
      headingId="ficha-sobre-mi"
      title={translate("profileCard.about.title")}
      isEditing={false}
      focusFieldId=""
      savedText={null}
      onEdit={null}
    >
      <DetailList
        translate={translate}
        rows={[
          {
            label: translate("profileCard.about.fullName"),
            value: record.fullName,
            isOnlyYou: false,
          },
          {
            label: translate("profileCard.about.country"),
            value:
              record.country === null
                ? null
                : countryName(locale, record.country),
            isOnlyYou: false,
          },
          {
            label: translate("profileCard.about.position"),
            value:
              record.positionName === null
                ? null
                : positionName(record.positionName, locale),
            isOnlyYou: false,
          },
          {
            label: translate("profileCard.about.experience"),
            value:
              record.experienceLevel === null
                ? null
                : translate(`level.${record.experienceLevel}`),
            isOnlyYou: false,
          },
        ]}
      />
    </EditableCard>
  );
}
