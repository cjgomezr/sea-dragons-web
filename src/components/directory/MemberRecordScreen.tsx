"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AccountStatus } from "@/lib/auth/account-status";
import { DIRECTORY_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  type MemberRecordLoad,
  describeMemberRecordFailure,
  loadMemberRecord,
} from "./member-record-client";
import { InvitationResend } from "./InvitationResend";
import { MemberRecordForm } from "./MemberRecordForm";
import { MemberStatusControl } from "./MemberStatusControl";

/**
 * La ficha reservada al Admin de un miembro (#242, RF-4 del PRD de E5), que se
 * abre desde su fila del directorio: su número de AUF, su vencimiento y sus
 * grupos.
 *
 * La frontera ya mandó al panel a quien no es Admin; si alguien deja de serlo
 * con la pantalla abierta, el 403 del endpoint lo dice aquí. Es de cliente
 * porque lee y guarda por la API v1, la misma que usará la aplicación nativa
 * de Release 2 (CON-002). El idioma llega como prop porque el traductor no
 * puede cruzar del servidor al navegador.
 */

type ScreenState = { readonly kind: "loading" } | MemberRecordLoad;

export function MemberRecordScreen({
  locale,
  userId,
}: {
  locale: Locale;
  userId: string;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadMemberRecord(userId).then((outcome) => {
      if (isCurrent) {
        setState(outcome);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [userId, reloads]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  /** La baja o la reactivación (#244) cambia sólo el estado: el resto de la
   * ficha sigue siendo la misma y no hace falta volver a pedirla. */
  function applyStatus(accountStatus: AccountStatus): void {
    setState((current) =>
      current.kind === "loaded"
        ? { ...current, record: { ...current.record, accountStatus } }
        : current,
    );
  }

  return (
    <div className="member-record">
      <Link href={DIRECTORY_PATH} className="member-record-back">
        {translate("memberRecord.back")}
      </Link>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("memberRecord.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {describeMemberRecordFailure(translate, state)}
          </p>
          <button type="button" className="auth-submit" onClick={retryLoad}>
            {translate("directory.retry")}
          </button>
        </div>
      ) : null}
      {state.kind === "loaded" ? (
        <MemberRecordForm
          locale={locale}
          record={state.record}
          clubGroups={state.clubGroups}
        />
      ) : null}
      {state.kind === "loaded" &&
      state.record.accountStatus === "incomplete" ? (
        <section className="admin-section" aria-labelledby="ficha-invitacion">
          <h2 id="ficha-invitacion">
            {translate("memberRecord.invitation.title")}
          </h2>
          <p className="app-lead">
            {translate("memberRecord.invitation.lead", {
              name: state.record.fullName,
            })}
          </p>
          <InvitationResend
            translate={translate}
            userId={userId}
            isPrimary={false}
            sentText={translate("memberRecord.invitation.resent", {
              name: state.record.fullName,
            })}
          />
        </section>
      ) : null}
      {state.kind === "loaded" ? (
        <MemberStatusControl
          translate={translate}
          member={state.record}
          onStatusChanged={applyStatus}
        />
      ) : null}
    </div>
  );
}
