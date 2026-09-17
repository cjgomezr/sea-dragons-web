import { type Locale, isLocale } from "@/lib/i18n/locale";

/**
 * El idioma de los correos del club (E17, RF-6). Los correos salen después de
 * responder, a veces mucho después, así que no pueden mirar la cookie de quien
 * navega: el idioma se guarda en la fila del socio al registrarse, y se lee de
 * ahí al mandar.
 */

/** El idioma de quien no tiene uno que valga. Antes de E17 todos los correos
 * salían en español, y `0011_members_email_locale.sql` deja a los socios de
 * entonces con ese mismo idioma. */
export const FALLBACK_EMAIL_LOCALE: Locale = "es";

/** Lee el idioma guardado en la fila del socio de una identidad. `null` si la
 * identidad no tiene fila: la recuperación de contraseña no la exige. */
export type EmailLocaleDirectory = {
  findStoredEmailLocale(userId: string): Promise<string | null>;
};

/** Un valor que no es un idioma no rompe el envío: la restricción de la base
 * no lo deja entrar, y si aun así llegara, un correo en español es mejor que
 * ninguno. */
export async function readEmailLocale(
  directory: EmailLocaleDirectory,
  userId: string,
): Promise<Locale> {
  const stored = await directory.findStoredEmailLocale(userId);
  return isLocale(stored) ? stored : FALLBACK_EMAIL_LOCALE;
}
