import { PaymentsScreen } from "@/components/payments/PaymentsScreen";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { readCallerMembershipView } from "@/lib/membership/caller-membership";
import {
  CHECKOUT_RETURN_QUERY_PARAM,
  readCheckoutReturn,
} from "@/lib/membership/checkout-return";

/** Pagos (#454): el alta en Stripe Checkout para quien no ha puesto tarjeta y
 * la espera del webhook al volver. Es a donde la frontera lleva a quien no
 * tiene la membresía al día (#453). La membresía se lee al pintar, para que
 * la pantalla llegue ya con su estado; #455 completa el panel.
 *
 * `?checkout=ok` o `?checkout=cancelado` es con lo que vuelve de Stripe. */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, view, params] = await Promise.all([
    readRequestLocale(),
    readCallerMembershipView(),
    searchParams,
  ]);
  return (
    <PaymentsScreen
      locale={locale}
      initialView={view}
      checkoutReturn={readCheckoutReturn(params[CHECKOUT_RETURN_QUERY_PARAM])}
    />
  );
}
