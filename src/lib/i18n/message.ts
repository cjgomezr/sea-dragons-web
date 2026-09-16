import type { englishMessages } from "./messages/en";

/** Un texto que cambia con una cantidad. Las formas son las categorías que
 * `Intl.PluralRules` devuelve para cada idioma; `other` es obligatoria porque
 * es la que queda cuando el idioma no distingue la categoría pedida (el
 * español, por ejemplo, devuelve `many` para un millón). */
export type PluralMessage = Readonly<
  Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
>;

/** Un texto del catálogo. Los datos van entre llaves, `{email}`, y se
 * rellenan al traducir. Un `PluralMessage` recibe siempre `{count}`. */
export type Message = string | PluralMessage;

/** El inglés define las claves; el resto de idiomas tiene que dar las mismas. */
export type MessageKey = keyof typeof englishMessages;

/** Un catálogo de otro idioma: las mismas claves que el inglés, y cada una con
 * la misma forma (texto simple o plural), aunque con sus propias palabras. */
export type MessageCatalog = {
  readonly [Key in MessageKey]: (typeof englishMessages)[Key] extends string
    ? string
    : PluralMessage;
};
