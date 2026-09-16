import { expect } from "vitest";

/**
 * Lo que la copia del enlace de confirmación puede y no puede decir.
 *
 * Vive en un solo sitio porque esa copia vive en cuatro: el correo, los dos
 * paneles del desenlace del enlace y la pantalla de "Confirma tu correo".
 * Tenerla repartida es lo que dejó que tres textos prometieran durante meses
 * un camino que el servidor no recorre (#179).
 */

/** El botón que de verdad pide otro enlace, en la pantalla de confirmación. */
export const RESEND_BUTTON_LABEL = "Reenviar el correo";

/**
 * Prometer que registrarse otra vez manda otro enlace.
 *
 * No lo manda: con una dirección que ya tiene identidad,
 * `createAccountAndRequestEmail` sale por `already_registered` y no emite
 * ninguno, a propósito (#147). Lo único que hace ese segundo registro es
 * devolver a la pantalla de confirmación, y ahí el enlace lo pide el botón.
 */
export const REGISTERING_AGAIN_SENDS_A_LINK: readonly RegExp[] = [
  /vuelve a registrarte[^.]*(mandaremos|enviaremos|otro enlace|otro correo)/i,
  /(regístrate|registrarte) (otra vez|de nuevo)[^.]*(mandaremos|enviaremos|otro enlace|otro correo)/i,
  /pedir otro desde la pantalla de registro/i,
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
