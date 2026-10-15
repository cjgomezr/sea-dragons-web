import type Stripe from "stripe";

/**
 * La opción que un extra pide al comprarlo, como la talla de una camiseta
 * (#637, RF-11 y D13 del PRD de E23). El comité la escribe en Stripe en
 * `metadata.seadragons_options` (`S,M,L,XL`); Checkout la pide con un
 * desplegable obligatorio (`custom_fields`) y el webhook lee la elegida. Puro:
 * quién habla con Stripe es de `stripe-client.ts`.
 */

/** Las opciones, separadas por comas, en el orden en que se enseñan. */
export const OPTIONS_METADATA_KEY = "seadragons_options";

/** El texto del desplegable. Stripe enseña uno solo, sin idiomas (D13). */
export const OPTION_LABEL_METADATA_KEY = "seadragons_option_label";

/** El campo de la sesión con la opción. Stripe lo quiere alfanumérico. */
export const OPTION_CUSTOM_FIELD_KEY = "seadragonsoption";

const DEFAULT_OPTION_LABEL = "Size";
const OPTIONS_SEPARATOR = ",";

/** Los límites de Stripe para un desplegable de Checkout. */
const STRIPE_MAX_LABEL_LENGTH = 50;
const STRIPE_MAX_DROPDOWN_OPTIONS = 200;

/** Stripe pide un valor alfanumérico por opción; el texto puede ser
 * cualquiera, así que el valor es su posición y el webhook lo traduce. */
const OPTION_VALUE_PREFIX = "option";

export type ProductOptions = {
  readonly label: string;
  /** Sin vacías ni repetidas, de 1 a 200. */
  readonly values: readonly string[];
};

function readOptionLabel(metadata: Stripe.Metadata): string {
  const label = (metadata[OPTION_LABEL_METADATA_KEY] ?? "").trim();
  return label === ""
    ? DEFAULT_OPTION_LABEL
    : label.slice(0, STRIPE_MAX_LABEL_LENGTH);
}

/** Un valor mal escrito en el panel de Stripe no puede romper la venta: lo
 * que no es una opción se descarta y, si no queda ninguna, el extra se vende
 * sin desplegable. */
export function readProductOptions(
  metadata: Stripe.Metadata,
): ProductOptions | null {
  const raw = metadata[OPTIONS_METADATA_KEY] ?? "";
  const values = [
    ...new Set(
      raw
        .split(OPTIONS_SEPARATOR)
        .map((value) => value.trim())
        .filter((value) => value !== ""),
    ),
  ].slice(0, STRIPE_MAX_DROPDOWN_OPTIONS);
  return values.length === 0
    ? null
    : { label: readOptionLabel(metadata), values };
}

function optionValueAt(index: number): string {
  return `${OPTION_VALUE_PREFIX}${index + 1}`;
}

export function toOptionCustomField(
  options: ProductOptions,
): Stripe.Checkout.SessionCreateParams.CustomField {
  return {
    key: OPTION_CUSTOM_FIELD_KEY,
    type: "dropdown",
    optional: false,
    label: { type: "custom", custom: options.label },
    dropdown: {
      options: options.values.map((label, index) => ({
        label,
        value: optionValueAt(index),
      })),
    },
  };
}

/** El texto que vio el socio, tal como lo trae la sesión: si el comité
 * cambia las opciones después, la compra conserva la que eligió. */
export function readChosenOption(
  customFields: readonly Stripe.Checkout.Session.CustomField[],
): string | null {
  const field = customFields.find(({ key }) => key === OPTION_CUSTOM_FIELD_KEY);
  const dropdown = field?.dropdown;
  if (dropdown === undefined || dropdown === null || dropdown.value === null) {
    return null;
  }
  const chosen = dropdown.options.find(({ value }) => value === dropdown.value);
  return chosen === undefined ? null : chosen.label;
}
