import Link from "next/link";
import {
  type ConfirmationState,
  REGISTRATION_PATH,
} from "@/lib/auth/registration-screen";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";

/** Cada desenlace sustituye al formulario, así que cada uno necesita una
 * salida o es un callejón sin salida: entrar si el correo quedó confirmado,
 * volver al registro si hay que pedir otro enlace. */
type ConfirmationAction = "sign-in" | "back-to-registration";

type ConfirmationPanel = {
  readonly heading: string;
  readonly body: string;
  readonly note: string;
  readonly action: ConfirmationAction;
};

/** Los pasos que de verdad acaban en un enlace nuevo, escritos una sola vez
 * porque los dos desenlaces sin enlace válido cuentan lo mismo.
 *
 * Volver a registrarse NO manda ningún enlace: con una dirección que ya tiene
 * identidad el registro sale sin emitirlo, para no escribirle a esa persona en
 * cada intento ajeno (#147). Lo que sí hace es devolver a la pantalla de
 * confirmación, y el enlace lo pide el botón que hay ahí (#179). El texto no
 * dice nada sobre si esa dirección tiene cuenta: vale igual para quien la
 * tiene y para quien no. El nombre del botón sale de su propia clave, para que
 * el texto no pueda nombrar un botón que ya se llama de otra forma. */
function describeAnotherLinkSteps(translate: Translator): string {
  return translate("auth.confirmation.anotherLinkSteps", {
    resendButton: translate("auth.registration.resend"),
  });
}

function describePanel(
  translate: Translator,
  state: ConfirmationState,
): ConfirmationPanel {
  switch (state) {
    case "ok":
      return {
        heading: translate("auth.confirmation.confirmedTitle"),
        body: translate("auth.confirmation.activeBody"),
        note: translate("auth.confirmation.activeNote"),
        action: "sign-in",
      };
    case "pendiente":
      return {
        heading: translate("auth.confirmation.confirmedTitle"),
        body: translate("auth.confirmation.incompleteBody"),
        // La entrada ya manda a completar registro a una cuenta incompleta.
        note: translate("auth.confirmation.incompleteNote"),
        action: "sign-in",
      };
    case "invalida":
      return {
        heading: translate("auth.confirmation.invalidTitle"),
        body: translate("auth.confirmation.invalidBody", {
          anotherLinkSteps: describeAnotherLinkSteps(translate),
        }),
        note: translate("auth.confirmation.contactClub"),
        action: "back-to-registration",
      };
    case "error":
      // El enlace ya se consumió al intentarlo, así que "inténtalo otra vez"
      // con el mismo enlace no lleva a ninguna parte: hay que pedir uno nuevo.
      return {
        heading: translate("auth.confirmation.errorTitle"),
        body: translate("auth.confirmation.errorBody", {
          anotherLinkSteps: describeAnotherLinkSteps(translate),
        }),
        note: translate("auth.confirmation.contactClub"),
        action: "back-to-registration",
      };
  }
}

function ConfirmationActionLink({
  translate,
  action,
}: {
  translate: Translator;
  action: ConfirmationAction;
}): React.JSX.Element {
  if (action === "sign-in") {
    return (
      <Link className="auth-submit auth-submit-link" href={SIGN_IN_PATH}>
        {translate("auth.signIn.submit")}
      </Link>
    );
  }
  return (
    <Link className="auth-back" href={REGISTRATION_PATH}>
      {translate("auth.confirmation.backToRegistration")}
    </Link>
  );
}

/** El desenlace del enlace de confirmación, al que aterriza quien lo abre. */
export function RegistrationConfirmationPanel({
  locale,
  state,
}: {
  locale: Locale;
  state: ConfirmationState;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const panel = describePanel(translate, state);
  return (
    <section className="auth-form" aria-labelledby="registro-estado-titulo">
      <h1 id="registro-estado-titulo">{panel.heading}</h1>
      <p className="auth-lead">{panel.body}</p>
      <p className="auth-note">{panel.note}</p>
      <ConfirmationActionLink translate={translate} action={panel.action} />
    </section>
  );
}
