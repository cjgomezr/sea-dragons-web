import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import {
  CARD_RETURN_QUERY_PARAM,
  CHECKOUT_RETURN_QUERY_PARAM,
  PACK_RETURN_QUERY_PARAM,
  readCheckoutReturn,
} from "@/lib/membership/checkout-return";

/** Pagos (#454, #455): el panel de la membresía, el alta en Stripe Checkout
 * y el cambio de tarjeta. Es a donde la frontera lleva a quien no tiene la
 * membresía al día (#453). La pantalla pide la membresía al endpoint, como
 * la aplicación nativa (CON-002).
 *
 * `?checkout=`, `?tarjeta=` y `?pack=` (`ok` o `cancelado`) es con lo que se
 * vuelve de Stripe tras suscribirse, cambiar la tarjeta o comprar un pack. */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, params] = await Promise.all([
    readRequestLocale(),
    searchParams,
  ]);
  return (
    <PaymentsScreen
      locale={locale}
      checkoutReturn={readCheckoutReturn(params[CHECKOUT_RETURN_QUERY_PARAM])}
      cardReturn={readCheckoutReturn(params[CARD_RETURN_QUERY_PARAM])}
      packReturn={readCheckoutReturn(params[PACK_RETURN_QUERY_PARAM])}
    />
  );
}
