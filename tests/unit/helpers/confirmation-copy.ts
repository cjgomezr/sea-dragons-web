import { expect } from "vitest";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Lo que la copia del enlace de confirmación puede y no puede decir.
 *
 * Vive en un solo sitio porque esa copia vive en cuatro: el correo, los dos
 * paneles del desenlace del enlace y la pantalla de "Confirma tu correo".
 * Tenerla repartida es lo que dejó que tres textos prometieran durante meses
 * un camino que el servidor no recorre (#179).
 */

/** El botón que de verdad pide otro enlace, en la pantalla de confirmación.
 * Con el envío de correos caído ese mismo botón se llama "Reintentar el
 * envío" (#154), así que quien toque cualquiera de las dos etiquetas tiene
 * tres textos apuntando aquí. */
export const RESEND_BUTTON_LABEL: Readonly<Record<Locale, string>> = {
  en: "Resend the email",
  es: "Reenviar el correo",
};

/** Cómo se llama en cada idioma la pantalla a la que devuelve registrarse
 * otra vez, que es donde está ese botón. */
export const CONFIRMATION_SCREEN_NAME: Readonly<Record<Locale, RegExp>> = {
  en: /confirmation screen/i,
  es: /pantalla de confirmación/i,
};

/**
 * Prometer que registrarse otra vez manda otro enlace.
 *
 * No lo manda: con una dirección que ya tiene identidad,
 * `createAccountAndRequestEmail` sale por `already_registered` y no emite
 * ninguno, a propósito (#147). Lo único que hace ese segundo registro es
 * devolver a la pantalla de confirmación, y ahí el enlace lo pide el botón.
 *
 * Son trampas tendidas a la redacción vieja, no una gramática del engaño: si
 * un día la copia se reescribe de arriba abajo, toca revisar estos patrones,
 * nunca relajarlos para que la frase nueva pase. Los ingleses tienden las
 * mismas trampas a la traducción (E17).
 */
export const REGISTERING_AGAIN_SENDS_A_LINK: readonly RegExp[] = [
  /vuelve a registrarte[^.]*(mandaremos|enviaremos|otro enlace|otro correo)/i,
  /(regístrate|registrarte) (otra vez|de nuevo)[^.]*(mandaremos|enviaremos|otro enlace|otro correo)/i,
  /pedir otro desde la pantalla de registro/i,
  /sign(ing)? up again[^.]*(we('ll| will) send|another link|another email)/i,
  /ask for another (one|link) from the sign-up screen/i,
];

/**
 * Afirmar si esta dirección tiene cuenta o no.
 *
 * La frontera la fija el #147 y la vigila, del lado de las respuestas,
 * `tests/unit/api/auth/email-delivery-enumeration.test.ts`. Aquí se vigila el
 * otro lado, el de las palabras: un texto que dé por hecho que ya había cuenta
 * (o que no la había) convierte la pantalla en el oráculo que la API se cuida
 * de no ser. Una condición ("si ya te habías registrado…") no afirma nada y
 * vale igual para cualquiera, así que sí puede escribirse.
 */
export const ACCOUNT_EXISTENCE_CLAIMS: readonly RegExp[] = [
  /\bya (tienes|tenías) (una )?cuenta\b/i,
  /\bno (tienes|tenías) (ninguna )?cuenta\b/i,
  /\bno (existe|hay) (ninguna )?cuenta\b/i,
  /\b(esta|esa) (dirección|cuenta) (ya )?(está|estaba|existe|existía)\b/i,
  /\b(correo|dirección) (ya )?registrad[oa]\b/i,
  /\bcuenta (nueva|existente)\b/i,
  /\byou (already )?(have|had) an account\b/i,
  /\byou (don't|do not|didn't|did not) have an account\b/i,
  /\b(no account exists|there is no account)\b/i,
  /\b(this|that) (address|account) (already )?(exists|existed|is registered)\b/i,
  /\b(email|address) (is )?already registered\b/i,
  /\b(new|existing) account\b/i,
];

/** Ninguno de los patrones aparece en el texto. El mensaje dice cuál coincidió
 * y en qué texto: con seis patrones y cuatro textos, un booleano pelado no
 * sirve para arreglar nada. */
export function expectNoneMatch(
  text: string,
  patterns: readonly RegExp[],
  label: string,
): void {
  for (const pattern of patterns) {
    expect(text, `${label} coincide con ${pattern}`).not.toMatch(pattern);
  }
}
