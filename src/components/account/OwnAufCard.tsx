"use client";

import { useState } from "react";
import { TextField } from "@/components/directory/record-fields";
import type { Translator } from "@/lib/i18n/translator";
import {
  type OwnAuf,
  type OwnProfile,
  type OwnProfileSubmission,
  type ProfileIssueCode,
  validateAufNumber,
} from "@/lib/members/own-profile";
import { AufCells } from "./AufCells";
import { CardForm, EditableCard } from "./EditableCard";
import {
  type ProfileSaveResult,
  describeProfileFailure,
  describeProfileIssue,
  saveOwnProfile,
} from "./profile-client";
import { useCardSubmission } from "./use-card-submission";

/**
 * El AUF dentro del perfil propio (#274), en su tarjeta de Registro AUF
 * (#773): se lee en tres celdas y, mientras no esté verificado, se edita
 * aparte. Lo que el socio escribe queda pendiente hasta que un Admin lo
 * verifique. Uno verificado sólo se lee: cambiarlo es cosa del Admin, y un
 * Editar invitaría a intentarlo.
 *
 * Guardar manda el AUF con el resto del perfil tal como está guardado, porque
 * la API pide sus campos siempre. Sin tocar no se manda nada: guardar es
 * cerrar, como Cancelar.
 */

const HEADING_ID = "perfil-auf";
/** El campo que recibe el foco al abrir la tarjeta. */
export const AUF_NUMBER_ID = "perfil-auf-numero";
const AUF_EXPIRY_ID = "perfil-auf-vencimiento";
const AUF_NOTE_ID = "perfil-auf-nota";

type AufDraft = {
  readonly aufNumber: string;
  readonly aufExpiry: string;
};

function aufDraftOf(auf: OwnAuf): AufDraft {
  return {
    aufNumber: auf.status === "none" ? "" : auf.number,
    aufExpiry: auf.status === "none" ? "" : (auf.expiry ?? ""),
  };
}

function isSameAufDraft(left: AufDraft, right: AufDraft): boolean {
  return (
    left.aufNumber === right.aufNumber && left.aufExpiry === right.aufExpiry
  );
}

function toAufSubmission(
  draft: AufDraft,
  profile: OwnProfile,
): OwnProfileSubmission {
  return {
    fullName: profile.fullName,
    country: profile.country ?? "",
    positionId: profile.positionId,
    experienceLevel: profile.experienceLevel,
    gender: profile.gender,
    phone: profile.phone,
    emergencyContact: profile.emergencyContact,
    auf: {
      number: draft.aufNumber,
      expiry: draft.aufExpiry === "" ? null : draft.aufExpiry,
    },
  };
}

/** La nota de debajo: quién lo revisa o quién lo cambia. */
function noteOf(translate: Translator, auf: OwnAuf): string {
  return auf.status === "verified"
    ? translate("profileCard.auf.verifiedNote")
    : translate("profileCard.auf.pendingNote");
}

type OwnAufEditorProps = {
  readonly translate: Translator;
  readonly profile: OwnProfile;
  readonly onSaved: (profile: OwnProfile) => void;
  readonly onCancel: () => void;
  readonly onChanges: (hasChanges: boolean) => void;
};

function OwnAufEditor({
  translate,
  profile,
  onSaved,
  onCancel,
  onChanges,
}: OwnAufEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => aufDraftOf(profile.auf));
  const [numberIssue, setNumberIssue] = useState<ProfileIssueCode | null>(null);
  const submission = useCardSubmission<ProfileSaveResult>();

  function update(change: Partial<AufDraft>): void {
    const next = { ...draft, ...change };
    setDraft(next);
    if ("aufNumber" in change) {
      setNumberIssue(null);
    }
    submission.clearFailure();
    onChanges(!isSameAufDraft(next, aufDraftOf(profile.auf)));
  }

  function handleSubmit(): void {
    if (isSameAufDraft(draft, aufDraftOf(profile.auf))) {
      onCancel();
      return;
    }
    const issue = validateAufNumber(draft.aufNumber);
    if (issue !== null) {
      setNumberIssue(issue);
      return;
    }
    void submission.submit(
      () => saveOwnProfile(toAufSubmission(draft, profile)),
      (result) => onSaved(result.profile),
    );
  }

  const { status } = submission;
  return (
    <CardForm
      translate={translate}
      isSending={submission.isSending}
      failureText={
        status.kind === "failed"
          ? describeProfileFailure(translate, status.failure, status.reason)
          : null
      }
      onSubmit={handleSubmit}
      onCancel={onCancel}
    >
      <div className="profile-card-pair">
        <TextField
          id={AUF_NUMBER_ID}
          label={translate("account.profile.auf.number")}
          type="text"
          value={draft.aufNumber}
          issueText={
            numberIssue === null
              ? null
              : describeProfileIssue(translate, numberIssue)
          }
          hintIds={[AUF_NOTE_ID]}
          onChange={(aufNumber) => update({ aufNumber })}
        />
        <TextField
          id={AUF_EXPIRY_ID}
          label={translate("account.profile.auf.expiry")}
          type="date"
          value={draft.aufExpiry}
          issueText={null}
          onChange={(aufExpiry) => update({ aufExpiry })}
        />
      </div>
      <p className="auth-hint" id={AUF_NOTE_ID}>
        {noteOf(translate, profile.auf)}
      </p>
    </CardForm>
  );
}

export function OwnAufCard({
  isEditing,
  focusFieldId,
  savedText,
  onEdit,
  ...editor
}: OwnAufEditorProps & {
  readonly isEditing: boolean;
  readonly focusFieldId: string;
  readonly savedText: string | null;
  readonly onEdit: () => void;
}): React.JSX.Element {
  const { translate, profile } = editor;
  return (
    <EditableCard
      translate={translate}
      headingId={HEADING_ID}
      title={translate("account.profile.auf.title")}
      isEditing={isEditing}
      focusFieldId={focusFieldId}
      savedText={savedText}
      onEdit={profile.auf.status === "verified" ? null : onEdit}
    >
      {isEditing ? (
        <OwnAufEditor {...editor} />
      ) : (
        <>
          <AufCells translate={translate} auf={profile.auf} />
          <p className="profile-card-note">{noteOf(translate, profile.auf)}</p>
        </>
      )}
    </EditableCard>
  );
}
