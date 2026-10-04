// @vitest-environment node
import { expect, it } from "vitest";
import { createPlanChoiceGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * La escritura del plan elegido en Pagos (#479) contra `seadragons-dev`: la
 * condición va en el `update`, así que una membresía que ya tiene suscripción
 * o está al día no cambia de plan aunque el dominio la hubiera leído antes.
 */

const SEEDED_CLUB = "victoria-seadragons";

type MembershipSeed = {
  readonly status: string;
  readonly stripe_subscription_id: string | null;
  readonly waived_reason?: string;
  readonly waived_until?: string;
};

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", SEEDED_CLUB)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el club sembrado: ${error.message}`);
  }
  return String(data.id);
}

/** La reserva borra la fila de socio al terminar, y con ella su membresía en
 * cascada. */
async function withMembership(
  serviceClient: ServiceRoleClient,
  seed: MembershipSeed,
  run: (user: TestUser) => Promise<void>,
): Promise<void> {
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, async (user) => {
    const { error: memberError } = await serviceClient.client
      .from("members")
      .insert({
        club_id: clubId,
        user_id: user.id,
        full_name: "Elena Elige",
        email: user.email,
        account_status: "active",
      });
    if (memberError) {
      throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
    }
    const { error } = await serviceClient.client
      .from("memberships")
      .insert({ user_id: user.id, club_id: clubId, plan: null, ...seed });
    if (error) {
      throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
    }
    await run(user);
  });
}

async function readPlan(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<unknown> {
  const { data, error } = await serviceClient.client
    .from("memberships")
    .select("plan")
    .eq("user_id", user.id)
    .single();
  if (error) {
    throw new Error(`No se pudo leer la membresía: ${error.message}`);
  }
  return data.plan;
}

describeRls("el plan elegido en Pagos contra la base", () => {
  it(
    "guarda el plan de una membresía pending sin suscripción",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withMembership(
        serviceClient,
        { status: "pending", stripe_subscription_id: null },
        async (user) => {
          const gateway = createPlanChoiceGateway(serviceClient.client);

          const isSaved = await gateway.savePlanChoice(user.id, "Student");

          expect(isSaved).toBe(true);
          await expect(readPlan(serviceClient, user)).resolves.toBe("Student");
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it.each([
    ["vencida", "2020-01-01T00:00:00.000Z", "Full"],
    ["vigente", "2999-01-01T00:00:00.000Z", null],
  ] as const)(
    "con una exención %s sin suscripción, guarda el plan sólo si venció",
    async (_which, waivedUntil, expectedPlan) => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withMembership(
        serviceClient,
        {
          status: "waived",
          stripe_subscription_id: null,
          waived_reason: "Entrenadora",
          waived_until: waivedUntil,
        },
        async (user) => {
          const gateway = createPlanChoiceGateway(serviceClient.client);

          const isSaved = await gateway.savePlanChoice(user.id, "Full");

          expect(isSaved).toBe(expectedPlan !== null);
          await expect(readPlan(serviceClient, user)).resolves.toBe(
            expectedPlan,
          );
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no toca el plan de una membresía con suscripción en Stripe",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      await withMembership(
        serviceClient,
        { status: "trialing", stripe_subscription_id: "sub_it_eligiendo" },
        async (user) => {
          const gateway = createPlanChoiceGateway(serviceClient.client);

          const isSaved = await gateway.savePlanChoice(user.id, "Casual");

          expect(isSaved).toBe(false);
          await expect(readPlan(serviceClient, user)).resolves.toBeNull();
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
