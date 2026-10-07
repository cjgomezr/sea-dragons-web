// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type ClubMemberRecord,
  type LevyPaymentRecord,
  type LevyPayersGateways,
  type LevyPayersReport,
  readLevyPayers,
} from "@/lib/membership/levy-payers";

/**
 * Quién pagó cada levy y quién falta (#531, ampliación de FR-069). Stripe y
 * la base van doblados: lo que se prueba es el reparto entre "Pagaron" y
 * "Faltan", qué pago cuenta y el resumen.
 */

const CALLER_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const NATIONALS_PRODUCT = "prod_nationals";
const NATIONALS_PRICE = "price_nationals";
const NATIONALS_CENTS = 8000;

const NATIONALS = {
  id: NATIONALS_PRODUCT,
  object: "product",
  name: "Nationals 2026",
  description: null,
  active: true,
  metadata: { seadragons_kind: "levy" },
  default_price: {
    id: NATIONALS_PRICE,
    object: "price",
    active: true,
    type: "one_time",
    currency: "aud",
    unit_amount: NATIONALS_CENTS,
  },
} as unknown as Stripe.Product;

const MEMBERSHIP = {
  ...NATIONALS,
  id: "prod_full",
  metadata: {},
  default_price: { id: "price_full", type: "recurring" },
} as unknown as Stripe.Product;

function member(
  userId: string,
  fullName: string,
  status: ClubMemberRecord["status"] = "active",
): ClubMemberRecord {
  return { userId, fullName, email: `${userId}@club.test`, status };
}

const ALBA = member("alba", "Alba Ruiz");
const BRUNO = member("bruno", "Bruno Díaz");
const CARLA = member("carla", "Carla Soto");
const DANI = member("dani", "Dani Vega");

function payment(
  userId: string,
  paidAt: string,
  shape: Partial<LevyPaymentRecord> = {},
): LevyPaymentRecord {
  return {
    userId,
    amountCents: NATIONALS_CENTS,
    status: "paid",
    paidAt,
    ...shape,
  };
}

type Fakes = {
  readonly members?: readonly ClubMemberRecord[];
  readonly payments?: readonly LevyPaymentRecord[];
  readonly callerClubId?: string | null;
  readonly isStripeConfigured?: boolean;
};

function gateways(fakes: Fakes = {}): LevyPayersGateways {
  return {
    clubMembers: {
      findMemberClubId: async () =>
        fakes.callerClubId === undefined ? CLUB_ID : fakes.callerClubId,
      listClubMembers: async () => fakes.members ?? [ALBA, BRUNO, CARLA],
    },
    levyPayments: {
      listLevyPayments: async () => fakes.payments ?? [],
    },
    stripe:
      fakes.isStripeConfigured === false
        ? { kind: "unconfigured" }
        : {
            kind: "configured",
            catalog: {
              listActiveProducts: async () => [NATIONALS, MEMBERSHIP],
            },
          },
  };
}

async function readReport(
  fakes: Fakes = {},
  priceId = NATIONALS_PRICE,
): Promise<LevyPayersReport> {
  const reading = await readLevyPayers(gateways(fakes), {
    callerId: CALLER_ID,
    priceId,
  });
  if (reading.kind !== "read") {
    throw new Error(`se esperaba la lista y llegó ${reading.reason}`);
  }
  return reading.report;
}

describe("readLevyPayers", () => {
  it("reparte a los socios entre los que pagaron y los que faltan", async () => {
    const report = await readReport({
      payments: [payment("bruno", "2026-10-02T10:00:00.000Z")],
    });

    expect(report.payers.map((payer) => payer.fullName)).toEqual([
      "Bruno Díaz",
    ]);
    expect(report.missing.map((missing) => missing.fullName)).toEqual([
      "Alba Ruiz",
      "Carla Soto",
    ]);
  });

  it("da de cada pagador su correo, la fecha y el importe", async () => {
    const report = await readReport({
      payments: [payment("bruno", "2026-10-02T10:00:00.000Z")],
    });

    expect(report.payers).toEqual([
      {
        userId: "bruno",
        fullName: "Bruno Díaz",
        email: "bruno@club.test",
        paidAt: "2026-10-02T10:00:00.000Z",
        amountCents: NATIONALS_CENTS,
      },
    ]);
  });

  it("ordena los pagos del más reciente al más antiguo", async () => {
    const report = await readReport({
      payments: [
        payment("alba", "2026-10-01T10:00:00.000Z"),
        payment("carla", "2026-10-05T10:00:00.000Z"),
        payment("bruno", "2026-10-03T10:00:00.000Z"),
      ],
    });

    expect(report.payers.map((payer) => payer.userId)).toEqual([
      "carla",
      "bruno",
      "alba",
    ]);
  });

  it("ordena a los que faltan por nombre", async () => {
    const report = await readReport({ members: [CARLA, ALBA, BRUNO] });

    expect(report.missing.map((missing) => missing.userId)).toEqual([
      "alba",
      "bruno",
      "carla",
    ]);
  });

  it.each(["failed", "pending"] as const)(
    "un pago %s no cuenta como pagado",
    async (status) => {
      const report = await readReport({
        payments: [payment("alba", "2026-10-01T10:00:00.000Z", { status })],
      });

      expect(report.payers).toEqual([]);
      expect(report.missing.map((missing) => missing.userId)).toContain("alba");
    },
  );

  it("deja en pagaron a un socio desactivado que pagó", async () => {
    const report = await readReport({
      members: [ALBA, member("dani", "Dani Vega", "inactive")],
      payments: [payment("dani", "2026-10-01T10:00:00.000Z")],
    });

    expect(report.payers.map((payer) => payer.userId)).toEqual(["dani"]);
    expect(report.missing.map((missing) => missing.userId)).toEqual(["alba"]);
  });

  it.each(["inactive", "incomplete"] as const)(
    "no pone en faltan a un socio con la cuenta %s que no pagó",
    async (status) => {
      const report = await readReport({
        members: [ALBA, member("dani", "Dani Vega", status)],
      });

      expect(report.missing.map((missing) => missing.userId)).toEqual(["alba"]);
    },
  );

  it("con un levy que nadie ha pagado, todos los activos faltan", async () => {
    const report = await readReport({ members: [ALBA, BRUNO, DANI] });

    expect(report.payers).toEqual([]);
    expect(report.summary).toEqual({
      paidCount: 0,
      missingCount: 3,
      collectedCents: 0,
    });
  });

  it("resume cuántos pagaron, cuántos faltan y el total cobrado", async () => {
    const report = await readReport({
      payments: [
        payment("alba", "2026-10-01T10:00:00.000Z"),
        payment("bruno", "2026-10-02T10:00:00.000Z", { amountCents: 7000 }),
        payment("carla", "2026-10-03T10:00:00.000Z", { status: "failed" }),
      ],
    });

    expect(report.summary).toEqual({
      paidCount: 2,
      missingCount: 1,
      collectedCents: 15000,
    });
  });

  it("junta en una fila los dos pagos de un mismo socio, con la fecha del último", async () => {
    const report = await readReport({
      payments: [
        payment("alba", "2026-10-01T10:00:00.000Z"),
        payment("alba", "2026-10-04T10:00:00.000Z"),
      ],
    });

    expect(report.payers).toEqual([
      expect.objectContaining({
        userId: "alba",
        paidAt: "2026-10-04T10:00:00.000Z",
        amountCents: 2 * NATIONALS_CENTS,
      }),
    ]);
    expect(report.summary.paidCount).toBe(1);
  });

  it("dice el levy con su nombre de Stripe y su importe", async () => {
    const report = await readReport();

    expect(report.levy).toEqual({
      id: NATIONALS_PRICE,
      name: "Nationals 2026",
      amountCents: NATIONALS_CENTS,
    });
  });

  it("rechaza un precio que no es de un levy activo", async () => {
    const reading = await readLevyPayers(gateways(), {
      callerId: CALLER_ID,
      priceId: "price_full",
    });

    expect(reading).toEqual({ kind: "refused", reason: "levy_not_found" });
  });

  it("rechaza sin Stripe configurado", async () => {
    const reading = await readLevyPayers(
      gateways({ isStripeConfigured: false }),
      { callerId: CALLER_ID, priceId: NATIONALS_PRICE },
    );

    expect(reading).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
  });

  it("falla con quien llama sin ficha de socio", async () => {
    await expect(
      readLevyPayers(gateways({ callerClubId: null }), {
        callerId: CALLER_ID,
        priceId: NATIONALS_PRICE,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
