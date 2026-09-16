import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  MAX_RECOVERY_REQUESTS_PER_WINDOW,
  type PasswordRecoveryRequestGateways,
  type RecoveryEmail,
  requestPasswordRecovery,
  resetPassword,
} from "@/lib/auth/password-recovery";
import {
  type PasswordRecoveryGateways,
  createSupabasePasswordRecoveryGateways,
} from "@/lib/auth/supabase-password-recovery";
import { readSupabaseConfig } from "@/lib/supabase/config";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
} from "../../support/rls";

/**
 * La recuperación de contraseña contra `seadragons-dev`, con todo de verdad
 * menos el correo: los enlaces los emite Supabase Auth, el límite lo cuenta la
 * tabla de la migración 0005 y la bitácora es `audit_log`. El envío es un doble
 * que guarda lo que habría mandado, porque el proveedor llega en el ticket
 * siguiente.
 *
 * Es la única prueba que contesta lo que NFR-007 deja en manos del servicio de
 * autenticación: que un enlace canjeado no se puede canjear dos veces.
 */

const ORIGINAL_PASSWORD = "bajoelagua-de-prueba";
const NEW_PASSWORD = "bajoelagua-recuperada";
const RESET_BASE_URL = "http://localhost:3417/recuperar-contrasena/nueva";

function buildResetUrl(tokenHash: string): string {
  return `${RESET_BASE_URL}?token_hash=${tokenHash}`;
}

function tokenHashOf(email: RecoveryEmail): string {
  const tokenHash = new URL(email.resetUrl).searchParams.get("token_hash");
  if (tokenHash === null) {
    throw new Error(`El enlace no lleva token_hash: ${email.resetUrl}`);
  }
  return tokenHash;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describeRls("recuperación de contraseña contra Supabase", () => {
  let serviceClient: ServiceRoleClient;
  let gateways: PasswordRecoveryGateways;
  const sentEmails: RecoveryEmail[] = [];
  const createdUserIds: string[] = [];
  const usedEmails: string[] = [];

  function requestGateways(): PasswordRecoveryRequestGateways {
    return {
      requests: gateways.requests,
      tokens: gateways.tokens,
      emails: {
        sendRecoveryEmail: async (email) => {
          sentEmails.push(email);
        },
      },
    };
  }

  function uniqueEmail(): string {
    const email = `recuperar-${randomUUID()}@example.test`;
    usedEmails.push(email);
    return email;
  }

  async function createIdentity(): Promise<{
    readonly email: string;
    readonly userId: string;
  }> {
    const email = uniqueEmail();
    const { data, error } = await serviceClient.client.auth.admin.createUser({
      email,
      password: ORIGINAL_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `No se pudo crear la identidad de prueba: ${error?.message ?? "sin datos"}`,
      );
    }
    createdUserIds.push(data.user.id);
    return { email, userId: data.user.id };
  }

  /** Ejecuta la entrega que la ruta deja para después de responder. Falla si
   * no había entrega pendiente. */
  async function deliverPending(
    outcome: Awaited<ReturnType<typeof requestPasswordRecovery>>,
  ): Promise<void> {
    if (outcome.kind !== "accepted") {
      throw new Error(
        `Se esperaba una entrega pendiente y llegó ${outcome.kind}.`,
      );
    }
    await outcome.deliver();
  }

  async function requestLinkFor(email: string): Promise<string> {
    sentEmails.length = 0;
    await deliverPending(
      await requestPasswordRecovery(requestGateways(), {
        email,
        now: new Date(),
        buildResetUrl,
      }),
    );
    const [sent] = sentEmails;
    if (sent === undefined) {
      throw new Error(`No salió ningún enlace para ${email}.`);
    }
    return tokenHashOf(sent);
  }

  async function canSignIn(email: string, password: string): Promise<boolean> {
    const config = readSupabaseConfig(process.env);
    if (config.kind === "missing") {
      throw new Error("Falta la configuración anónima de Supabase.");
    }
    const client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    return error === null;
  }

  beforeAll(async () => {
    serviceClient = createServiceRoleTestClient(process.env);
    const wiring = await createSupabasePasswordRecoveryGateways(process.env);
    if (wiring.kind === "unconfigured") {
      throw new Error(`Faltan variables: ${wiring.missingKeys.join(", ")}`);
    }
    gateways = wiring.gateways;
  }, RLS_NETWORK_TEST_TIMEOUT_MS);

  afterAll(async () => {
    for (const userId of createdUserIds) {
      const { error } =
        await serviceClient.client.auth.admin.deleteUser(userId);
      if (error) {
        console.error(
          `No se pudo borrar la identidad ${userId}: ${error.message}`,
        );
      }
    }
    const { error } = await serviceClient.client
      .from("password_recovery_requests")
      .delete()
      .in("email_hash", usedEmails.map(sha256));
    if (error) {
      console.error(
        `No se pudieron limpiar las peticiones de prueba: ${error.message}`,
      );
    }
  }, RLS_NETWORK_TEST_TIMEOUT_MS);

  it(
    "con un correo registrado emite un enlace hacia ese correo",
    async () => {
      const { email } = await createIdentity();
      sentEmails.length = 0;

      const outcome = await requestPasswordRecovery(requestGateways(), {
        email,
        now: new Date(),
        buildResetUrl,
      });

      await deliverPending(outcome);
      expect(sentEmails.map((sent) => sent.to)).toEqual([email]);
      expect(tokenHashOf(sentEmails[0]!)).not.toBe("");
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "con un correo inexistente responde lo mismo y no emite nada",
    async () => {
      sentEmails.length = 0;

      const outcome = await requestPasswordRecovery(requestGateways(), {
        email: uniqueEmail(),
        now: new Date(),
        buildResetUrl,
      });

      await deliverPending(outcome);
      expect(sentEmails).toEqual([]);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "el enlace cambia la contraseña una vez y la segunda ya no vale",
    async () => {
      const { email } = await createIdentity();
      const tokenHash = await requestLinkFor(email);
      const resetGateways = {
        tokens: gateways.redeemer,
        audit: gateways.audit,
      };

      const first = await resetPassword(resetGateways, {
        tokenHash,
        password: NEW_PASSWORD,
      });
      const second = await resetPassword(resetGateways, {
        tokenHash,
        password: `${NEW_PASSWORD}-otra`,
      });

      expect(first).toEqual({ kind: "password_changed" });
      expect(second).toEqual({ kind: "link_unusable" });
      expect(await canSignIn(email, NEW_PASSWORD)).toBe(true);
      expect(await canSignIn(email, ORIGINAL_PASSWORD)).toBe(false);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS * 2,
  );

  it(
    "la bitácora registra el cambio y no guarda la contraseña ni el enlace",
    async () => {
      const { email, userId } = await createIdentity();
      const tokenHash = await requestLinkFor(email);

      await resetPassword(
        { tokens: gateways.redeemer, audit: gateways.audit },
        { tokenHash, password: NEW_PASSWORD },
      );

      const { data, error } = await serviceClient.client
        .from("audit_log")
        .select("*")
        .eq("entity_id", userId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({
        actor_id: userId,
        action: "auth.password_changed",
        result: "success",
      });
      const stored = JSON.stringify(data);
      for (const secret of [NEW_PASSWORD, tokenHash]) {
        expect(stored).not.toContain(secret);
        expect(stored).not.toContain(sha256(secret));
      }
    },
    RLS_NETWORK_TEST_TIMEOUT_MS * 2,
  );

  it(
    "superado el límite para el mismo correo, responde pidiendo esperar",
    async () => {
      const email = uniqueEmail();
      const outcomes = [];

      for (
        let attempt = 0;
        attempt <= MAX_RECOVERY_REQUESTS_PER_WINDOW;
        attempt += 1
      ) {
        outcomes.push(
          await requestPasswordRecovery(requestGateways(), {
            email,
            now: new Date(),
            buildResetUrl,
          }),
        );
      }

      expect(outcomes.at(-1)).toMatchObject({ kind: "rate_limited" });
      expect(outcomes.slice(0, -1).map((outcome) => outcome.kind)).toEqual(
        Array(MAX_RECOVERY_REQUESTS_PER_WINDOW).fill("accepted"),
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS * 2,
  );

  it(
    "no guarda el correo en claro en la tabla del límite",
    async () => {
      const email = uniqueEmail();

      await requestPasswordRecovery(requestGateways(), {
        email,
        now: new Date(),
        buildResetUrl,
      });

      const { data, error } = await serviceClient.client
        .from("password_recovery_requests")
        .select("email_hash")
        .eq("email_hash", sha256(email));
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(JSON.stringify(data)).not.toContain(email);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
