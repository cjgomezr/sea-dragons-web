"use client";

import { useState } from "react";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipStatus } from "@/lib/membership/membership";
import type { MembershipWaiverChange } from "@/lib/membership/membership-waiver";
import type { MembershipWaiverView } from "@/lib/membership/membership-view";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { RemoveWaiverDialog, WaiveDialog } from "./MembershipWaiverDialogs";

/**
 * La exención de cuota desde la ficha (#457, RF-4 del PRD de E12, D4), junto
 * a la baja (#244) y con su misma forma: un botón que dice lo contrario de lo
 * que el socio es. A quien paga se le ofrece eximirlo; a quien está exento,
 * retirarle la exención. Las dos cosas se confirman en un diálogo.
 *
 * Lo que enseña es lo que la ficha tiene de verdad: sólo cambia cuando el
 * servidor confirma.
 */

type OpenDialog = "none" | "waive" | "remove";

type Notice = "none" | "waived" | "removed";

/** Un instante como el día de Melbourne en que cae ("1 March 2027"). */
function formatClubDay(translate: Translator, instant: string): string {
  return formatCalendarDay(
    translate.locale,
    clubCalendarDate(new Date(instant)),
  );
}

function WaiverDetails({
  translate,
  waiver,
}: {
  readonly translate: Translator;
  readonly waiver: MembershipWaiverView;
}): React.JSX.Element {
  return (
    <ul className="member-waiver-details">
      <li>{translate("membershipWaiver.reason", { reason: waiver.reason })}</li>
      <li>
        {waiver.until === null
          ? translate("membershipWaiver.noEndDate")
          : translate("membershipWaiver.until", {
              date: formatClubDay(translate, waiver.until),
            })}
      </li>
    </ul>
  );
}

export function MembershipWaiverControl({
  translate,
  member,
  onWaiverChanged,
}: {
  readonly translate: Translator;
  readonly member: {
    readonly userId: string;
    readonly fullName: string;
    readonly membershipStatus: MembershipStatus | null;
    readonly membershipWaiver: MembershipWaiverView | null;
  };
  /** La ficha guarda la membresía nueva: el chip de la cabecera también
   * cambia. */
  readonly onWaiverChanged: (change: MembershipWaiverChange) => void;
}): React.JSX.Element {
  const [openDialog, setOpenDialog] = useState<OpenDialog>("none");
  const [notice, setNotice] = useState<Notice>("none");
  const waiver =
    member.membershipStatus === "waived" ? member.membershipWaiver : null;
  const name = member.fullName;

  function applyChange(change: MembershipWaiverChange): void {
    setOpenDialog("none");
    setNotice(change.waiver === null ? "removed" : "waived");
    onWaiverChanged(change);
  }

  const dialogProps = {
    translate,
    userId: member.userId,
    name,
    onChanged: applyChange,
    onClosed: () => setOpenDialog("none"),
  };

  return (
    <section className="admin-section" aria-labelledby="ficha-cuota">
      <h2 id="ficha-cuota">{translate("membershipWaiver.title")}</h2>
      <p className="app-lead">
        {translate(
          waiver === null
            ? "membershipWaiver.lead.notWaived"
            : "membershipWaiver.lead.waived",
          { name },
        )}
      </p>
      {waiver === null ? null : (
        <WaiverDetails translate={translate} waiver={waiver} />
      )}
      {notice === "none" ? null : (
        <p className="auth-note" role="status">
          {translate(
            notice === "waived"
              ? "membershipWaiver.waived"
              : "membershipWaiver.removed",
            { name },
          )}
        </p>
      )}
      <div>
        <button
          type="button"
          className="admin-secondary"
          onClick={() => setOpenDialog(waiver === null ? "waive" : "remove")}
        >
          {translate(
            waiver === null
              ? "membershipWaiver.waive"
              : "membershipWaiver.remove",
          )}
        </button>
      </div>
      {openDialog === "waive" ? <WaiveDialog {...dialogProps} /> : null}
      {openDialog === "remove" ? <RemoveWaiverDialog {...dialogProps} /> : null}
    </section>
  );
}
