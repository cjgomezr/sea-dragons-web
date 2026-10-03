import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  EMAIL_CONFIRMATION_TOKEN_HASH_PARAM,
  EMAIL_CONFIRMATION_TYPE_PARAM,
  parseEmailConfirmationLink,
} from "@/lib/auth/email-confirmation";
import { registrationPathWithConfirmation } from "@/lib/auth/registration-screen";
import { EMAIL_CONFIRMATION_REDEEM_PATH } from "@/lib/auth/routes";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("auth.confirmEmail.metaTitle", { club }),
    description: translate("auth.confirmEmail.metaDescription", { club }),
    // La URL lleva el token del enlace, así que no puede salir de aquí en la
    // cabecera Referer. Tampoco vale "no-referrer": con esa política el
    // navegador manda `Origin: null` en el POST del botón, y el canje lo
    // rechazaría por no venir de nuestro origen.
    referrer: "same-origin",
  };
}

/**
 * La pantalla a la que lleva el enlace del correo de confirmación (#477).
 * Abrirla no canjea nada: los escáneres de enlaces del correo de empresa la
 * abren antes que la persona, y el token sólo sirve una vez. El canje lo hace
 * el botón, con un POST a `EMAIL_CONFIRMATION_REDEEM_PATH`.
 */
export default async function EmailConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const query = await searchParams;
  const link = parseEmailConfirmationLink(
    query[EMAIL_CONFIRMATION_TOKEN_HASH_PARAM],
    query[EMAIL_CONFIRMATION_TYPE_PARAM],
  );
  if (link === null) {
    redirect(registrationPathWithConfirmation("invalida"));
  }

  const translate = createTranslator(await readRequestLocale());
  return (
    <form
      className="auth-form"
      method="post"
      action={EMAIL_CONFIRMATION_REDEEM_PATH}
      aria-labelledby="confirmar-correo-titulo"
    >
      <h1 id="confirmar-correo-titulo">
        {translate("auth.confirmEmail.title")}
      </h1>
      <p className="auth-lead">{translate("auth.confirmEmail.lead")}</p>
      <input
        type="hidden"
        name={EMAIL_CONFIRMATION_TOKEN_HASH_PARAM}
        value={link.tokenHash}
      />
      <input
        type="hidden"
        name={EMAIL_CONFIRMATION_TYPE_PARAM}
        value={link.type}
      />
      <button type="submit" className="auth-submit">
        {translate("auth.confirmEmail.submit")}
      </button>
    </form>
  );
}
