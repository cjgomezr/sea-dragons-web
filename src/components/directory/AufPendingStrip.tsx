import { SealCheck } from "@phosphor-icons/react/dist/ssr/SealCheck";
import { SealQuestion } from "@phosphor-icons/react/dist/ssr/SealQuestion";
import { useId } from "react";
import { EmphasizedValue } from "@/components/auth/EmphasizedValue";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La franja del AUF que escribió el socio y ningún Admin ha mirado (#771,
 * RF-2 del PRD de E30): quién lo añadió, el número y cuándo vence, con
 * Verificar AUF. Es una nota: pide hacer algo, pero no bloquea nada.
 *
 * Sólo se verifica el AUF guardado: con el número o el vencimiento editados
 * el botón no sale, porque entonces guardar ya lo deja verificado (#274).
 */

export type PendingAuf = {
  readonly fullName: string;
  readonly aufNumber: string;
  /** YYYY-MM-DD, o null sin vencimiento conocido. */
  readonly aufExpiry: string | null;
};

function stripTextOf(translate: Translator, auf: PendingAuf): string {
  const name = auf.fullName;
  const number = auf.aufNumber;
  return auf.aufExpiry === null
    ? translate("memberRecord.aufStrip.withoutExpiry", { name, number })
    : translate("memberRecord.aufStrip.withExpiry", {
        name,
        number,
        date: formatCalendarDay(translate.locale, auf.aufExpiry),
      });
}

export function AufPendingStrip({
  translate,
  auf,
  isVerifying,
  canVerify,
  onVerify,
}: {
  translate: Translator;
  auf: PendingAuf;
  isVerifying: boolean;
  canVerify: boolean;
  onVerify: () => void;
}): React.JSX.Element {
  const textId = useId();
  return (
    <div
      className="profile-strip profile-strip-warning"
      role="note"
      aria-labelledby={textId}
    >
      <SealQuestion
        className="profile-strip-icon"
        aria-hidden="true"
        weight="regular"
      />
      <p className="profile-strip-text" id={textId}>
        <EmphasizedValue
          text={stripTextOf(translate, auf)}
          value={auf.aufNumber}
        />
      </p>
      {canVerify ? (
        <button
          type="button"
          className="auth-submit profile-strip-button"
          disabled={isVerifying}
          onClick={onVerify}
        >
          <SealCheck aria-hidden="true" weight="bold" />
          {translate(
            isVerifying
              ? "memberRecord.auf.verifying"
              : "memberRecord.auf.verify",
          )}
        </button>
      ) : null}
    </div>
  );
}
