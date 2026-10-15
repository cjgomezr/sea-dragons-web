// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  OPTION_CUSTOM_FIELD_KEY,
  readChosenOption,
  readProductOptions,
  toOptionCustomField,
} from "@/lib/stripe/product-options";

/**
 * La opción que un extra pide al comprarlo (#637, RF-11 y D13 del PRD de
 * E23): cómo se leen las opciones de los metadatos del producto, cómo se
 * piden en Checkout y cómo se lee la que eligió el socio.
 */

const STRIPE_MAX_DROPDOWN_OPTIONS = 200;

function chosenField(
  value: string | null,
  key: string = OPTION_CUSTOM_FIELD_KEY,
): Stripe.Checkout.Session.CustomField {
  return {
    key,
    type: "dropdown",
    optional: false,
    label: { type: "custom", custom: "Size" },
    dropdown: {
      default_value: null,
      options: [
        { label: "S", value: "option1" },
        { label: "M", value: "option2" },
      ],
      value,
    },
  } as Stripe.Checkout.Session.CustomField;
}

describe("readProductOptions", () => {
  it("lee las opciones en el orden en que el comité las escribió", () => {
    const options = readProductOptions({ seadragons_options: "S,M,L,XL" });

    expect(options).toEqual({
      label: "Size",
      values: ["S", "M", "L", "XL"],
    });
  });

  it("quita los espacios y descarta las vacías y las repetidas", () => {
    const options = readProductOptions({ seadragons_options: " S, ,M,S" });

    expect(options?.values).toEqual(["S", "M"]);
  });

  it("no pide opción si no queda ninguna", () => {
    expect(readProductOptions({ seadragons_options: " , ," })).toBeNull();
  });

  it("no pide opción a un producto sin seadragons_options", () => {
    expect(readProductOptions({ seadragons_kind: "levy" })).toBeNull();
  });

  it("se queda con las 200 primeras, el límite de Stripe", () => {
    const many = Array.from({ length: 205 }, (_, index) => `T${index + 1}`);

    const options = readProductOptions({ seadragons_options: many.join(",") });

    expect(options?.values).toHaveLength(STRIPE_MAX_DROPDOWN_OPTIONS);
    expect(options?.values.at(-1)).toBe("T200");
  });

  it("usa la etiqueta de seadragons_option_label si la hay", () => {
    const options = readProductOptions({
      seadragons_options: "Red,Blue",
      seadragons_option_label: " Colour ",
    });

    expect(options?.label).toBe("Colour");
  });

  it("recorta la etiqueta a los 50 caracteres que admite Stripe", () => {
    const options = readProductOptions({
      seadragons_options: "S",
      seadragons_option_label: "x".repeat(60),
    });

    expect(options?.label).toHaveLength(50);
  });

  it("usa Size si la etiqueta está en blanco", () => {
    const options = readProductOptions({
      seadragons_options: "S",
      seadragons_option_label: "  ",
    });

    expect(options?.label).toBe("Size");
  });
});

describe("toOptionCustomField", () => {
  it("pide un desplegable obligatorio con las opciones en su orden", () => {
    const field = toOptionCustomField({ label: "Size", values: ["S", "M"] });

    expect(field).toEqual({
      key: OPTION_CUSTOM_FIELD_KEY,
      type: "dropdown",
      optional: false,
      label: { type: "custom", custom: "Size" },
      dropdown: {
        options: [
          { label: "S", value: "option1" },
          { label: "M", value: "option2" },
        ],
      },
    });
  });
});

describe("readChosenOption", () => {
  it("devuelve el texto de la opción elegida, no su valor interno", () => {
    expect(readChosenOption([chosenField("option2")])).toBe("M");
  });

  it("es nula si la sesión no pidió opción", () => {
    expect(readChosenOption([])).toBeNull();
  });

  it("es nula si el desplegable llegó sin elegir", () => {
    expect(readChosenOption([chosenField(null)])).toBeNull();
  });

  it("ignora un campo que no es el de la opción", () => {
    expect(readChosenOption([chosenField("option1", "other")])).toBeNull();
  });
});
