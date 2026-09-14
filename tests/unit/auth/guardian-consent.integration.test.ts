import { expect, it } from "vitest";
import {
  type GuardianConsentGateways,
  recordGuardianConsent,
} from "@/lib/auth/guardian-consent";
import {
  DEFAULT_CLUB_SLUG,
  createSupabaseAuthGateways,
} from "@/lib/auth/supabase-auth-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * El consentimiento del tutor contra `seadragons-dev` con los adaptadores de
 * verdad. Lo que ningún doble puede decir: que las tres columnas y la marca de
 * tiempo quedan en la fila, que la bitácora tiene la entrada, y que la base
 * misma se niega a tener una cuenta activa de un menor sin consentimiento
 * (`0007_members_guardian_consent.sql`).
 */

const MEMBERS_TABLE = "members";
const AUDIT_LOG_TABLE = "audit_log";
const CONSENT_ACTION = "auth.guardian_consent_recorded";

function realGateways(): GuardianConsentGateways {
  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(
      `Faltan variables de entorno: ${wiring.missingKeys.join(", ")}`,
    );
  }
  return {
    accounts: wiring.gateways.accounts,
    identities: wiring.gateways.identities,
    audit: wiring.gateways.audit,
  };
}

/** Una fecha de nacimiento que da 16 años hoy en cualquier zona horaria. */
function sixteenYearsAgo(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 16);
  return date.toISOString().slice(0, 10);
}

type SeededMinor = { readonly userId: string; readonly memberId: string };

async function withIncompleteMinor<T>(
  serviceClient: ServiceRoleClient,
  run: (member: SeededMinor) => Promise<T>,
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
    const { data, error } = await serviceClient.client
      .from(MEMBERS_TABLE)
      .insert({
        club_id: club.id,
        user_id: user.id,
        full_name: "Socia menor",
        email: user.email,
        country: "AU",
        date_of_birth: sixteenYearsAgo(),
        membership_type: "Student",
        account_status: "incomplete",
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        `No se pudo sembrar la socia menor: ${error?.message ?? "sin datos"}`,
      );
    }
    // La fila se va con la identidad por el `on delete cascade` de 0003.
    return run({ userId: user.id, memberId: data.id as string });
  });
}

describeRls("consentimiento de tutor contra seadragons-dev", () => {
  it(
    "guarda los datos del tutor con su marca de tiempo, lo audita y activa la cuenta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withIncompleteMinor(serviceClient, async (member) => {
        const now = new Date();

        const completion = await recordGuardianConsent(realGateways(), {
          userId: member.userId,
          request: {
            guardianName: "Marta Silva",
            guardianEmail: "marta.silva@example.test",
            consent: true,
          },
          now,
        });

        expect(completion).toEqual({ accountStatus: "active", pending: [] });

        const { data: row, error } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .select(
            "account_status, guardian_name, guardian_email, guardian_consent_at",
          )
          .eq("id", member.memberId)
          .single();
        if (error) {
          throw new Error(`No se pudo leer la socia: ${error.message}`);
        }
        expect(row).toMatchObject({
          account_status: "active",
          guardian_name: "Marta Silva",
          guardian_email: "marta.silva@example.test",
        });
        expect(Date.parse(row.guardian_consent_at as string)).toBe(
          now.getTime(),
        );

        const { data: audits, error: auditError } = await serviceClient.client
          .from(AUDIT_LOG_TABLE)
          .select("actor_id, action, entity_type, result")
          .eq("entity_id", member.memberId);
        if (auditError) {
          throw new Error(`No se pudo leer la bitácora: ${auditError.message}`);
        }
        expect(audits).toEqual([
          {
            actor_id: member.userId,
            action: CONSENT_ACTION,
            entity_type: "member",
            result: "success",
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la base se niega a activar a un menor sin consentimiento, aunque la escritura no pase por la aplicación",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withIncompleteMinor(serviceClient, async (member) => {
        const { error } = await serviceClient.client
          .from(MEMBERS_TABLE)
          .update({ account_status: "active" })
          .eq("id", member.memberId);

        expect(error?.message ?? "").toContain(
          "members_active_minor_requires_guardian_consent",
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
