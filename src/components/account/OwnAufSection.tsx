import { TextField } from "@/components/directory/record-fields";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import type { OwnAuf } from "@/lib/members/own-profile";

/**
 * El AUF dentro del perfil propio (#274). Sin AUF o con uno pendiente, el
 * miembro lo escribe; lo que escribe queda pendiente hasta que un Admin lo
 * verifique. Uno verificado sólo se lee: cambiarlo es cosa del Admin, y un
 * control desactivado invitaría a intentarlo.
 */

const AUF_NUMBER_ID = "perfil-auf-numero";
const AUF_EXPIRY_ID = "perfil-auf-vencimiento";
const AUF_STATE_ID = "perfil-auf-estado";

export type AufDraft = {
  readonly aufNumber: string;
  readonly aufExpiry: string;
};

function describeRegistration(
  translate: Translator,
  locale: Locale,
  auf: { readonly number: string; readonly expiry: string | null },
): string {
  return auf.expiry === null
    ? translate("account.profile.auf.withoutExpiry", { number: auf.number })
    : translate("account.profile.auf.summary", {
        number: auf.number,
        date: formatCalendarDay(locale, auf.expiry),
      });
}

/** Lo que se dice debajo de los campos: si hay uno pendiente, que lo está;
 * si no hay ninguno, que un Admin lo revisará. */
function stateTextOf(translate: Translator, auf: OwnAuf): string {
  return auf.status === "pending"
    ? translate("account.profile.auf.pending")
    : translate("account.profile.auf.hint");
}

export function OwnAufSection({
  translate,
  locale,
  auf,
  draft,
  numberIssueText,
  onChange,
}: {
  translate: Translator;
  locale: Locale;
  /** El AUF tal como está guardado. */
  auf: OwnAuf;
  draft: AufDraft;
  numberIssueText: string | null;
  onChange: (change: Partial<AufDraft>) => void;
}): React.JSX.Element {
  return (
    <section className="auth-fields" aria-labelledby="perfil-auf">
      <h3 id="perfil-auf">{translate("account.profile.auf.title")}</h3>
      {auf.status === "verified" ? (
        <>
          <p>{describeRegistration(translate, locale, auf)}</p>
          <p className="auth-hint">
            {translate("account.profile.auf.verified")}
          </p>
        </>
      ) : (
        <>
          <TextField
            id={AUF_NUMBER_ID}
            label={translate("account.profile.auf.number")}
            type="text"
            value={draft.aufNumber}
            issueText={numberIssueText}
            hintIds={[AUF_STATE_ID]}
            onChange={(aufNumber) => onChange({ aufNumber })}
          />
          <TextField
            id={AUF_EXPIRY_ID}
            label={translate("account.profile.auf.expiry")}
            type="date"
            value={draft.aufExpiry}
            issueText={null}
            onChange={(aufExpiry) => onChange({ aufExpiry })}
          />
          <p className="auth-hint" id={AUF_STATE_ID}>
            {stateTextOf(translate, auf)}
          </p>
        </>
      )}
    </section>
  );
}
