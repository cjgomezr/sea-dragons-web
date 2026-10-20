"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { useEffect, useRef } from "react";
import type { Translator } from "@/lib/i18n/translator";
import { focusFieldById } from "./use-open-card";

/**
 * Una tarjeta del perfil y de la ficha que se lee primero y se edita aparte
 * (#772, D5 del PRD de E30). La comparten Sobre mí y Contacto en las dos
 * pantallas. Lleva la cabecera con su Editar, el borde de acento mientras se
 * edita y el foco: al abrirse va al campo pedido, y al cerrarse con Guardar o
 * Cancelar vuelve a su Editar. Si se cierra porque se abrió otra, el foco ya
 * está en la otra y no se toca.
 *
 * Lo que va dentro lo pone quien la usa: la lectura o su `CardForm`. Una
 * tarjeta con datos del Admin, como Registro AUF y Ficha del club en la ficha
 * (#773), lleva junto al título la etiqueta "🔒 Admin", fuera del título
 * para que no entre en el nombre de la región.
 */

/** Si el foco se perdió con el formulario que se acaba de quitar, o sigue
 * dentro de la tarjeta. */
function isFocusLeftBehind(card: HTMLElement): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || card.contains(active);
}

export function EditableCard({
  translate,
  headingId,
  title,
  isEditing,
  focusFieldId,
  savedText,
  isAdminOnly = false,
  onEdit,
  children,
}: {
  translate: Translator;
  headingId: string;
  title: string;
  isEditing: boolean;
  /** El campo que recibe el foco al abrirse. */
  focusFieldId: string;
  /** El aviso de que se acaba de guardar, o null. */
  savedText: string | null;
  /** Lleva la etiqueta "🔒 Admin". */
  isAdminOnly?: boolean;
  /** Null en una tarjeta que sólo se lee. */
  onEdit: (() => void) | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const cardRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(isEditing);

  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = isEditing;
    if (isEditing && !wasEditing) {
      focusFieldById(focusFieldId);
      return;
    }
    const card = cardRef.current;
    const edit = editRef.current;
    if (!isEditing && wasEditing && card !== null && edit !== null) {
      if (isFocusLeftBehind(card)) {
        edit.focus();
      }
    }
  }, [isEditing, focusFieldId]);

  return (
    <section
      ref={cardRef}
      className={
        isEditing ? "profile-card profile-card-editing" : "profile-card"
      }
      aria-labelledby={headingId}
    >
      <div className="profile-card-header">
        <div className="profile-card-title">
          <h2 id={headingId}>{title}</h2>
          {isAdminOnly ? (
            <span className="profile-card-admin">
              <LockSimple aria-hidden="true" weight="regular" />
              {translate("profileCard.adminOnly")}
            </span>
          ) : null}
        </div>
        {onEdit === null ? null : (
          <button
            ref={editRef}
            type="button"
            className="profile-card-edit"
            aria-label={translate("profileCard.editLabel", { title })}
            onClick={onEdit}
          >
            <PencilSimple aria-hidden="true" weight="regular" />
            {translate("profileCard.edit")}
          </button>
        )}
      </div>
      {savedText === null || isEditing ? null : (
        <p className="profile-strip profile-strip-success" role="status">
          <CheckCircle aria-hidden="true" weight="regular" />
          {savedText}
        </p>
      )}
      {children}
    </section>
  );
}

/** Los campos de una tarjeta abierta con su Cancelar y su Guardar. Un aviso
 * que no es de ningún campo va encima de los botones. */
export function CardForm({
  translate,
  isSending,
  failureText,
  onSubmit,
  onCancel,
  children,
}: {
  translate: Translator;
  isSending: boolean;
  failureText: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <form
      className="profile-card-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {failureText === null ? null : (
        <p className="auth-error" role="alert">
          {failureText}
        </p>
      )}
      <div className="profile-card-actions">
        <button
          type="button"
          className="profile-card-cancel"
          disabled={isSending}
          onClick={onCancel}
        >
          {translate("profileCard.cancel")}
        </button>
        <button
          type="submit"
          className="auth-submit profile-card-save"
          disabled={isSending}
        >
          {translate(isSending ? "profileCard.saving" : "profileCard.save")}
        </button>
      </div>
    </form>
  );
}
