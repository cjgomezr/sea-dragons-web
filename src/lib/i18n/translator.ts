import type { Locale } from "./locale";
import type { Message, MessageKey } from "./message";
import { messageCatalogs } from "./message-catalogs";
import type { englishMessages } from "./messages/en";

type EnglishMessage<Key extends MessageKey> = (typeof englishMessages)[Key];

type PlaceholderNames<Template> =
  Template extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

type TemplatesOf<Entry> = Entry extends string ? Entry : Entry[keyof Entry];

/** Los datos que pide una clave, deducidos de sus llaves en el catálogo
 * inglés. `count` elige la forma plural, así que tiene que ser un número. */
export type MessageParams<Key extends MessageKey> = {
  readonly [
    Name in PlaceholderNames<TemplatesOf<EnglishMessage<Key>>>
  ]: Name extends "count" ? number : string | number;
};

type ParamsArgument<Key extends MessageKey> = [
  PlaceholderNames<TemplatesOf<EnglishMessage<Key>>>,
] extends [never]
  ? []
  : [params: MessageParams<Key>];

export type Translator = <Key extends MessageKey>(
  key: Key,
  ...params: ParamsArgument<Key>
) => string;

type ParamValues = Readonly<Record<string, string | number | undefined>>;

const PLACEHOLDER = /\{(\w+)\}/g;

function selectTemplate(
  locale: Locale,
  message: Message,
  params: ParamValues,
): string {
  if (typeof message === "string") {
    return message;
  }
  const { count } = params;
  if (typeof count !== "number") {
    throw new TypeError(
      `Un mensaje plural necesita un número en {count}; llegó ${JSON.stringify(count)}.`,
    );
  }
  // La categoría que el idioma no escribe cae en `other`, que siempre está.
  return message[new Intl.PluralRules(locale).select(count)] ?? message.other;
}

function insertParams(
  locale: Locale,
  template: string,
  params: ParamValues,
): string {
  return template.replace(PLACEHOLDER, (_placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new TypeError(`Falta el dato {${name}} para el mensaje.`);
    }
    return typeof value === "number"
      ? new Intl.NumberFormat(locale).format(value)
      : value;
  });
}

/** Lo mismo en un componente de servidor que en uno de cliente: es una
 * función pura sobre catálogos estáticos. Un componente de cliente la llama
 * con el idioma que recibe como prop, porque la función devuelta no se puede
 * pasar del servidor al navegador. */
export function createTranslator(locale: Locale): Translator {
  const catalog: Readonly<Record<string, Message>> = messageCatalogs[locale];

  return (key, ...[params]) => {
    const message = catalog[key];
    if (message === undefined) {
      throw new RangeError(
        `No hay mensaje "${key}" en el catálogo "${locale}".`,
      );
    }
    const values: ParamValues = params ?? {};
    return insertParams(
      locale,
      selectTemplate(locale, message, values),
      values,
    );
  };
}
