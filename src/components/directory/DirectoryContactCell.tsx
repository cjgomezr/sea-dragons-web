import type {
  EmergencyContactView,
  MemberContactView,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import type { EmergencyContact } from "@/lib/members/profile-contact";
import { MISSING_FIELD } from "./member-labels";

/**
 * La celda del contacto de un socio en el directorio (#499, RF-3 del PRD de
 * E19). Qué trae la decide el servidor según quien mira: Admin y Committee
 * reciben el correo, el teléfono y el contacto de emergencia; el Coach, sólo
 * el de emergencia, que es lo que necesita en la piscina.
 *
 * Es una sola columna compacta y no tres: en escritorio la tabla ya reparte
 * cuatro. Cada dato lleva su etiqueta escrita, también en la tabla, porque
 * la cabecera sólo dice "Contacto". Un teléfono se pulsa para llamar y un
 * correo para escribir.
 */

/** Lo que una fila sabe del contacto, ya reducido a lo que su vista trae. */
export type RowContact =
  | { readonly kind: "none" }
  | ({ readonly kind: "emergency" } & EmergencyContactView)
  | ({ readonly kind: "full" } & MemberContactView);

/** El número tal como se marca: sin espacios, guiones ni paréntesis, con el
 * `+` del prefijo si lo trae. Se escribió así a propósito (#496): sólo se
 * limpia para el enlace. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function PhoneLink({ phone }: { phone: string }): React.JSX.Element {
  return (
    <a className="directory-contact-link" href={telHref(phone)}>
      {phone}
    </a>
  );
}

/** La etiqueta y su dato, sin espacio entre los dos: la hoja de estilos los
 * pone uno debajo del otro. */
function ContactLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="directory-contact-line">
      <span className="directory-contact-label">{label}</span>
      {children}
    </span>
  );
}

function EmergencyLine({
  translate,
  contact,
}: {
  translate: Translator;
  contact: EmergencyContact | null;
}): React.JSX.Element {
  return (
    <ContactLine label={translate("directory.contact.emergency")}>
      {contact === null ? (
        MISSING_FIELD
      ) : (
        <>
          <span>
            {translate("directory.contact.emergencyPerson", {
              name: contact.name,
              relationship: contact.relationship,
            })}
          </span>
          <PhoneLink phone={contact.phone} />
        </>
      )}
    </ContactLine>
  );
}

export function DirectoryContactCell({
  translate,
  contact,
}: {
  translate: Translator;
  contact: Exclude<RowContact, { readonly kind: "none" }>;
}): React.JSX.Element {
  return (
    <td
      className="directory-contact-cell"
      data-label={translate("directory.column.contact")}
    >
      <span className="directory-contact">
        {contact.kind === "full" ? (
          <>
            <ContactLine label={translate("directory.contact.email")}>
              <a
                className="directory-contact-link"
                href={`mailto:${contact.email}`}
              >
                {contact.email}
              </a>
            </ContactLine>
            <ContactLine label={translate("directory.contact.phone")}>
              {contact.phone === null ? (
                MISSING_FIELD
              ) : (
                <PhoneLink phone={contact.phone} />
              )}
            </ContactLine>
          </>
        ) : null}
        <EmergencyLine
          translate={translate}
          contact={contact.emergencyContact}
        />
      </span>
    </td>
  );
}
