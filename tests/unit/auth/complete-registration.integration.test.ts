import { expect, it } from "vitest";
import {
  type AccountCompletionGateways,
  completeRegistration,
  describeAccountCompletion,
} from "@/lib/auth/complete-registration";
import {
  DEFAULT_CLUB_SLUG,
  createSupabaseAuthGateways,
} from "@/lib/auth/supabase-auth-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * Completar el registro contra `seadragons-dev` con los adaptadores de verdad.
 *
 * Es lo que comprueba dos cosas que ningún doble puede decir: que la fila pasa
 * de verdad a `active` en la base, y que el socio NO puede escribir esa fila
 * él mismo. Lo segundo es el motivo de que la escritura la haga el servidor
 * con la llave de servicio: `0003_members.sql` no le concede a `authenticated`
 * ningún privilegio de escritura, para que `role` y `account_status` no los
 * pueda mover el dueño de la fila (AC-039).
 */

const MEMBERS_TABLE = "members";

function realGateways(): AccountCompletionGateways {
  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(
      `Faltan variables de entorno: ${wiring.missingKeys.join(", ")}`,
    );
  }
  return {
    accounts: wiring.gateways.accounts,
    identities: wiring.gateways.identities,
  };
}

type SeededMember = {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
};

/** Un socio con el correo ya confirmado y la fila a medias, que es el caso que
 * este ticket resuelve: le falta un dato y sigue `incomplete`. */
async function withIncompleteMember<T>(
  serviceClient: ServiceRoleClient,
  columns: Readonly<Record<string, string | null>>,
  run: (member: SeededMember) => Promise<T>,
): Promise<T> {
  const { data: club, error: clubError } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", DEFAULT_CLUB_SLUG)
    .single();
  if (clubError || !club) {
    throw new Error(
      `No se pudo leer el club sembrado: ${clubError?.message ?? "sin datos"}`,
    );
  }

  return withTestUser(serviceClient, async (user) => {
    const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
      club_id: club.id,
      user_id: user.id,
      full_name: "Socio a medias",
      email: user.email,
      account_status: "incomplete",
      ...columns,
    });
    if (error) {
      throw new Error(
        `No se pudo sembrar el socio incompleto: ${error.message}`,
      );
    }
    // La fila se va con la identidad por el `on delete cascade` de 0003.
    return run({ userId: user.id, email: user.email, password: user.password });
  });
}

async function readAccountStatus(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.client
    .from(MEMBERS_TABLE)
    .select("account_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo leer el socio de prueba: ${error.message}`);
  }
  return data === null ? null : (data.account_status as string);
}

describeRls("completar registro contra seadragons-dev", () => {
  it(
    "pide sólo el dato que falta y activa la cuenta al guardarlo",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = realGateways();

      await withIncompleteMember(
        serviceClient,
        {
          country: "AU",
          date_of_birth: "1994-03-02",
          membership_type: null,
        },
        async (member) => {
          const before = await describeAccountCompletion(gateways, {
            userId: member.userId,
          });
          expect(before).toEqual({
            accountStatus: "incomplete",
            pending: ["membershipType"],
          });

          const after = await completeRegistration(gateways, {
            userId: member.userId,
            values: { membershipType: "Student" },
            now: new Date(),
          });

          expect(after).toEqual({ accountStatus: "active", pending: [] });
          await expect(
            readAccountStatus(serviceClient, member.userId),
          ).resolves.toBe("active");
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja la cuenta incompleta mientras quede otro dato por dar",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = realGateways();

      await withIncompleteMember(
        serviceClient,
        { country: null, date_of_birth: null, membership_type: null },
        async (member) => {
          const after = await completeRegistration(gateways, {
            userId: member.userId,
            values: { country: "AU" },
            now: new Date(),
          });

          expect(after.accountStatus).toBe("incomplete");
          expect(after.pending).toEqual(["dateOfBirth", "membershipType"]);
          await expect(
            readAccountStatus(serviceClient, member.userId),
          ).resolves.toBe("incomplete");
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no deja que el socio se active él mismo escribiendo su propia fila",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withIncompleteMember(
        serviceClient,
        {
          country: "AU",
          date_of_birth: "1994-03-02",
          membership_type: null,
        },
        async (member) => {
          const rlsClient = await createRlsClient(
            {
              role: "authenticated",
              email: member.email,
              password: member.password,
            },
            process.env,
          );

          const { error } = await rlsClient.client
            .from(MEMBERS_TABLE)
            .update({ account_status: "active", membership_type: "Full" })
            .eq("user_id", member.userId);

          // Sin privilegio de escritura la base contesta que no. Si algún día
          // esa policy se abriera, este test se pone rojo antes de que nadie
          // descubra cuentas activándose solas.
          expect(error?.message ?? "").toMatch(/permission denied/i);
          await expect(
            readAccountStatus(serviceClient, member.userId),
          ).resolves.toBe("incomplete");
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
