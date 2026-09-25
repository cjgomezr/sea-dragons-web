"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  type ClubSettingsRead,
  describeClubSettingsFailure,
  loadClubSettings,
} from "./club-settings-client";
import { ClubPositionsSection } from "./ClubPositionsSection";
import { ClubSettingsForm } from "./ClubSettingsForm";
import { ClubSignInTextsSection } from "./ClubSignInTextsSection";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a), que un Admin abre
 * desde el menú de la cuenta.
 *
 * La frontera ya mandó al panel a quien no es Admin; si alguien deja de serlo
 * con la pantalla abierta, el 403 del endpoint lo dice aquí. Es de cliente
 * porque lee y guarda por la API v1, la misma que usará la aplicación nativa
 * de Release 2 (CON-002).
 */

type ScreenState = { readonly kind: "loading" } | ClubSettingsRead;

export function ClubSettingsScreen({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadClubSettings().then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function reload(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return (
    <div className="club-settings">
      <header className="member-record-header">
        <h1>{translate("clubSettings.title")}</h1>
        <p className="app-lead">{translate("clubSettings.lead")}</p>
      </header>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("clubSettings.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {describeClubSettingsFailure(translate, state)}
          </p>
          <button type="button" className="auth-submit" onClick={reload}>
            {translate("directory.retry")}
          </button>
        </div>
      ) : null}
      {state.kind === "loaded" ? (
        <>
          <ClubSettingsForm
            // Lo último que se cargó empieza de cero: sin esto, el borrador
            // que chocó con el cambio de otro Admin seguiría a la vista.
            key={reloads}
            translate={translate}
            settings={state.settings}
            onReloadRequested={reload}
          />
          <ClubSignInTextsSection translate={translate} />
          {/* Cada cambio de las posiciones se guarda en el acto (#300): no
              viaja con el botón del formulario de arriba. */}
          <ClubPositionsSection locale={locale} translate={translate} />
        </>
      ) : null}
    </div>
  );
}
