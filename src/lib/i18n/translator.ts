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

/** El nombre del registro del club (#967): lo pone el traductor, que lo
 * recibe al crearse, así que ninguna llamada lo pide. */
const REGISTRATION_PARAM = "registration";
type TranslatorProvidedParam = typeof REGISTRATION_PARAM;

/** La palabra de la app cuando el club no le pone nombre a su registro (D12
 * del PRD de E37): "Registration" / "Registro". */
const DEFAULT_REGISTRATION_KEY = "registration.defaultName";

/** Un plural pide `count` aunque ninguna de sus formas lo escriba
 * ("One minute left"): sin él no hay forma que elegir. */
type ParamNames<Entry> =
  | Exclude<PlaceholderNames<TemplatesOf<Entry>>, TranslatorProvidedParam>
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

export type TranslatorOptions = {
  /** El nombre del registro del club (#967). Nulo o ausente es la palabra
   * de la app. */
  readonly registrationName?: string | null;
};

function readDefaultRegistration(
  catalog: Readonly<Record<string, Message>>,
): string {
  const word = catalog[DEFAULT_REGISTRATION_KEY];
  if (typeof word !== "string") {
    throw new RangeError(
      `El catálogo no tiene la palabra "${DEFAULT_REGISTRATION_KEY}".`,
    );
  }
  return word;
}

/** Lo mismo en un componente de servidor que en uno de cliente: es una
 * función pura sobre catálogos estáticos. Un componente de cliente la llama
 * con el idioma que recibe como prop, porque la función devuelta no se puede
 * pasar del servidor al navegador. */
export function createTranslator(
  locale: Locale,
  options: TranslatorOptions = {},
): Translator {
  const catalog: Readonly<Record<string, Message>> = messageCatalogs[locale];
  const plurals = new Intl.PluralRules(locale);
  const registration =
    options.registrationName ?? readDefaultRegistration(catalog);

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
    const values: ParamValues = {
      ...params,
      [REGISTRATION_PARAM]: registration,
    };
    return insertParams(
      locale,
      selectTemplate(plurals, message, values),
      values,
    );
  };
  return Object.assign(translate, { locale });
}
