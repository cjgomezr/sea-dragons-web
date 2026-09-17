import { formatNumber } from "./format";
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

/** Un plural pide `count` aunque ninguna de sus formas lo escriba
 * ("One minute left"): sin él no hay forma que elegir. */
type ParamNames<Entry> =
  | PlaceholderNames<TemplatesOf<Entry>>
  | (Entry extends string ? never : "count");

/** Los datos que pide un mensaje, deducidos de sus llaves. `count` elige la
 * forma plural, así que tiene que ser un número. */
export type EntryParams<Entry extends Message> = {
  readonly [Name in ParamNames<Entry>]: Name extends "count"
    ? number
    : string | number;
};

/** Los datos de una clave salen del catálogo inglés, que define las claves. */
export type MessageParams<Key extends MessageKey> = EntryParams<
  EnglishMessage<Key>
>;

type ParamsArgument<Key extends MessageKey> = [
  ParamNames<EnglishMessage<Key>>,
] extends [never]
  ? []
  : [params: MessageParams<Key>];

/** Lleva su idioma consigo para que quien arma los datos de un mensaje (una
 * fecha, por ejemplo) los escriba en el mismo idioma que la frase. */
export type Translator = {
  <Key extends MessageKey>(key: Key, ...params: ParamsArgument<Key>): string;
  readonly locale: Locale;
};

type ParamValues = Readonly<Record<string, string | number | undefined>>;

// Lo mismo que acepta `PlaceholderNames`: todo lo que haya hasta la primera
// llave de cierre. Si los dos leyeran distinto, un dato podría compilar y
// quedarse sin rellenar en pantalla.
const PLACEHOLDER = /\{([^}]*)\}/g;

function selectTemplate(
  plurals: Intl.PluralRules,
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
  return message[plurals.select(count)] ?? message.other;
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
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

/** Lo mismo en un componente de servidor que en uno de cliente: es una
 * función pura sobre catálogos estáticos. Un componente de cliente la llama
 * con el idioma que recibe como prop, porque la función devuelta no se puede
 * pasar del servidor al navegador. */
export function createTranslator(locale: Locale): Translator {
  const catalog: Readonly<Record<string, Message>> = messageCatalogs[locale];
  const plurals = new Intl.PluralRules(locale);

  const translate = <Key extends MessageKey>(
    key: Key,
    ...[params]: ParamsArgument<Key>
  ): string => {
    const message = catalog[key];
    if (message === undefined) {
      throw new RangeError(
        `No hay mensaje "${key}" en el catálogo "${locale}".`,
      );
    }
    const values: ParamValues = params ?? {};
    return insertParams(
      locale,
      selectTemplate(plurals, message, values),
      values,
    );
  };
  return Object.assign(translate, { locale });
}
