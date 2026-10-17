"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Icon } from "@/components/Icon";
import type { ClubDraftSection } from "@/lib/club/club-settings-sections";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La barra de cambios sin guardar de la configuración del club (#719, RF-2
 * del PRD de E26; `02-desktop-packs-unsaved.png` y
 * `10-mobile-packs-unsaved.png` del handoff): va fija abajo mientras la
 * sección tiene borrador, con Descartar y Guardar cambios. Tras guardar,
 * "✓ Guardado" abajo a la derecha.
 */

export function UnsavedChangesBar({
  translate,
  section,
  canSave,
  isSaving,
  onDiscard,
  onSave,
}: {
  readonly translate: Translator;
  readonly section: ClubDraftSection;
  /** Falso con el borrador inválido: el error ya se ve en su campo. */
  readonly canSave: boolean;
  readonly isSaving: boolean;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="club-unsaved-bar">
      <span className="club-draft-dot" aria-hidden="true" />
      <p className="club-unsaved-bar-text">
        {translate(`clubSettings.draft.unsaved.${section}`)}
      </p>
      <div className="club-unsaved-bar-actions">
        <button
          type="button"
          className="club-unsaved-bar-discard"
          disabled={isSaving}
          onClick={onDiscard}
        >
          {translate("clubSettings.draft.discard")}
        </button>
        <button
          type="button"
          className="auth-submit club-unsaved-bar-save"
          disabled={isSaving || !canSave}
          onClick={onSave}
        >
          {translate(
            isSaving ? "clubSettings.draft.saving" : "clubSettings.draft.save",
          )}
        </button>
      </div>
    </div>
  );
}

/** "✓ Guardado". La región de estado está siempre: un lector de pantalla
 * no siempre anuncia una que aparece con su texto ya puesto. */
export function SavedNotice({
  translate,
  isShowing,
}: {
  readonly translate: Translator;
  readonly isShowing: boolean;
}): React.JSX.Element {
  return (
    <div role="status" className="club-saved-notice-region">
      {isShowing ? (
        <p className="club-saved-notice">
          <Icon glyph={CheckCircle} />
          {translate("clubSettings.draft.saved")}
        </p>
      ) : null}
    </div>
  );
}
