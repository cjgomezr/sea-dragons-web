"use client";

import { MembershipCard } from "@/components/account/MembershipCard";
import { SeasonAttendanceCard } from "@/components/attendance/SeasonAttendanceCard";
import type { Group } from "@/lib/groups/groups";
import type { Translator } from "@/lib/i18n/translator";
import type { MemberRecord } from "@/lib/members/member-record";
import { MemberRecordEvaluation } from "./MemberRecordEvaluation";
import { MemberRecordGroups } from "./MemberRecordGroups";

/**
 * La columna derecha de la ficha del Admin (#774, RF-5 del PRD de E30):
 * Membresía sin Pagos (la exención va por el Admin), la asistencia de la
 * temporada, Grupos, que el Admin edita, y la evaluación. El Rol no va: en la
 * ficha lo cambia el Admin.
 */
export function MemberRecordAside({
  translate,
  record,
  membershipStatus,
  clubGroups,
  onRecordSaved,
}: {
  translate: Translator;
  record: MemberRecord;
  /** El de la pantalla, que la exención (#457) cambia sin volver a pedir la
   * ficha. */
  membershipStatus: MemberRecord["membershipStatus"];
  clubGroups: readonly Group[];
  onRecordSaved: (record: MemberRecord) => void;
}): React.JSX.Element {
  return (
    <div className="profile-aside">
      <MembershipCard
        translate={translate}
        headingId="ficha-plan"
        membership={{
          plan: record.membershipPlan,
          status: membershipStatus,
          renewsOn: record.membershipRenewsOn,
        }}
        hasPaymentsLink={false}
      />
      <SeasonAttendanceCard
        translate={translate}
        attendance={record.attendance}
        headingId="ficha-asistencia"
      />
      <MemberRecordGroups
        translate={translate}
        record={record}
        clubGroups={clubGroups}
        onSaved={onRecordSaved}
      />
      <MemberRecordEvaluation translate={translate} userId={record.userId} />
    </div>
  );
}
