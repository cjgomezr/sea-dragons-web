"use client";

import { useId } from "react";
import { ClubBrandMark } from "@/components/ClubBrandMark";
import type { Translator } from "@/lib/i18n/translator";
import type { AccentPreviewStyle } from "./accent-preview-style";
import type { ClubIdentity } from "./ClubSettingsList";

/**
 * La vista previa de la pestaña General (#720, "03-desktop-general" del
 * handoff de E26): la cabecera de la barra lateral con la marca y el nombre,
 * un botón principal y un enlace, todo en el acento del borrador. Sustituye a
 * la muestra que había junto al campo del color. El botón y el enlace son
 * dibujos: no se pulsan.
 */
export function ClubGeneralPreview({
  translate,
  club,
  accentStyle,
}: {
  translate: Translator;
  club: ClubIdentity;
  accentStyle: AccentPreviewStyle;
}): React.JSX.Element {
  const captionId = useId();
  return (
    <figure
      className="club-general-preview"
      aria-labelledby={captionId}
      style={accentStyle}
    >
      <figcaption id={captionId}>
        {translate("clubSettings.preview.title")}
      </figcaption>
      <div className="club-general-preview-card">
        <div className="club-general-preview-header">
          <ClubBrandMark
            logoUrl={club.logoUrl}
            // El nombre va al lado: el logo aquí es decorativo, y el de la
            // fila del logo ya lo nombra.
            logoAlt=""
            fallback={
              <span className="auth-brand-mark" aria-hidden="true">
                {club.initials}
              </span>
            }
          />
          <span className="club-general-preview-name">{club.name}</span>
        </div>
        <div className="club-general-preview-body">
          <span className="club-general-preview-button">
            {translate("clubSettings.preview.button")}
          </span>
          <p>
            {translate("clubSettings.preview.textWith")}{" "}
            <span className="club-general-preview-link">
              {translate("clubSettings.preview.link")}
            </span>
            .
          </p>
        </div>
      </div>
      <p className="club-general-preview-note">
        {translate("clubSettings.preview.note")}
      </p>
    </figure>
  );
}
