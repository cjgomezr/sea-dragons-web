"use client";

import { useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { type HeroMember, ProfileHero } from "@/components/account/ProfileHero";
import type { Group } from "@/lib/groups/groups";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { MemberRecord } from "@/lib/members/member-record";
import { AufPendingStrip, type PendingAuf } from "./AufPendingStrip";
import { MemberRecordAbout } from "./MemberRecordAbout";
import { MemberRecordActions } from "./MemberRecordActions";
import { MemberRecordAside } from "./MemberRecordAside";
import { MemberRecordAuf } from "./MemberRecordAuf";
import { MemberRecordClubRecord } from "./MemberRecordClubRecord";
import { MemberRecordContact } from "./MemberRecordContact";
import {
  type MemberRecordFailure,
  describeMemberRecordFailure,
  verifyMemberRecordAuf,
} from "./member-record-client";

/**
 * La ficha reservada al Admin (#242) bajo su cabecera (#771). A la izquierda,
 * sus tarjetas: Sobre mí, para leer; Contacto (#499, #772), Registro AUF y
 * Ficha del club (#773), que el Admin edita cada una aparte y guarda con su
 * propio envío. A la derecha, su columna (#774).
 *
 * Cada tarjeta da un cambio por hecho sólo cuando el servidor lo confirma, y
 * entonces la ficha enseña lo que el servidor guardó, no lo que se escribió:
 * si el número del AUF se borró, el vencimiento también desaparece.
 *
 * Un AUF que escribió el miembro llega sin verificar (#274). El Admin lo
 * verifica desde la franja de debajo de la cabecera (#771), que manda el AUF
 * guardado y no el de los controles; por eso su botón desaparece en cuanto el
 * número o el vencimiento se editan: entonces guardar ya lo deja verificado.
 */

type VerifyStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "verifying" }
  | { readonly kind: "verified" }
  | MemberRecordFailure;

/** Lo que pasó al verificar desde la franja, debajo de la cabecera. */
function VerifyOutcome({
  translate,
  status,
}: {
  translate: Translator;
  status: VerifyStatus;
}): React.JSX.Element | null {
  if (status.kind === "verified") {
    return (
      <p className="profile-strip profile-strip-success" role="status">
        <CheckCircle aria-hidden="true" weight="regular" />
        {translate("memberRecord.auf.verified")}
      </p>
    );
  }
  if (status.kind === "failed") {
    return (
      <p className="auth-error" role="alert">
        {describeMemberRecordFailure(translate, status)}
      </p>
    );
  }
  return null;
}

/** La cabecera compartida (#771) con lo que la ficha sabe. El rol y la
 * membresía los cambia la pantalla (#549, #457) y llegan de ella. */
function heroMemberOf(
  record: MemberRecord,
  screenRecord: MemberRecord,
): HeroMember {
  return {
    userId: record.userId,
    fullName: record.fullName,
    role: screenRecord.role,
    positionNames: record.positionName,
    experienceLevel: record.experienceLevel,
    country: record.country,
    membershipStatus: screenRecord.membershipStatus,
    auf:
      record.aufNumber === null
        ? null
        : {
            isVerified: record.isAufVerified,
            isExpired: record.isAufExpired,
          },
    joinedOn: record.joinedOn,
    photoUrl: record.photoUrl,
  };
}

/** El AUF que escribió el miembro y nadie ha verificado, o null. */
function pendingAufOf(record: MemberRecord): PendingAuf | null {
  if (record.aufNumber === null || record.isAufVerified) {
    return null;
  }
  return {
    fullName: record.fullName,
    aufNumber: record.aufNumber,
    aufExpiry: record.aufExpiry,
  };
}

export function MemberRecordForm({
  locale,
  record: initialRecord,
  clubGroups,
  adminMenu,
  adminPanel,
}: {
  locale: Locale;
  record: MemberRecord;
  clubGroups: readonly Group[];
  /** El ⋯ de la cabecera (#775). */
  adminMenu: React.ReactNode;
  /** Lo que abrió la última opción del ⋯, justo bajo la cabecera. */
  adminPanel: React.ReactNode;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [record, setRecord] = useState(initialRecord);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({
    kind: "idle",
  });
  const [isAufEdited, setIsAufEdited] = useState(false);
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isVerifyingRef = useRef(false);

  async function handleVerify(): Promise<void> {
    if (isVerifyingRef.current || record.aufNumber === null) {
      return;
    }
    isVerifyingRef.current = true;
    setVerifyStatus({ kind: "verifying" });
    const shown = { aufNumber: record.aufNumber, aufExpiry: record.aufExpiry };
    const result = await verifyMemberRecordAuf(record.userId, shown);
    isVerifyingRef.current = false;
    if (result.kind === "failed") {
      setVerifyStatus(result);
      return;
    }
    setRecord(result.record);
    setVerifyStatus({ kind: "verified" });
  }

  function handleCardSaved(saved: MemberRecord): void {
    setRecord(saved);
    // Un aviso de la franja habla de la ficha de antes.
    setVerifyStatus({ kind: "idle" });
  }

  const pendingAuf = pendingAufOf(record);

  return (
    <>
      <ProfileHero
        locale={locale}
        isOwnProfile={false}
        member={heroMemberOf(record, initialRecord)}
        actions={
          // Los botones de contacto leen la ficha guardada aquí: si el Admin
          // acaba de corregir el teléfono, llaman al nuevo.
          <MemberRecordActions
            translate={translate}
            reading={record}
            adminMenu={adminMenu}
          />
        }
      />
      {adminPanel}
      {pendingAuf === null ? null : (
        <AufPendingStrip
          translate={translate}
          auf={pendingAuf}
          isVerifying={verifyStatus.kind === "verifying"}
          canVerify={!isAufEdited}
          onVerify={handleVerify}
        />
      )}
      <VerifyOutcome translate={translate} status={verifyStatus} />
      <div className="profile-layout">
        <div className="profile-main">
          <MemberRecordAbout translate={translate} record={record} />
          <MemberRecordContact
            translate={translate}
            locale={locale}
            record={record}
            onSaved={handleCardSaved}
          />
          <MemberRecordAuf
            translate={translate}
            locale={locale}
            record={record}
            onSaved={handleCardSaved}
            onChanges={setIsAufEdited}
          />
          <MemberRecordClubRecord
            translate={translate}
            locale={locale}
            record={record}
            onSaved={handleCardSaved}
          />
        </div>
        <MemberRecordAside
          translate={translate}
          record={record}
          membershipStatus={initialRecord.membershipStatus}
          clubGroups={clubGroups}
          onRecordSaved={setRecord}
        />
      </div>
    </>
  );
}
