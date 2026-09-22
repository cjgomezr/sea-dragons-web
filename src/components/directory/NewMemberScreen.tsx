"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DIRECTORY_PATH } from "@/lib/auth/routes";
import type { CountryOption } from "@/lib/geo/countries";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { loadGroups } from "@/components/groups/groups-client";
import { InvitationResend } from "./InvitationResend";
import type { CreatedMemberView } from "./new-member-client";
import { NewMemberForm } from "./NewMemberForm";

/**
 * El alta de un miembro por un Admin (#243, RF-5 del PRD de E5), abierta desde
 * la cabecera del directorio: el formulario y, al terminar, si la invitación
 * salió. Si no salió, el miembro ya está creado y aquí se ofrece reenviarla.
 *
 * La frontera ya mandó al panel a quien no es Admin. Es de cliente porque lee
 * y escribe por la API v1, la misma que usará la aplicación nativa de Release
 * 2 (CON-002). El idioma y los países llegan como props porque el traductor no
 * cruza del servidor al navegador.
 */

type GroupsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly groups: readonly Group[] };

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
    <section className="admin-section new-member-created">
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
    </section>
  );
}

export function NewMemberScreen({
  locale,
  countries,
}: {
  locale: Locale;
  countries: readonly CountryOption[];
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [groups, setGroups] = useState<GroupsState>({ kind: "loading" });
  const [created, setCreated] = useState<CreatedMemberView | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadGroups().then((outcome) => {
      if (isCurrent) {
        setGroups(
          outcome.kind === "loaded"
            ? { kind: "ready", groups: outcome.groups }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retryLoad(): void {
    setGroups({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return (
    <div className="member-record">
      <Link href={DIRECTORY_PATH} className="member-record-back">
        {translate("memberRecord.back")}
      </Link>
      <header className="member-record-header">
        <h1>{translate("newMember.title")}</h1>
        <p className="app-lead">{translate("newMember.lead")}</p>
      </header>
      {groups.kind === "loading" ? (
        <p className="admin-empty">{translate("newMember.loading")}</p>
      ) : null}
      {groups.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {translate("newMember.loadFailed")}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("directory.retry")}
          </button>
        </div>
      ) : null}
      {groups.kind === "ready" && created !== null ? (
        <CreatedNotice
          translate={translate}
          created={created}
          onAddAnother={() => setCreated(null)}
        />
      ) : null}
      {groups.kind === "ready" && created === null ? (
        <NewMemberForm
          locale={locale}
          countries={countries}
          clubGroups={groups.groups}
          onCreated={setCreated}
        />
      ) : null}
    </div>
  );
}
