"use client";

import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { FirstAid } from "@phosphor-icons/react/dist/ssr/FirstAid";
import { Phone } from "@phosphor-icons/react/dist/ssr/Phone";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { memberRecordHref } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { EmergencyContact } from "@/lib/members/profile-contact";
import type { RowContact } from "./DirectoryContactCell";

/**
 * El contacto de la ficha rápida (#550): una línea por dato, con un botón de
 * copiar. Qué datos llegan lo decide el servidor según quien mira (FR-090):
 * todos a Admin y Committee, el de emergencia al Coach.
 *
 * Un dato que falta lo dice con palabras. Al Admin, que es quien puede
 * completarlo, además se le pone en aviso con un enlace "Añadir" a la ficha.
 * Copiar puede fallar (sin permiso del navegador, sin portapapeles): entonces
 * se dice, para que nadie pegue lo que no se copió.
 */

type ContactField = "email" | "phone" | "emergency";

const COPY_LABELS = {
  email: "directory.card.copyEmail",
  phone: "directory.card.copyPhone",
  emergency: "directory.card.copyEmergency",
} as const satisfies Record<ContactField, string>;

const COPIED_MESSAGES = {
  email: "directory.card.copiedEmail",
  phone: "directory.card.copiedPhone",
  emergency: "directory.card.copiedEmergency",
} as const satisfies Record<ContactField, string>;

const FIELD_GLYPHS: Readonly<Record<ContactField, PhosphorGlyph>> = {
  email: EnvelopeSimple,
  phone: Phone,
  emergency: FirstAid,
};

type CopyState =
  | { readonly kind: "idle" }
  | { readonly kind: "copied"; readonly field: ContactField }
  | { readonly kind: "failed" };

/** Una línea de la ficha: el dato, o el hueco que deja si falta. */
type ContactEntry =
  | {
      readonly field: ContactField;
      readonly kind: "present";
      readonly value: string;
    }
  | {
      readonly field: Exclude<ContactField, "email">;
      readonly kind: "missing";
    };

/** El correo de una cuenta nunca falta: es con lo que se entra. */
function entriesOf(
  translate: Translator,
  contact: Exclude<RowContact, { readonly kind: "none" }>,
): readonly ContactEntry[] {
  const emergency = emergencyEntryOf(translate, contact.emergencyContact);
  if (contact.kind === "emergency") {
    return [emergency];
  }
  return [
    { field: "email", kind: "present", value: contact.email },
    contact.phone === null
      ? { field: "phone", kind: "missing" }
      : { field: "phone", kind: "present", value: contact.phone },
    emergency,
  ];
}

function emergencyEntryOf(
  translate: Translator,
  contact: EmergencyContact | null,
): ContactEntry {
  if (contact === null) {
    return { field: "emergency", kind: "missing" };
  }
  const person = translate("directory.contact.emergencyPerson", {
    name: contact.name,
    relationship: contact.relationship,
  });
  return {
    field: "emergency",
    kind: "present",
    value: translate("directory.card.emergencyLine", {
      person,
      phone: contact.phone,
    }),
  };
}

/** Sin portapapeles (un contexto que no es seguro) o sin permiso, no se
 * copia: el que llama lo dice en vez de dar por hecho que salió. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard === undefined) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const MISSING_TEXTS = {
  phone: "directory.card.noPhone",
  emergency: "directory.card.noEmergency",
} as const;

const ADD_LABELS = {
  phone: "directory.card.addPhoneLabel",
  emergency: "directory.card.addEmergencyLabel",
} as const;

function MissingLine({
  translate,
  field,
  addFor,
}: {
  translate: Translator;
  field: Exclude<ContactField, "email">;
  /** A quién completárselo, si quien mira puede; null si no. */
  addFor: { readonly userId: string; readonly fullName: string } | null;
}): React.JSX.Element {
  return (
    <li
      className={
        addFor === null
          ? "directory-card-contact-line directory-card-contact-missing"
          : "directory-card-contact-line directory-card-contact-warning"
      }
    >
      <Icon glyph={FIELD_GLYPHS[field]} />
      <span className="directory-card-contact-value">
        {translate(MISSING_TEXTS[field])}
      </span>
      {addFor === null ? null : (
        <Link
          href={memberRecordHref(addFor.userId)}
          className="directory-card-add"
          aria-label={translate(ADD_LABELS[field], { name: addFor.fullName })}
        >
          {translate("directory.card.add")}
        </Link>
      )}
    </li>
  );
}

function PresentLine({
  translate,
  field,
  value,
  onCopy,
}: {
  translate: Translator;
  field: ContactField;
  value: string;
  onCopy: () => void;
}): React.JSX.Element {
  const label = translate(COPY_LABELS[field]);
  return (
    <li className="directory-card-contact-line">
      <Icon glyph={FIELD_GLYPHS[field]} />
      <span className="directory-card-contact-value">{value}</span>
      <button
        type="button"
        className="directory-card-copy"
        aria-label={label}
        title={label}
        onClick={onCopy}
      >
        <Icon glyph={Copy} />
      </button>
    </li>
  );
}

function CopyFeedback({
  translate,
  state,
}: {
  translate: Translator;
  state: CopyState;
}): React.JSX.Element | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "copied":
      return (
        <p className="directory-card-feedback" role="status">
          {translate(COPIED_MESSAGES[state.field])}
        </p>
      );
    case "failed":
      return (
        <p className="auth-error" role="alert">
          {translate("directory.card.copyFailed")}
        </p>
      );
  }
}

export function QuickCardContact({
  translate,
  contact,
  addFor,
}: {
  translate: Translator;
  contact: Exclude<RowContact, { readonly kind: "none" }>;
  /** El socio, cuando quien mira puede completar lo que falta (el Admin). */
  addFor: { readonly userId: string; readonly fullName: string } | null;
}): React.JSX.Element {
  const headingId = useId();
  const [copyState, setCopyState] = useState<CopyState>({ kind: "idle" });

  async function copy(field: ContactField, value: string): Promise<void> {
    const isCopied = await copyToClipboard(value);
    setCopyState(isCopied ? { kind: "copied", field } : { kind: "failed" });
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="directory-card-section"
    >
      <h3 id={headingId} className="directory-card-label">
        {translate("directory.card.contact")}
      </h3>
      <ul className="directory-card-contact">
        {entriesOf(translate, contact).map((entry) =>
          entry.kind === "present" ? (
            <PresentLine
              key={entry.field}
              translate={translate}
              field={entry.field}
              value={entry.value}
              onCopy={() => void copy(entry.field, entry.value)}
            />
          ) : (
            <MissingLine
              key={entry.field}
              translate={translate}
              field={entry.field}
              addFor={addFor}
            />
          ),
        )}
      </ul>
      <CopyFeedback translate={translate} state={copyState} />
    </div>
  );
}
