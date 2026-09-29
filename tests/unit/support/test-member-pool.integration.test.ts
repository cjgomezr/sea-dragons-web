import { expect, it } from "vitest";
import {
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  RLS_NETWORK_TEST_TIMEOUT_MS,
} from "../../support/rls";
import { createSupabaseTestMemberPool } from "../../support/supabase-test-member-pool";
import {
  createRunId,
  type PooledMember,
  type TestMemberPool,
  withPooledMember,
} from "../../support/test-member-pool";

/**
 * La reserva contra `seadragons-dev` (#415). Usa una reserva propia y no la
 * del arnés: la del arnés la comparten todos los tests de la corrida a la vez,
 * y lo que se cuenta aquí es cuántas identidades crea la reserva, no cuántas
 * plazas tenían ocupadas los demás en ese momento.
 */
const COUNTED_NAMESPACE = "conteo";
const REPEATED_ROUNDS = 3;
/** Crear, reutilizar y comprobar varias rondas cuesta más que un test normal. */
const POOL_TEST_TIMEOUT_MS = RLS_NETWORK_TEST_TIMEOUT_MS * 2;

/** Dos socios a la vez, como un test que anida dos `withTestUser`. */
function withTwoMembers(
  pool: TestMemberPool,
): Promise<readonly PooledMember[]> {
  return withPooledMember(pool, COUNTED_NAMESPACE, (first) =>
    withPooledMember(pool, COUNTED_NAMESPACE, async (second) => [
      first,
      second,
    ]),
  );
}

describeRls("la reserva de socios de prueba contra seadragons-dev", () => {
  it(
    "una vez creadas sus plazas, las reutiliza sin crear ninguna identidad en Auth",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const pool = createSupabaseTestMemberPool(
        serviceClient.client,
        createRunId(),
      );
      // La primera vez en un proyecto limpio sí crea: es la reserva naciendo.
      await withTwoMembers(pool);
      const startedAt = new Date();

      const handedOut: PooledMember[] = [];
      for (let round = 0; round < REPEATED_ROUNDS; round += 1) {
        handedOut.push(...(await withTwoMembers(pool)));
      }

      const createdDuringRounds: string[] = [];
      for (const id of new Set(handedOut.map((member) => member.id))) {
        const { data, error } =
          await serviceClient.client.auth.admin.getUserById(id);
        if (error) {
          throw new Error(`No se pudo leer ${id}: ${error.message}`);
        }
        if (new Date(data.user.created_at) >= startedAt) {
          createdDuringRounds.push(data.user.email ?? id);
        }
      }
      expect(createdDuringRounds).toEqual([]);
    },
    POOL_TEST_TIMEOUT_MS,
  );

  it(
    "el socio que entrega puede abrir sesión con la contraseña que trae",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const pool = createSupabaseTestMemberPool(
        serviceClient.client,
        createRunId(),
      );

      const role = await withPooledMember(
        pool,
        COUNTED_NAMESPACE,
        async (member) => {
          const client = await createRlsClient(
            {
              role: "authenticated",
              email: member.email,
              password: member.password,
            },
            process.env,
          );
          return client.role;
        },
      );

      expect(role).toBe("authenticated");
    },
    POOL_TEST_TIMEOUT_MS,
  );
});
