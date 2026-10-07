import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  type ProductCatalogSource,
  listActiveProductsOfKind,
} from "@/lib/stripe/product-catalog";
import { LEVY_KIND } from "./levies";
import type { PaymentStatus } from "./membership-view";

/**
 * Quién pagó cada levy y quién falta (#531, ampliación de FR-069): lo que
 * Admin y Committee miraban en el panel de Stripe cruzando correos a mano.
 * Stripe no sabe quién es socio; la base sí, y guarda cada pago con su
 * producto (`payments.stripe_product_id`, `0060`).
 *
 * "Pagaron" es quien tiene un pago `paid` del producto, con la cuenta como
 * esté: el pago existió aunque luego lo desactivaran. "Faltan" son los socios
 * con la cuenta activa que no lo tienen. Quién puede leerlo lo decide la
 * frontera (`RESTRICTED_ROUTES`), no este módulo.
 */

export type ClubMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: AccountStatus;
};

export type LevyPaymentRecord = {
  readonly userId: string;
  /** Centavos enteros (CON-005). */
  readonly amountCents: number;
  readonly status: PaymentStatus;
  readonly paidAt: string;
};

export type LevyPayersGateways = {
  readonly clubMembers: {
    findMemberClubId(userId: string): Promise<string | null>;
    listClubMembers(clubId: string): Promise<readonly ClubMemberRecord[]>;
  };
  readonly levyPayments: {
    listLevyPayments(request: {
      readonly clubId: string;
      readonly productId: string;
    }): Promise<readonly LevyPaymentRecord[]>;
  };
  readonly stripe:
    | { readonly kind: "configured"; readonly catalog: ProductCatalogSource }
    | { readonly kind: "unconfigured" };
};

export type LevyPayer = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  /** El último pago, si pagó más de una vez. */
  readonly paidAt: string;
  /** Lo que pagó en total, en centavos. */
  readonly amountCents: number;
};

export type LevyMissingMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
};

export type LevyPayersReport = {
  readonly levy: {
    /** El id del `Price` de Stripe, como en la lista de levies. */
    readonly id: string;
    readonly name: string;
    readonly amountCents: number;
  };
  readonly summary: {
    readonly paidCount: number;
    readonly missingCount: number;
    readonly collectedCents: number;
  };
  /** Del pago más reciente al más antiguo. */
  readonly payers: readonly LevyPayer[];
  /** Por nombre. */
  readonly missing: readonly LevyMissingMember[];
};

export type LevyPayersRefusal = "stripe_not_configured" | "levy_not_found";

export type LevyPayersReading =
  | { readonly kind: "read"; readonly report: LevyPayersReport }
  | { readonly kind: "refused"; readonly reason: LevyPayersRefusal };

export type LevyPayersRequest = {
  readonly callerId: string;
  readonly priceId: string;
};

type PaidTotal = { readonly paidAt: string; readonly amountCents: number };

/** Un socio que pagó dos veces (dos pestañas de Checkout a la vez) es una
 * fila: con la fecha del último pago y la suma de lo que pagó, que es lo que
 * Stripe cobró. */
function totalPaidByMember(
  payments: readonly LevyPaymentRecord[],
): ReadonlyMap<string, PaidTotal> {
  const totals = new Map<string, PaidTotal>();
  for (const payment of payments) {
    if (payment.status !== "paid") {
      continue;
    }
    const previous = totals.get(payment.userId);
    totals.set(payment.userId, {
      paidAt:
        previous !== undefined && previous.paidAt > payment.paidAt
          ? previous.paidAt
          : payment.paidAt,
      amountCents: (previous?.amountCents ?? 0) + payment.amountCents,
    });
  }
  return totals;
}

function byFullName(
  first: LevyMissingMember,
  second: LevyMissingMember,
): number {
  return first.fullName.localeCompare(second.fullName);
}

function byLatestPayment(first: LevyPayer, second: LevyPayer): number {
  return second.paidAt.localeCompare(first.paidAt);
}

function splitMembers(
  members: readonly ClubMemberRecord[],
  totals: ReadonlyMap<string, PaidTotal>,
): Pick<LevyPayersReport, "payers" | "missing"> {
  const payers: LevyPayer[] = [];
  const missing: LevyMissingMember[] = [];
  for (const { userId, fullName, email, status } of members) {
    const paid = totals.get(userId);
    if (paid !== undefined) {
      payers.push({ userId, fullName, email, ...paid });
    } else if (status === "active") {
      missing.push({ userId, fullName, email });
    }
  }
  return {
    payers: payers.sort(byLatestPayment),
    missing: missing.sort(byFullName),
  };
}

async function readCallerClubId(
  gateways: LevyPayersGateways,
  callerId: string,
): Promise<string> {
  const clubId = await gateways.clubMembers.findMemberClubId(callerId);
  if (clubId === null) {
    throw new MemberNotFoundError(callerId);
  }
  return clubId;
}

export async function readLevyPayers(
  gateways: LevyPayersGateways,
  request: LevyPayersRequest,
): Promise<LevyPayersReading> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const [levies, clubId] = await Promise.all([
    listActiveProductsOfKind(stripe.catalog, LEVY_KIND),
    readCallerClubId(gateways, request.callerId),
  ]);
  const levy = levies.find(({ priceId }) => priceId === request.priceId);
  if (levy === undefined) {
    return { kind: "refused", reason: "levy_not_found" };
  }
  const [members, payments] = await Promise.all([
    gateways.clubMembers.listClubMembers(clubId),
    gateways.levyPayments.listLevyPayments({
      clubId,
      productId: levy.productId,
    }),
  ]);
  // Un pago de alguien que ya no tiene ficha no tiene a quién nombrar: no
  // sale en la lista ni en el total, para que el total sea la suma de la
  // lista.
  const { payers, missing } = splitMembers(
    members,
    totalPaidByMember(payments),
  );
  return {
    kind: "read",
    report: {
      levy: {
        id: levy.priceId,
        name: levy.name,
        amountCents: levy.amountCents,
      },
      summary: {
        paidCount: payers.length,
        missingCount: missing.length,
        collectedCents: payers.reduce(
          (total, payer) => total + payer.amountCents,
          0,
        ),
      },
      payers,
      missing,
    },
  };
}
