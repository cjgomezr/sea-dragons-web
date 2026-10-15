import type Stripe from "stripe";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type ProductArchiveSource,
  isProductOfKind,
  readDefaultUnitAmount,
  toCatalogProduct,
} from "@/lib/stripe/product-catalog";
import { readProductOptions } from "@/lib/stripe/product-options";
import { LEVY_KIND } from "./levies";
import type { ClubMemberRecord } from "./levy-payers";

/**
 * Qué se vendió de cada extra y a quién (#634, RF-8 del PRD de E23). El
 * resumen trae todos los extras en una llamada (D7): los que están a la venta
 * y los cerrados que vendieron algo (D5), con unidades y compradores, y sin
 * ninguna cifra de dinero agregada (D3). Los compradores son una fila por
 * compra, sin lista de faltantes (D1). Quién puede leerlo lo decide la
 * frontera (`RESTRICTED_ROUTES`), no este módulo.
 */

/** Un pago cobrado de un extra, en el club de quien llama. */
export type PaidLevyPayment = {
  readonly productId: string;
  readonly userId: string;
  readonly quantity: number;
  /** El total del pago, en centavos enteros (CON-005). */
  readonly amountCents: number;
  /** El nombre del extra cuando se compró: el webhook lo apunta así. */
  readonly description: string | null;
  readonly paidAt: string;
  /** La opción que eligió en Checkout (#637); nula si el extra no pedía. */
  readonly option: string | null;
};

export type LevyPaymentsGateway = {
  listClubLevyPayments(clubId: string): Promise<readonly PaidLevyPayment[]>;
  listProductPayments(request: {
    readonly clubId: string;
    readonly productId: string;
  }): Promise<readonly PaidLevyPayment[]>;
};

export type LevySalesGateways = {
  readonly clubMembers: {
    findMemberClubId(userId: string): Promise<string | null>;
  };
  readonly levyPayments: LevyPaymentsGateway;
  readonly stripe:
    | { readonly kind: "configured"; readonly products: ProductArchiveSource }
    | { readonly kind: "unconfigured" };
};

export type LevyBuyersGateways = {
  readonly clubMembers: {
    findMemberClubId(userId: string): Promise<string | null>;
    listClubMembers(clubId: string): Promise<readonly ClubMemberRecord[]>;
  };
  readonly levyPayments: LevyPaymentsGateway;
};

export type LevySaleStatus = "open" | "closed";

/** Las unidades vendidas de una opción del extra (#637). */
export type LevyOptionSales = {
  readonly option: string;
  readonly quantity: number;
};

export type LevySale = {
  readonly productId: string;
  /** Con él se compra; nulo si el extra ya no tiene un precio a la venta. */
  readonly priceId: string | null;
  readonly name: string;
  readonly description: string | null;
  /** El precio de una unidad, en centavos enteros. */
  readonly amountCents: number;
  readonly status: LevySaleStatus;
  /** La suma de las unidades de los pagos cobrados. */
  readonly soldQuantity: number;
  readonly buyerCount: number;
  /** En el orden de las opciones de Stripe; detrás, las que el comité ya
   * quitó. Vacío si ninguna compra trae opción. */
  readonly soldByOption: readonly LevyOptionSales[];
};

export type LevyBuyer = {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly quantity: number;
  readonly paidAt: string;
  /** Lo que se pagó en esa compra, en centavos. */
  readonly amountCents: number;
  readonly option: string | null;
};

export type LevySalesReading =
  | { readonly kind: "read"; readonly sales: readonly LevySale[] }
  | { readonly kind: "refused"; readonly reason: "stripe_not_configured" };

type ProductSales = {
  readonly soldQuantity: number;
  readonly buyerCount: number;
  /** Las unidades de cada opción elegida, sin orden. */
  readonly optionQuantities: ReadonlyMap<string, number>;
  /** De ahí salen el nombre y el precio de un extra borrado de Stripe. */
  readonly latestPayment: PaidLevyPayment;
};

async function readCallerClubId(
  clubMembers: LevySalesGateways["clubMembers"],
  callerId: string,
): Promise<string> {
  const clubId = await clubMembers.findMemberClubId(callerId);
  if (clubId === null) {
    throw new MemberNotFoundError(callerId);
  }
  return clubId;
}

function groupByProduct(
  payments: readonly PaidLevyPayment[],
): ReadonlyMap<string, readonly PaidLevyPayment[]> {
  const groups = new Map<string, PaidLevyPayment[]>();
  for (const payment of payments) {
    groups.set(payment.productId, [
      ...(groups.get(payment.productId) ?? []),
      payment,
    ]);
  }
  return groups;
}

function sumOptionQuantities(
  payments: readonly PaidLevyPayment[],
): ReadonlyMap<string, number> {
  const quantities = new Map<string, number>();
  for (const { option, quantity } of payments) {
    if (option !== null) {
      quantities.set(option, (quantities.get(option) ?? 0) + quantity);
    }
  }
  return quantities;
}

function summarizeSales(
  payments: readonly PaidLevyPayment[],
): ReadonlyMap<string, ProductSales> {
  const summaries = new Map<string, ProductSales>();
  for (const [productId, productPayments] of groupByProduct(payments)) {
    summaries.set(productId, {
      soldQuantity: productPayments.reduce(
        (total, { quantity }) => total + quantity,
        0,
      ),
      buyerCount: new Set(productPayments.map(({ userId }) => userId)).size,
      optionQuantities: sumOptionQuantities(productPayments),
      latestPayment: productPayments.reduce((latest, payment) =>
        payment.paidAt > latest.paidAt ? payment : latest,
      ),
    });
  }
  return summaries;
}

const NO_SALES: Omit<ProductSales, "latestPayment"> = {
  soldQuantity: 0,
  buyerCount: 0,
  optionQuantities: new Map(),
};

/** Las opciones que hoy ofrece el producto van primero y en su orden; las
 * que el comité quitó después de venderlas, detrás y por orden alfabético. */
function listSoldByOption(
  optionQuantities: ReadonlyMap<string, number>,
  product: Stripe.Product | undefined,
): readonly LevyOptionSales[] {
  const offered =
    product === undefined
      ? []
      : (readProductOptions(product.metadata)?.values ?? []);
  const sold = [...optionQuantities.keys()];
  const ordered = [
    ...offered.filter((option) => optionQuantities.has(option)),
    ...sold.filter((option) => !offered.includes(option)).sort(),
  ];
  return ordered.map((option) => ({
    option,
    quantity: optionQuantities.get(option) ?? 0,
  }));
}

/** Lo que costaba una unidad según el último pago, para el extra que Stripe
 * ya no conoce. */
function unitAmountOf(payment: PaidLevyPayment): number {
  return Math.round(payment.amountCents / payment.quantity);
}

function toOpenSale(
  product: Stripe.Product,
  sales?: ProductSales,
): LevySale | null {
  const offered = toCatalogProduct(product, LEVY_KIND);
  if (offered === null) {
    return null;
  }
  return {
    productId: offered.productId,
    priceId: offered.priceId,
    name: offered.name,
    description: offered.description,
    amountCents: offered.amountCents,
    status: "open",
    soldQuantity: (sales ?? NO_SALES).soldQuantity,
    buyerCount: (sales ?? NO_SALES).buyerCount,
    soldByOption: listSoldByOption(
      (sales ?? NO_SALES).optionQuantities,
      product,
    ),
  };
}

function toClosedSale(
  productId: string,
  sales: ProductSales,
  product: Stripe.Product | undefined,
): LevySale {
  const { latestPayment } = sales;
  return {
    productId,
    priceId: null,
    name: product?.name ?? latestPayment.description ?? productId,
    description: product === undefined ? null : product.description,
    amountCents:
      (product === undefined ? null : readDefaultUnitAmount(product)) ??
      unitAmountOf(latestPayment),
    status: "closed",
    soldQuantity: sales.soldQuantity,
    buyerCount: sales.buyerCount,
    soldByOption: listSoldByOption(sales.optionQuantities, product),
  };
}

function byLatestSale(
  [, first]: readonly [string, ProductSales],
  [, second]: readonly [string, ProductSales],
): number {
  return second.latestPayment.paidAt.localeCompare(first.latestPayment.paidAt);
}

/** Los abiertos en el orden de Stripe; detrás, los cerrados con ventas, del
 * de venta más reciente al más antiguo. Un producto de otra clase no sale
 * aunque tenga pagos. */
function listSales(
  products: readonly Stripe.Product[],
  salesByProduct: ReadonlyMap<string, ProductSales>,
): readonly LevySale[] {
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );
  const open = products.flatMap((product) => {
    const sale = toOpenSale(product, salesByProduct.get(product.id));
    return sale === null ? [] : [sale];
  });
  const openIds = new Set(open.map(({ productId }) => productId));
  const closed = [...salesByProduct]
    .filter(([productId]) => !openIds.has(productId))
    .filter(([productId]) => {
      const product = productsById.get(productId);
      return product === undefined || isProductOfKind(product, LEVY_KIND);
    })
    .sort(byLatestSale)
    .map(([productId, sales]) =>
      toClosedSale(productId, sales, productsById.get(productId)),
    );
  return [...open, ...closed];
}

export async function readLevySales(
  gateways: LevySalesGateways,
  request: { readonly callerId: string },
): Promise<LevySalesReading> {
  const { stripe } = gateways;
  if (stripe.kind === "unconfigured") {
    return { kind: "refused", reason: "stripe_not_configured" };
  }
  const clubId = await readCallerClubId(gateways.clubMembers, request.callerId);
  const [products, payments] = await Promise.all([
    stripe.products.listProducts(),
    gateways.levyPayments.listClubLevyPayments(clubId),
  ]);
  return { kind: "read", sales: listSales(products, summarizeSales(payments)) };
}

function byLatestPurchase(first: LevyBuyer, second: LevyBuyer): number {
  return second.paidAt.localeCompare(first.paidAt);
}

export async function readLevyBuyers(
  gateways: LevyBuyersGateways,
  request: { readonly callerId: string; readonly productId: string },
): Promise<readonly LevyBuyer[]> {
  const clubId = await readCallerClubId(gateways.clubMembers, request.callerId);
  const [members, payments] = await Promise.all([
    gateways.clubMembers.listClubMembers(clubId),
    gateways.levyPayments.listProductPayments({
      clubId,
      productId: request.productId,
    }),
  ]);
  const membersById = new Map(members.map((member) => [member.userId, member]));
  // Sólo las compras de quien tiene ficha: es defensivo, porque borrar la
  // ficha ya borra sus pagos (`payments_member_same_club_fkey`, `0050`).
  return payments
    .flatMap(({ userId, quantity, paidAt, amountCents, option }) => {
      const buyer = membersById.get(userId);
      return buyer === undefined
        ? []
        : [
            {
              userId,
              fullName: buyer.fullName,
              email: buyer.email,
              quantity,
              paidAt,
              amountCents,
              option,
            },
          ];
    })
    .sort(byLatestPurchase);
}
