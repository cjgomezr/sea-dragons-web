"use client";

import { UserPlus } from "@phosphor-icons/react/dist/ssr/UserPlus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { loadPositionChoices } from "@/components/club/positions-client";
import { loadGroups } from "@/components/groups/groups-client";
import type { NamedPosition } from "@/lib/club/club-positions";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { InvitationResend } from "./InvitationResend";
import type { CreatedMemberView } from "./new-member-client";
import { NewMemberForm } from "./NewMemberForm";

/**
 * El panel de invitar a un socio (#862, RF-9 y D11 del PRD de E33), bajo la
 * cabecera del Directorio como el redactor de correo; antes era la página
 * aparte `/directorio/nuevo` (#243). Lo abre el botón `user-plus` de la
 * cabecera, que sólo ve un Admin, y el endpoint del alta lo vuelve a
 * comprobar.
 *
 * Es de cliente porque lee y escribe por la API v1, la misma que usará la
 * aplicación nativa de Release 2 (CON-002). Lo que se enseña al terminar
 * sigue siendo el aviso de #243 hasta que #863 traiga los estados nuevos.
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

function CreatedNotice({
  translate,
  created,
  onAddAnother,
}: {
  translate: Translator;
  created: CreatedMemberView;
  onAddAnother: () => void;
}): React.JSX.Element {
  const { fullName: name, email, userId } = created.member;
  const wasSent = created.invitation === "sent";
  return (
    <div className="invite-created">
      <p
        className={wasSent ? "auth-note" : "auth-error"}
        role={wasSent ? "status" : "alert"}
      >
        {translate(
          wasSent ? "newMember.created.sent" : "newMember.created.notSent",
          { name, email },
        )}
      </p>
      <div className="new-member-actions">
        {wasSent ? null : (
          <InvitationResend
            translate={translate}
            userId={userId}
            isPrimary
            sentText={translate("newMember.resent", { email })}
          />
        )}
        <button
          type="button"
          className="admin-secondary"
          onClick={onAddAnother}
        >
          {translate("newMember.addAnother")}
        </button>
      </div>
    </div>
  );
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

export function InviteMemberPanel({
  locale,
  clubName,
  onClose,
}: {
  readonly locale: Locale;
  /** El que firma la invitación, para la vista previa. */
  readonly clubName: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { catalogs, retry } = useCatalogs();
  const [created, setCreated] = useState<CreatedMemberView | null>(null);

  // Quien lo abre desde la cabecera llega al formulario, no se queda arriba.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

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
      {catalogs.kind === "ready" && created !== null ? (
        <CreatedNotice
          translate={translate}
          created={created}
          onAddAnother={() => setCreated(null)}
        />
      ) : null}
      {catalogs.kind === "ready" && created === null ? (
        <NewMemberForm
          locale={locale}
          clubName={clubName}
          clubGroups={catalogs.groups}
          positions={catalogs.positions}
          onCreated={setCreated}
          onCancel={onClose}
        />
      ) : null}
    </section>
  );
}
