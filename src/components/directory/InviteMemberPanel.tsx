"use client";

import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/Icon";
import { loadPositionChoices } from "@/components/club/positions-client";
import { cycleFocus } from "@/components/focus-cycle";
import { loadGroups } from "@/components/groups/groups-client";
import { isPhoneNow } from "@/components/use-is-phone";
import type { NamedPosition } from "@/lib/club/club-positions";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { InvitationResult } from "./InvitationResult";
import type { CreatedMemberView } from "./new-member-client";
import { FIELD_IDS } from "./new-member-issues";
import { NewMemberForm } from "./NewMemberForm";
import { useCommonCountries } from "./use-common-countries";

/**
 * El panel de invitar a un socio (#862, RF-9 y D11 del PRD de E33), bajo la
 * cabecera del Directorio como el redactor de correo; antes era la página
 * aparte `/directorio/nuevo` (#243). Lo abre el botón `user-plus` de la
 * cabecera, que sólo ve un Admin, y el endpoint del alta lo vuelve a
 * comprobar.
 *
 * Es de cliente porque lee y escribe por la API v1, la misma que usará la
 * aplicación nativa de Release 2 (CON-002). Al terminar enseña si la
 * invitación salió (#863). En el móvil es una ventana modal que ocupa la
 * pantalla: lo de detrás queda inerte, también para el lector de pantalla.
 */

/** Los grupos y las posiciones del club (#299): el formulario necesita las
 * dos listas, así que se espera a ambas. */
type CatalogsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly groups: readonly Group[];
      readonly positions: readonly NamedPosition[];
    };

async function loadCatalogs(): Promise<CatalogsState> {
  const [groups, positions] = await Promise.all([
    loadGroups(),
    loadPositionChoices(),
  ]);
  return groups.kind === "loaded" && positions.kind === "loaded"
    ? { kind: "ready", groups: groups.groups, positions: positions.positions }
    : { kind: "failed" };
}

function useCatalogs(): {
  readonly catalogs: CatalogsState;
  readonly retry: () => void;
} {
  const [catalogs, setCatalogs] = useState<CatalogsState>({
    kind: "loading",
  });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadCatalogs().then((loaded) => {
      if (isCurrent) {
        setCatalogs(loaded);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retry(): void {
    setCatalogs({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return { catalogs, retry };
}

function PanelHeader({
  translate,
  titleId,
  titleRef,
  onClose,
}: {
  translate: Translator;
  titleId: string;
  titleRef: React.Ref<HTMLHeadingElement>;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-email-header invite-header">
      <span className="directory-email-header-icon" aria-hidden="true">
        <Icon glyph={UserPlus} />
      </span>
      <div className="directory-email-heading">
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {translate("newMember.title")}
        </h2>
        <p>{translate("newMember.lead")}</p>
      </div>
      <button
        type="button"
        className="directory-email-close invite-close"
        aria-label={translate("newMember.close")}
        onClick={onClose}
      >
        <Icon glyph={X} />
      </button>
    </div>
  );
}

/** Lo que enseña el panel: el formulario, o el resultado del alta con los
 * grupos que se conservan para la siguiente. */
type PanelStep =
  | { readonly kind: "form"; readonly groupIds: readonly string[] }
  | {
      readonly kind: "result";
      readonly created: CreatedMemberView;
      readonly groupIds: readonly string[];
    };

const FIRST_FORM: PanelStep = { kind: "form", groupIds: [] };

function InvitePanel({
  locale,
  clubName,
  titleId,
  onClose,
  onMemberCreated,
}: {
  readonly locale: Locale;
  readonly clubName: string;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onMemberCreated: () => void;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { catalogs, retry } = useCatalogs();
  const commonCountryCodes = useCommonCountries();
  const [step, setStep] = useState<PanelStep>(FIRST_FORM);

  // Quien lo abre desde la cabecera llega al formulario, no se queda arriba.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function showResult(
    created: CreatedMemberView,
    groupIds: readonly string[],
  ): void {
    setStep({ kind: "result", created, groupIds });
    onMemberCreated();
  }

  /** El formulario vuelve vacío y el foco, a su primer campo. */
  function inviteAnother(groupIds: readonly string[]): void {
    flushSync(() => setStep({ kind: "form", groupIds }));
    document.getElementById(FIELD_IDS.fullName)?.focus();
  }

  return (
    <section className="invite-panel" aria-labelledby={titleId}>
      <PanelHeader
        translate={translate}
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
      />
      {catalogs.kind === "loading" ? (
        <p className="admin-empty invite-status">
          {translate("newMember.loading")}
        </p>
      ) : null}
      {catalogs.kind === "failed" ? (
        <div className="admin-load-failure invite-status">
          <p className="auth-error" role="alert">
            {translate("newMember.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retry}>
            {translate("directory.retry")}
          </button>
        </div>
      ) : null}
      {catalogs.kind === "ready" && step.kind === "result" ? (
        <InvitationResult
          translate={translate}
          created={step.created}
          onInviteAnother={() => inviteAnother(step.groupIds)}
        />
      ) : null}
      {catalogs.kind === "ready" && step.kind === "form" ? (
        <NewMemberForm
          locale={locale}
          clubName={clubName}
          clubGroups={catalogs.groups}
          positions={catalogs.positions}
          commonCountryCodes={commonCountryCodes}
          initialGroupIds={step.groupIds}
          onCreated={showResult}
          onCancel={onClose}
        />
      ) : null}
    </section>
  );
}

/** El panel en el móvil (#863). Se cierra con `close`, y no desmontándolo,
 * para que el foco pueda volver al botón de la cabecera cuando lo de detrás
 * ya no está inerte; Escape también lo cierra. */
function PhoneScreen({
  titleId,
  dialogRef,
  onClosed,
  children,
}: {
  readonly titleId: string;
  readonly dialogRef: React.RefObject<HTMLDialogElement | null>;
  readonly onClosed: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  // Antes que el efecto que enfoca el título: `showModal` movería el foco
  // al primer control si fuera después.
  useLayoutEffect(() => {
    dialogRef.current?.showModal();
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      className="invite-screen"
      aria-labelledby={titleId}
      onClose={onClosed}
      onKeyDown={(event) => cycleFocus(event, dialogRef.current)}
    >
      {children}
    </dialog>
  );
}

export function InviteMemberPanel({
  locale,
  clubName,
  onClose,
  onMemberCreated,
}: {
  readonly locale: Locale;
  /** El que firma la invitación, para la vista previa. */
  readonly clubName: string;
  readonly onClose: () => void;
  /** Hay un socio nuevo, con o sin correo: el Directorio vuelve a pedir su
   * lista para enseñarlo como Invitado. */
  readonly onMemberCreated: () => void;
}): React.JSX.Element {
  const titleId = useId();
  // Se decide al abrirlo y no cambia: pasar de un lado al otro del corte
  // (girar el teléfono, o la captura de página entera, que estira la
  // ventana) montaría el panel de nuevo y perdería lo escrito o el
  // resultado. El panel sólo se pinta en el navegador, tras leer la lista.
  const [isPhone] = useState(isPhoneNow);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closeScreen(): void {
    dialogRef.current?.close();
  }

  const panel = (
    <InvitePanel
      locale={locale}
      clubName={clubName}
      titleId={titleId}
      onClose={isPhone ? closeScreen : onClose}
      onMemberCreated={onMemberCreated}
    />
  );

  return isPhone ? (
    <PhoneScreen titleId={titleId} dialogRef={dialogRef} onClosed={onClose}>
      {panel}
    </PhoneScreen>
  ) : (
    panel
  );
}
