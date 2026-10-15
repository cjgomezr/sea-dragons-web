// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { ClubMemberRecord } from "@/lib/membership/levy-payers";
import {
  type LevyBuyersGateways,
  type LevySale,
  type LevySalesGateways,
  type PaidLevyPayment,
  readLevyBuyers,
  readLevySales,
} from "@/lib/membership/levy-sales";

/**
 * El resumen de ventas de los extras y sus compradores (#634, RF-8 del PRD
 * de E23, D1, D3, D5 y D7). Stripe y la base van doblados: lo que se prueba es
 * qué extra sale, abierto o cerrado, cuántas unidades y compradores lleva, y
 * que cada compra es una fila.
 */

const CALLER_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";

type ProductShape = {
  readonly id: string;
  readonly name: string;
  readonly active?: boolean;
  readonly priceId?: string;
  readonly priceActive?: boolean;
  readonly unitAmount?: number;
  readonly kind?: string;
  readonly options?: string;
};

function product(shape: ProductShape): Stripe.Product {
  return {
    id: shape.id,
    object: "product",
    name: shape.name,
    description: `${shape.name}, descripción`,
    active: shape.active ?? true,
    metadata: {
      seadragons_kind: shape.kind ?? "levy",
      ...(shape.options === undefined
        ? {}
        : { seadragons_options: shape.options }),
    },
    default_price: {
      id: shape.priceId ?? `price_${shape.id}`,
      object: "price",
      active: shape.priceActive ?? true,
      type: "one_time",
      currency: "aud",
      unit_amount: shape.unitAmount ?? 4500,
    },
  } as unknown as Stripe.Product;
}

const HOODIE = product({ id: "prod_hoodie", name: "Hoodie", unitAmount: 6000 });
const DINNER = product({ id: "prod_dinner", name: "Cena", unitAmount: 3500 });
const NATIONALS = product({
  id: "prod_nationals",
  name: "Nationals 2026",
  active: false,
  priceActive: false,
  unitAmount: 8000,
});
const OLD_CAP = product({ id: "prod_cap", name: "Gorra", active: false });
const MEMBERSHIP = product({ id: "prod_full", name: "Full", kind: "plan" });

function payment(
  productId: string,
  userId: string,
  shape: Partial<PaidLevyPayment> = {},
): PaidLevyPayment {
  return {
    productId,
    userId,
    quantity: 1,
    amountCents: 6000,
    description: null,
    paidAt: "2026-10-01T10:00:00.000Z",
    option: null,
    ...shape,
  };
}

type SalesFakes = {
  readonly products?: readonly Stripe.Product[];
  readonly payments?: readonly PaidLevyPayment[];
  readonly callerClubId?: string | null;
  readonly isStripeConfigured?: boolean;
  readonly listProducts?: () => Promise<readonly Stripe.Product[]>;
};

function salesGateways(fakes: SalesFakes = {}): LevySalesGateways {
  return {
    clubMembers: {
      findMemberClubId: async () =>
        fakes.callerClubId === undefined ? CLUB_ID : fakes.callerClubId,
    },
    levyPayments: {
      listClubLevyPayments: async () => fakes.payments ?? [],
      listProductPayments: async () => [],
    },
    stripe:
      fakes.isStripeConfigured === false
        ? { kind: "unconfigured" }
        : {
            kind: "configured",
            products: {
              listProducts:
                fakes.listProducts ??
                (async () =>
                  fakes.products ?? [
                    HOODIE,
                    DINNER,
                    NATIONALS,
                    OLD_CAP,
                    MEMBERSHIP,
                  ]),
            },
          },
  };
}

async function readSales(fakes: SalesFakes = {}): Promise<readonly LevySale[]> {
  const reading = await readLevySales(salesGateways(fakes), {
    callerId: CALLER_ID,
  });
  if (reading.kind !== "read") {
    throw new Error(`se esperaba el resumen y llegó ${reading.reason}`);
  }
  return reading.sales;
}

describe("readLevySales", () => {
  it("da cada extra a la venta con su precio, aunque no tenga ventas", async () => {
    const sales = await readSales();

    expect(sales.slice(0, 2)).toEqual([
      {
        productId: "prod_hoodie",
        priceId: "price_prod_hoodie",
        name: "Hoodie",
        description: "Hoodie, descripción",
        amountCents: 6000,
        status: "open",
        soldQuantity: 0,
        buyerCount: 0,
        soldByOption: [],
      },
      {
        productId: "prod_dinner",
        priceId: "price_prod_dinner",
        name: "Cena",
        description: "Cena, descripción",
        amountCents: 3500,
        status: "open",
        soldQuantity: 0,
        buyerCount: 0,
        soldByOption: [],
      },
    ]);
  });

  it("suma las unidades de los pagos y cuenta los compradores distintos", async () => {
    const sales = await readSales({
      payments: [
        payment("prod_hoodie", "alba", { quantity: 2 }),
        payment("prod_hoodie", "alba", { quantity: 1 }),
        payment("prod_hoodie", "bruno", { quantity: 3 }),
      ],
    });

    expect(sales[0]).toMatchObject({ soldQuantity: 6, buyerCount: 2 });
  });

  it("da las unidades vendidas de cada opción en el orden de Stripe (#637)", async () => {
    const jersey = product({
      id: "prod_jersey",
      name: "Jersey",
      options: "S,M,L",
    });

    const sales = await readSales({
      products: [jersey],
      payments: [
        payment("prod_jersey", "alba", { quantity: 2, option: "M" }),
        payment("prod_jersey", "bruno", { quantity: 1, option: "S" }),
        payment("prod_jersey", "carla", { quantity: 3, option: "M" }),
      ],
    });

    expect(sales[0]?.soldByOption).toEqual([
      { option: "S", quantity: 1 },
      { option: "M", quantity: 5 },
    ]);
  });

  it("conserva detrás las opciones que el comité ya quitó de la lista (#637)", async () => {
    const jersey = product({ id: "prod_jersey", name: "Jersey", options: "M" });

    const sales = await readSales({
      products: [jersey],
      payments: [
        payment("prod_jersey", "alba", { option: "XS" }),
        payment("prod_jersey", "bruno", { option: "M" }),
      ],
    });

    expect(sales[0]?.soldByOption).toEqual([
      { option: "M", quantity: 1 },
      { option: "XS", quantity: 1 },
    ]);
  });

  it("no da desglose de las compras sin opción (#637)", async () => {
    const sales = await readSales({
      payments: [payment("prod_hoodie", "alba", { quantity: 2 })],
    });

    expect(sales[0]?.soldByOption).toEqual([]);
  });

  it("no lleva ninguna cifra de dinero agregada (D3)", async () => {
    const sales = await readSales({
      payments: [payment("prod_hoodie", "alba", { quantity: 2 })],
    });

    const [hoodie] = sales;

    expect(Object.keys(hoodie ?? {}).sort()).toEqual([
      "amountCents",
      "buyerCount",
      "description",
      "name",
      "priceId",
      "productId",
      "soldByOption",
      "soldQuantity",
      "status",
    ]);
    // El precio de una unidad, no lo cobrado por las dos.
    expect(hoodie?.amountCents).toBe(6000);
  });

  it("da un extra archivado con ventas como cerrado, con su nombre en Stripe y sin precio activo", async () => {
    const sales = await readSales({
      payments: [
        payment("prod_nationals", "alba", { description: "Nationals viejo" }),
      ],
    });

    expect(
      sales.find(({ productId }) => productId === "prod_nationals"),
    ).toEqual({
      productId: "prod_nationals",
      priceId: null,
      name: "Nationals 2026",
      description: "Nationals 2026, descripción",
      amountCents: 8000,
      status: "closed",
      soldQuantity: 1,
      buyerCount: 1,
      soldByOption: [],
    });
  });

  it("no da un extra cerrado sin ventas", async () => {
    const sales = await readSales();

    expect(sales.map(({ productId }) => productId)).toEqual([
      "prod_hoodie",
      "prod_dinner",
    ]);
  });

  it("da un extra borrado de Stripe con la descripción y el precio del último pago", async () => {
    const sales = await readSales({
      payments: [
        payment("prod_gone", "alba", {
          description: "Camiseta 2024",
          amountCents: 5000,
          quantity: 2,
          paidAt: "2026-09-01T10:00:00.000Z",
        }),
        payment("prod_gone", "bruno", {
          description: "Camiseta 2025",
          amountCents: 3000,
          paidAt: "2026-09-20T10:00:00.000Z",
        }),
      ],
    });

    expect(sales.find(({ productId }) => productId === "prod_gone")).toEqual({
      productId: "prod_gone",
      priceId: null,
      name: "Camiseta 2025",
      description: null,
      amountCents: 3000,
      status: "closed",
      soldQuantity: 3,
      buyerCount: 2,
      soldByOption: [],
    });
  });

  it("pone los abiertos primero y los cerrados del de venta más reciente al más antiguo", async () => {
    const sales = await readSales({
      payments: [
        payment("prod_cap", "alba", { paidAt: "2026-08-01T10:00:00.000Z" }),
        payment("prod_nationals", "alba", {
          paidAt: "2026-09-01T10:00:00.000Z",
        }),
      ],
    });

    expect(sales.map(({ productId, status }) => [productId, status])).toEqual([
      ["prod_hoodie", "open"],
      ["prod_dinner", "open"],
      ["prod_nationals", "closed"],
      ["prod_cap", "closed"],
    ]);
  });

  it("no da productos de otra clase aunque tengan pagos", async () => {
    const sales = await readSales({
      payments: [payment("prod_full", "alba")],
    });

    expect(sales.map(({ productId }) => productId)).not.toContain("prod_full");
  });

  it("lee el catálogo de Stripe una sola vez por petición", async () => {
    const listProducts = vi.fn(async () => [HOODIE, NATIONALS]);

    await readSales({
      listProducts,
      payments: [payment("prod_nationals", "alba")],
    });

    expect(listProducts).toHaveBeenCalledTimes(1);
  });

  it("rechaza con stripe_not_configured cuando falta Stripe", async () => {
    const reading = await readLevySales(
      salesGateways({ isStripeConfigured: false }),
      { callerId: CALLER_ID },
    );

    expect(reading).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
  });

  it("lanza cuando quien llama no tiene ficha de socio", async () => {
    await expect(
      readLevySales(salesGateways({ callerClubId: null }), {
        callerId: CALLER_ID,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

function member(userId: string, fullName: string): ClubMemberRecord {
  return {
    userId,
    fullName,
    email: `${userId}@club.test`,
    status: "active",
  };
}

const ALBA = member("alba", "Alba Ruiz");
const BRUNO = member("bruno", "Bruno Díaz");

type BuyersFakes = {
  readonly payments?: readonly PaidLevyPayment[];
  readonly callerClubId?: string | null;
};

function buyersGateways(fakes: BuyersFakes = {}): LevyBuyersGateways {
  return {
    clubMembers: {
      findMemberClubId: async () =>
        fakes.callerClubId === undefined ? CLUB_ID : fakes.callerClubId,
      listClubMembers: async () => [ALBA, BRUNO],
    },
    levyPayments: {
      listClubLevyPayments: async () => [],
      listProductPayments: async () => fakes.payments ?? [],
    },
  };
}

describe("readLevyBuyers", () => {
  it("da una fila por compra con su opción, de la más reciente a la más antigua", async () => {
    const buyers = await readLevyBuyers(
      buyersGateways({
        payments: [
          payment("prod_hoodie", "alba", {
            quantity: 2,
            amountCents: 12000,
            paidAt: "2026-10-01T10:00:00.000Z",
            option: "M",
          }),
          payment("prod_hoodie", "bruno", {
            paidAt: "2026-10-03T10:00:00.000Z",
          }),
        ],
      }),
      { callerId: CALLER_ID, productId: "prod_hoodie" },
    );

    expect(buyers).toEqual([
      {
        userId: "bruno",
        fullName: "Bruno Díaz",
        email: "bruno@club.test",
        quantity: 1,
        paidAt: "2026-10-03T10:00:00.000Z",
        amountCents: 6000,
        option: null,
      },
      {
        userId: "alba",
        fullName: "Alba Ruiz",
        email: "alba@club.test",
        quantity: 2,
        paidAt: "2026-10-01T10:00:00.000Z",
        amountCents: 12000,
        option: "M",
      },
    ]);
  });

  it("da dos filas a quien compró el mismo extra dos veces", async () => {
    const buyers = await readLevyBuyers(
      buyersGateways({
        payments: [
          payment("prod_hoodie", "alba", {
            paidAt: "2026-10-01T10:00:00.000Z",
          }),
          payment("prod_hoodie", "alba", {
            paidAt: "2026-10-05T10:00:00.000Z",
          }),
        ],
      }),
      { callerId: CALLER_ID, productId: "prod_hoodie" },
    );

    expect(buyers.map(({ userId, paidAt }) => [userId, paidAt])).toEqual([
      ["alba", "2026-10-05T10:00:00.000Z"],
      ["alba", "2026-10-01T10:00:00.000Z"],
    ]);
  });

  it("no da la compra de quien ya no tiene ficha", async () => {
    const buyers = await readLevyBuyers(
      buyersGateways({ payments: [payment("prod_hoodie", "nadie")] }),
      { callerId: CALLER_ID, productId: "prod_hoodie" },
    );

    expect(buyers).toEqual([]);
  });

  it("lanza cuando quien llama no tiene ficha de socio", async () => {
    await expect(
      readLevyBuyers(buyersGateways({ callerClubId: null }), {
        callerId: CALLER_ID,
        productId: "prod_hoodie",
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
