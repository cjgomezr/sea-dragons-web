import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { confirmEmailAndActivate } from "@/lib/auth/email-confirmation";
import {
  type ConfirmationEmailGateway,
  type NewMemberRow,
  registerMember,
} from "@/lib/auth/register-member";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_CLUB_SLUG,
  type SupabaseAuthGateways,
  createConfirmationTokenIssuer,
  createSupabaseAuthGateways,
} from "@/lib/auth/supabase-auth-gateways";
import { readSupabaseConfig } from "@/lib/supabase/config";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
} from "../../support/rls";

/**
 * El registro contra `seadragons-dev` con los adaptadores de verdad. Es lo que
 * comprueba que la fila nace como el ticket dice y que canjear un enlace real
 * activa la cuenta; los dobles de los otros tests no pueden decir nada de eso.
 *
 * NINGÚN test de aquí manda un correo. La identidad se crea con la llave de
 * servicio y el enlace de confirmación se GENERA sin enviarlo, que es
 * exactamente para lo que existe `generateLink`. El puerto del correo de
 * confirmación se sustituye por un doble: el servicio incorporado de Supabase
 * manda 2 mensajes por hora y se niega a escribir fuera del equipo del
 * proyecto, así que llamarlo de verdad sería gastar cuota sin probar nada.
 */

const PASSWORD = "bajoelagua-de-prueba";
const APP_URL = "http://localhost:3417/api/v1/auth/register";

const silentConfirmationEmail: ConfirmationEmailGateway = {
  async requestConfirmationEmail() {
    return { kind: "requested" };
  },
};

function testEmail(): string {
  return `registro-${randomUUID()}@example.test`;
}

function realGateways(): SupabaseAuthGateways {
  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(
      `Faltan variables de entorno: ${wiring.missingKeys.join(", ")}`,
    );
  }
  return wiring.gateways;
}

/** Un cliente como el del navegador, para comprobar que la contraseña sigue
 * abriendo sesión. */
function anonymousClient(): SupabaseClient {
  const config = readSupabaseConfig(process.env);
  if (config.kind === "missing") {
    throw new Error(
      `Faltan variables de entorno: ${config.missingKeys.join(", ")}`,
    );
  }
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type MemberRow = {
  readonly id: string;
  readonly role: string;
  readonly account_status: string;
  readonly membership_type: string | null;
  readonly club_id: string;
};

async function readMemberByUserId(
  serviceClient: ServiceRoleClient,
  userId: string,
): Promise<MemberRow | null> {
  const { data, error } = await serviceClient.client
    .from("members")
    .select("id, role, account_status, membership_type, club_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo leer el miembro de prueba: ${error.message}`);
  }
  return data as MemberRow | null;
}

/** Igual que findUserIdByEmail, pero falla el test en vez de devolver null:
 * un registro que no dejó identidad no tiene nada más que comprobar. */
async function requireUserIdByEmail(
  serviceClient: ServiceRoleClient,
  email: string,
): Promise<string> {
  const userId = await findUserIdByEmail(serviceClient, email);
  if (userId === null) {
    throw new Error(`El registro no creó ninguna identidad para ${email}.`);
  }
  return userId;
}

async function findUserIdByEmail(
  serviceClient: ServiceRoleClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.client.auth.admin.listUsers();
  if (error) {
    throw new Error(`No se pudieron listar las identidades: ${error.message}`);
  }
  return data.users.find((user) => user.email === email)?.id ?? null;
}

/** Borra la identidad al terminar pase lo que pase. La fila de miembro se va
 * con ella por el `on delete cascade` de la migración 0003. */
async function withCleanup(
  serviceClient: ServiceRoleClient,
  email: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } finally {
    const userId = await findUserIdByEmail(serviceClient, email);
    if (userId !== null) {
      await serviceClient.client.auth.admin.deleteUser(userId);
    }
  }
}

describeRls("registro contra seadragons-dev", () => {
  it(
    "crea el socio con el rol Player, el tipo elegido y la cuenta incompleta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = realGateways();
      const email = testEmail();

      await withCleanup(serviceClient, email, async () => {
        const clubId = await gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);

        const result = await registerMember(
          {
            ...gateways.registration,
            confirmationEmail: silentConfirmationEmail,
          },
          {
            request: {
              fullName: "Nerea Silva",
              email,
              country: "AU",
              password: PASSWORD,
              membershipType: "Student",
              dateOfBirth: "1994-03-02",
            },
            clubId,
            now: new Date(),
            appUrl: APP_URL,
          },
        );

        expect(result.receipt).toEqual({
          outcome: "confirmation_pending",
          email,
        });

        const userId = await requireUserIdByEmail(serviceClient, email);
        expect(await gateways.identities.isEmailConfirmed(userId)).toBe(false);

        const member = await readMemberByUserId(serviceClient, userId);
        expect(member).toMatchObject({
          role: "Player",
          account_status: "incomplete",
          membership_type: "Student",
          club_id: clubId,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no crea una segunda cuenta cuando el correo ya está registrado",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = realGateways();
      const email = testEmail();

      await withCleanup(serviceClient, email, async () => {
        const clubId = await gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);
        const request = {
          fullName: "Nerea Silva",
          email,
          country: "AU",
          password: PASSWORD,
          membershipType: "Full",
          dateOfBirth: "1994-03-02",
        };
        const registration = {
          ...gateways.registration,
          confirmationEmail: silentConfirmationEmail,
        };

        const first = await registerMember(registration, {
          request,
          clubId,
          now: new Date(),
          appUrl: APP_URL,
        });
        const second = await registerMember(registration, {
          request,
          clubId,
          now: new Date(),
          appUrl: APP_URL,
        });

        expect(second.receipt).toEqual(first.receipt);

        const { count, error } = await serviceClient.client
          .from("members")
          .select("id", { count: "exact", head: true })
          .eq("email", email);
        if (error) {
          throw new Error(`No se pudieron contar los socios: ${error.message}`);
        }
        expect(count).toBe(1);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "canjear el enlace de confirmación activa la cuenta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = realGateways();
      const email = testEmail();

      await withCleanup(serviceClient, email, async () => {
        const clubId = await gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);

        // generateLink crea la identidad sin confirmar y devuelve el token del
        // enlace. No envía nada: es la forma soportada de probar el canje.
        const { data, error } =
          await serviceClient.client.auth.admin.generateLink({
            type: "signup",
            email,
            password: PASSWORD,
          });
        if (error || !data.user || !data.properties) {
          throw new Error(
            `No se pudo generar el enlace de confirmación: ${error?.message ?? "sin datos"}`,
          );
        }

        const row: NewMemberRow = {
          club_id: clubId,
          user_id: data.user.id,
          full_name: "Nerea Silva",
          email,
          country: "AU",
          date_of_birth: "1994-03-02",
          membership_type: "Full",
          role: "Player",
          account_status: "incomplete",
        };
        await gateways.registration.members.insertMember(row);

        const result = await confirmEmailAndActivate(gateways, {
          tokenHash: data.properties.hashed_token,
          type: "signup",
          now: new Date(),
        });

        expect(result).toEqual({ kind: "activated" });
        const member = await readMemberByUserId(serviceClient, data.user.id);
        expect(member?.account_status).toBe("active");
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});

/**
 * El emisor del enlace que va en el correo de confirmación por Resend. Pide a
 * Supabase el enlace de alta sin contraseña, y eso sólo es seguro por cómo
 * responde Supabase, que no está escrito en ningún tipo: con una cuenta sin
 * confirmar emite el enlace y no toca la contraseña; con una confirmada o con
 * una dirección desconocida no emite nada ni crea ninguna cuenta. Si una
 * versión de Supabase cambia eso, es aquí donde tiene que ponerse rojo.
 */
describeRls("enlace de confirmación contra seadragons-dev", () => {
  it(
    "con una cuenta sin confirmar emite un enlace que la confirma y deja su contraseña intacta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateways = realGateways();
      const tokens = createConfirmationTokenIssuer(serviceClient.client);
      const email = testEmail();

      await withCleanup(serviceClient, email, async () => {
        await gateways.registration.identities.createIdentity({
          email,
          password: PASSWORD,
        });

        const issue = await tokens.issueConfirmationToken(email);
        if (issue.kind !== "issued") {
          throw new Error(`no emitió el enlace: ${JSON.stringify(issue)}`);
        }
        const confirmation = await gateways.confirmations.confirmEmail({
          tokenHash: issue.tokenHash,
          type: "signup",
        });

        expect(confirmation.kind).toBe("confirmed");
        const signIn = await anonymousClient().auth.signInWithPassword({
          email,
          password: PASSWORD,
        });
        expect(signIn.error).toBeNull();
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "con una cuenta ya confirmada no emite nada",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const tokens = createConfirmationTokenIssuer(serviceClient.client);
      const email = testEmail();

      await withCleanup(serviceClient, email, async () => {
        const { error } = await serviceClient.client.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error) {
          throw new Error(`No se pudo crear la cuenta: ${error.message}`);
        }

        expect(await tokens.issueConfirmationToken(email)).toEqual({
          kind: "no_pending_confirmation",
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "con una dirección sin cuenta no emite nada ni crea la cuenta",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const tokens = createConfirmationTokenIssuer(serviceClient.client);
      const email = testEmail();

      await withCleanup(serviceClient, email, async () => {
        expect(await tokens.issueConfirmationToken(email)).toEqual({
          kind: "no_pending_confirmation",
        });
        expect(await findUserIdByEmail(serviceClient, email)).toBeNull();
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
