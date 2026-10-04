/** Las marcas como las escribe Stripe y como se leen. Una que no está aquí
 * se escribe con mayúscula inicial. */
const CARD_BRAND_NAMES: Readonly<Record<string, string>> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

export function formatCardBrand(brand: string): string {
  return (
    CARD_BRAND_NAMES[brand] ??
    `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`
  );
}
