import { FirstAid } from "@phosphor-icons/react/dist/ssr/FirstAid";
import { Phone } from "@phosphor-icons/react/dist/ssr/Phone";
import type { Translator } from "@/lib/i18n/translator";
import type { EmergencyContact } from "@/lib/members/profile-contact";
import { EmptyValue } from "./DetailList";

/**
 * La lectura de Contacto (#772), en el perfil y en la ficha: dos mitades, el
 * teléfono con el correo debajo y el contacto de emergencia, cada una con su
 * baldosa. Sin contacto de emergencia se dice que aún no se añadió, en el
 * color del aviso: es lo que la franja de lo que falta pide.
 *
 * El Coach no ve el teléfono ni el correo (D3 del PRD de E30): en su ficha
 * sólo sale la mitad de la emergencia.
 */

/** El teléfono y el correo del socio. */
export type ReachableAt = {
  readonly phone: string | null;
  readonly email: string;
};

export function ContactSummary({
  translate,
  reachableAt,
  emergencyContact,
}: {
  translate: Translator;
  /** Null para quien no los ve. */
  reachableAt: ReachableAt | null;
  emergencyContact: EmergencyContact | null;
}): React.JSX.Element {
  return (
    <div className="profile-contact">
      {reachableAt === null ? null : (
        <div className="profile-contact-half">
          <span className="profile-contact-tile" aria-hidden="true">
            <Phone weight="regular" />
          </span>
          <dl>
            <dt>{translate("profileCard.contact.phone")}</dt>
            <dd className="profile-contact-number">
              {reachableAt.phone === null ? (
                <EmptyValue translate={translate} />
              ) : (
                reachableAt.phone
              )}
            </dd>
            <dd className="profile-contact-extra">{reachableAt.email}</dd>
          </dl>
        </div>
      )}
      <div className="profile-contact-half">
        <span
          className="profile-contact-tile profile-contact-tile-danger"
          aria-hidden="true"
        >
          <FirstAid weight="regular" />
        </span>
        <dl>
          <dt>{translate("profileCard.contact.emergency")}</dt>
          {emergencyContact === null ? (
            <dd className="profile-contact-missing">
              {translate("profileCard.contact.notAdded")}
            </dd>
          ) : (
            <>
              <dd>
                {translate("profileCard.contact.emergencySummary", {
                  name: emergencyContact.name,
                  relationship: emergencyContact.relationship,
                })}
              </dd>
              <dd className="profile-contact-number">
                {emergencyContact.phone}
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
