import { SealCheck } from "@phosphor-icons/react/dist/ssr/SealCheck";
import { SealQuestion } from "@phosphor-icons/react/dist/ssr/SealQuestion";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import { aufExpiryOutlookOf } from "@/lib/members/auf-expiry";
import type { OwnAuf } from "@/lib/members/own-profile";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { type CardCell, CardCells } from "./CardCells";
import { EmptyValue } from "./DetailList";

/**
 * La lectura de Registro AUF (#773, RF-4 del PRD de E30), la misma en el
 * perfil y en la ficha: el número en mono, el vencimiento con los días que
 * faltan, en aviso si son menos de 90, y el estado. Lo que falta se cuenta
 * desde hoy en el club.
 *
 * En el móvil (#777) es una fila de 58 px con el estado a la derecha: lo
 * hace la hoja de estilos con `profile-auf-cells`.
 */

function ExpiryValue({
  translate,
  expiry,
}: {
  translate: Translator;
  expiry: string;
}): React.JSX.Element {
  const outlook = aufExpiryOutlookOf(expiry, clubCalendarDate(new Date()));
  const [text, className] =
    outlook.kind === "expired"
      ? [
          translate("profileCard.auf.expired"),
          "profile-cell-extra profile-cell-late",
        ]
      : [
          translate("profileCard.auf.inDays", { count: outlook.days }),
          outlook.isSoon
            ? "profile-cell-extra profile-cell-soon"
            : "profile-cell-extra",
        ];
  return (
    <>
      {formatCalendarDay(translate.locale, expiry)}{" "}
      <span className={className}>· {text}</span>
    </>
  );
}

function StatusValue({
  translate,
  auf,
}: {
  translate: Translator;
  auf: OwnAuf;
}): React.JSX.Element {
  switch (auf.status) {
    case "none":
      return (
        <span className="profile-cell-missing">
          {translate("profileCard.auf.notAdded")}
        </span>
      );
    case "verified":
      return (
        <span className="profile-cell-status profile-cell-status-success">
          <SealCheck aria-hidden="true" weight="fill" />
          {translate("profileCard.auf.verified")}
        </span>
      );
    case "pending":
      return (
        <span className="profile-cell-status profile-cell-status-warning">
          <SealQuestion aria-hidden="true" weight="fill" />
          {translate("profileCard.auf.pending")}
        </span>
      );
  }
}

function cellsOf(translate: Translator, auf: OwnAuf): readonly CardCell[] {
  const empty = <EmptyValue translate={translate} />;
  const isNone = auf.status === "none";
  return [
    {
      label: translate("profileCard.auf.number"),
      value: isNone ? (
        empty
      ) : (
        <span className="profile-cell-mono">{auf.number}</span>
      ),
    },
    {
      label: translate("profileCard.auf.expires"),
      value:
        isNone || auf.expiry === null ? (
          empty
        ) : (
          <ExpiryValue translate={translate} expiry={auf.expiry} />
        ),
    },
    {
      label: translate("profileCard.auf.status"),
      value: <StatusValue translate={translate} auf={auf} />,
    },
  ];
}

export function AufCells({
  translate,
  auf,
}: {
  translate: Translator;
  auf: OwnAuf;
}): React.JSX.Element {
  return (
    <CardCells cells={cellsOf(translate, auf)} className="profile-auf-cells" />
  );
}
