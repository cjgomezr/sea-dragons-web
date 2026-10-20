"use client";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MemberAttendanceSummary } from "@/components/attendance/MemberAttendanceSummary";
import { DIRECTORY_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { Group } from "@/lib/groups/groups";
import type { MemberRecord } from "@/lib/members/member-record";
import {
  type MemberRecordLoad,
  describeMemberRecordFailure,
  loadMemberRecord,
} from "./member-record-client";
import { type AdminAction, MemberAdminMenu } from "./MemberAdminMenu";
import { type AdminPanel, MemberAdminPanel } from "./MemberAdminPanel";
import { MemberRecordEvaluation } from "./MemberRecordEvaluation";
import { MemberRecordForm } from "./MemberRecordForm";
import { useMemberStatusChange } from "./MemberStatusControl";

/**
 * La ficha reservada al Admin de un miembro (#242, RF-4 del PRD de E5), que se
 * abre desde su fila del directorio: su número de AUF, su vencimiento y sus
 * grupos, su asistencia (#396), su evaluación para leer (#324) y su rol
 * (#549). El rol, la exención, la invitación y la baja se piden en el ⋯ de
 * la cabecera (#775).
 *
 * La frontera ya mandó al panel a quien no es Admin; si alguien deja de serlo
 * con la pantalla abierta, el 403 del endpoint lo dice aquí. Es de cliente
 * porque lee y guarda por la API v1, la misma que usará la aplicación nativa
 * de Release 2 (CON-002). El idioma llega como prop porque el traductor no
 * puede cruzar del servidor al navegador.
 */

type ScreenState = { readonly kind: "loading" } | MemberRecordLoad;

/** Lo que la ficha cambia de sí misma desde el ⋯ de la cabecera. */
type RecordChange = Partial<
  Pick<
    MemberRecord,
    "role" | "accountStatus" | "membershipStatus" | "membershipWaiver"
  >
>;

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

  /** El rol, la exención o el estado que el ⋯ cambió: el resto de la ficha
   * sigue siendo la misma y no hace falta volver a pedirla. */
  function applyChange(change: RecordChange): void {
    setState((current) =>
      current.kind === "loaded"
        ? { ...current, record: { ...current.record, ...change } }
        : current,
    );
  }

  return (
    <div className="member-record">
      <Link href={DIRECTORY_PATH} className="member-record-back">
        <ArrowLeft aria-hidden="true" weight="bold" />
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
        <LoadedMemberRecord
          locale={locale}
          translate={translate}
          loaded={state}
          onRecordChanged={applyChange}
        />
      ) : null}
    </div>
  );
}

/** La ficha ya cargada, con el ⋯ del Admin y lo que abre cada opción. */
function LoadedMemberRecord({
  locale,
  translate,
  loaded,
  onRecordChanged,
}: {
  locale: Locale;
  translate: Translator;
  loaded: {
    readonly record: MemberRecord;
    readonly clubGroups: readonly Group[];
  };
  onRecordChanged: (change: RecordChange) => void;
}): React.JSX.Element {
  const { record } = loaded;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // La clave cambia con cada elección: elegir otra vez la misma opción la
  // abre de nuevo, con su diálogo si lo tiene.
  const [choice, setChoice] = useState<{
    readonly panel: AdminPanel;
    readonly key: number;
  }>({ panel: "none", key: 0 });
  const statusChange = useMemberStatusChange({
    member: record,
    onStatusChanged: (accountStatus) => onRecordChanged({ accountStatus }),
  });

  function chooseAction(action: AdminAction): void {
    setChoice((current) => ({ panel: action, key: current.key + 1 }));
    // Un cambio en curso no se olvida: su respuesta todavía tiene que verse.
    const isSaving = statusChange.state.kind === "saving";
    if ((action === "deactivate" || action === "reactivate") && !isSaving) {
      statusChange.reset();
    }
    if (action === "reactivate") {
      void statusChange.changeStatus();
    }
  }

  function cancelDeactivation(): void {
    setChoice((current) => ({ ...current, panel: "none" }));
    menuButtonRef.current?.focus();
  }

  return (
    <>
      <MemberRecordForm
        locale={locale}
        record={record}
        clubGroups={loaded.clubGroups}
        adminMenu={
          <MemberAdminMenu
            translate={translate}
            member={record}
            openerRef={menuButtonRef}
            onChoose={chooseAction}
          />
        }
        adminPanel={
          <MemberAdminPanel
            key={choice.key}
            translate={translate}
            record={record}
            panel={choice.panel}
            statusChange={statusChange}
            handlers={{
              onRoleChanged: (role) => onRecordChanged({ role }),
              onWaiverChanged: ({ membershipStatus, waiver }) =>
                onRecordChanged({
                  membershipStatus,
                  membershipWaiver: waiver,
                }),
              onDeactivationCancelled: cancelDeactivation,
            }}
          />
        }
      />
      <MemberAttendanceSummary
        translate={translate}
        locale={locale}
        attendance={record.attendance}
        headingId="ficha-asistencia"
        className="admin-section"
      />
      <MemberRecordEvaluation translate={translate} userId={record.userId} />
    </>
  );
}
