import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { FirstAid } from "@phosphor-icons/react/dist/ssr/FirstAid";
import { Phone } from "@phosphor-icons/react/dist/ssr/Phone";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import { type RowContact, telHref } from "./row-contact";

/**
 * Los botones de solo icono que escriben o llaman a un socio en el móvil
 * (#554, "2b"): los de la fila deslizada y los redondos de la ficha que sube.
 * Son los mismos en los dos sitios, con su forma puesta por la hoja de
 * estilos.
 *
 * Qué botones salen lo decide lo que la vista trae (FR-090): el Admin y el
 * Committee tienen los tres, el Coach sólo el de emergencia. Un dato que esa
 * vista trae vacío sale desactivado y dice que falta; uno que no trae, no
 * sale.
 *
 * La cabecera de la ficha (#775) usa los mismos botones, y nombra el que
 * falta con la acción y "(no hay)" en vez de con la frase de la fila.
 */

type ContactField = "email" | "phone" | "emergency";

type ContactAction =
  | {
      readonly field: ContactField;
      readonly kind: "available";
      readonly href: string;
    }
  | {
      readonly field: Exclude<ContactField, "email">;
      readonly kind: "missing";
    };

export type ReachableContact = Exclude<RowContact, { readonly kind: "none" }>;

const FIELD_GLYPHS: Readonly<Record<ContactField, PhosphorGlyph>> = {
  email: EnvelopeSimple,
  phone: Phone,
  emergency: FirstAid,
};

const AVAILABLE_LABELS = {
  email: "directory.action.email",
  phone: "directory.action.call",
  emergency: "directory.action.emergency",
} as const satisfies Record<ContactField, string>;

const MISSING_LABELS = {
  phone: "directory.action.noPhone",
  emergency: "directory.action.noEmergency",
} as const;

function phoneActionOf(
  field: Exclude<ContactField, "email">,
  phone: string | null,
): ContactAction {
  return phone === null
    ? { field, kind: "missing" }
    : { field, kind: "available", href: telHref(phone) };
}

/** El correo de una cuenta nunca falta: es con lo que se entra. */
function contactActionsOf(contact: ReachableContact): readonly ContactAction[] {
  const emergency = phoneActionOf(
    "emergency",
    contact.emergencyContact === null ? null : contact.emergencyContact.phone,
  );
  if (contact.kind === "emergency") {
    return [emergency];
  }
  return [
    { field: "email", kind: "available", href: `mailto:${contact.email}` },
    phoneActionOf("phone", contact.phone),
    emergency,
  ];
}

/** Cómo se nombra el botón de un dato que falta, a partir del nombre que
 * tendría si estuviera. */
export type MissingContactLabel = (availableLabel: string) => string;

function ContactActionButton({
  translate,
  action,
  fullName,
  labelMissing,
}: {
  translate: Translator;
  action: ContactAction;
  fullName: string;
  labelMissing: MissingContactLabel | null;
}): React.JSX.Element {
  const glyph = <Icon glyph={FIELD_GLYPHS[action.field]} />;
  if (action.kind === "missing") {
    const label =
      labelMissing === null
        ? translate(MISSING_LABELS[action.field], { name: fullName })
        : labelMissing(
            translate(AVAILABLE_LABELS[action.field], { name: fullName }),
          );
    return (
      <button
        type="button"
        className={`directory-contact-action directory-contact-action-${action.field}`}
        aria-label={label}
        title={label}
        disabled
      >
        {glyph}
      </button>
    );
  }
  const label = translate(AVAILABLE_LABELS[action.field], { name: fullName });
  return (
    <a
      href={action.href}
      className={`directory-contact-action directory-contact-action-${action.field}`}
      aria-label={label}
      title={label}
    >
      {glyph}
    </a>
  );
}

export function ContactActions({
  translate,
  contact,
  fullName,
  label,
  className,
  labelMissing = null,
}: {
  translate: Translator;
  contact: ReachableContact;
  fullName: string;
  /** El nombre del grupo: "Contacto" en la ficha, "Acciones de…" en la
   * fila. */
  label: string;
  className: string;
  /** Sin él, el que falta se nombra con la frase de la fila ("no tiene
   * teléfono"). */
  labelMissing?: MissingContactLabel | null;
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={className}>
      {contactActionsOf(contact).map((action) => (
        <ContactActionButton
          key={action.field}
          translate={translate}
          action={action}
          fullName={fullName}
          labelMissing={labelMissing}
        />
      ))}
    </div>
  );
}
