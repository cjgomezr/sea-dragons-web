import { randomUUID } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DELETE, POST } from "@/app/api/v1/auth/session/route";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { INVALID_CREDENTIALS_MESSAGE } from "@/lib/auth/sign-in";
import { proxy } from "@/proxy";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
} from "../../support/rls";

/**
 * El inicio y el cierre de sesión contra `seadragons-dev`, con la frontera de
 * verdad delante. Es lo único que puede contestar la pregunta del ticket que
 * los dobles no contestan: si la credencial de una sesión recién cerrada
 * sigue valiendo. Un token que acaba de invalidarse todavía no ha caducado,
 * así que sólo el servidor de autenticación sabe que ya no sirve.
 *
 * No manda ningún correo: la identidad nace confirmada con la llave de
 * servicio, que es lo que `admin.createUser` permite hacer sin enviar nada.
 */

const ORIGIN = "http://localhost:3417";
const SESSION_URL = `${ORIGIN}/api/v1/auth/session`;
const PROTECTED_API_PATH = "/api/v1/evaluaciones";
const PROTECTED_PAGE_PATH = "/calendario";
const PASSWORD = "bajoelagua-de-prueba";
const CLUB_SLUG = "victoria-seadragons";

type SessionCookies = readonly {
  readonly name: string;
  readonly value: string;
}[];

function cookiesOf(response: NextResponse): SessionCookies {
  return (
    response.cookies
      .getAll()
      .map(({ name, value }) => ({ name, value }))
      // Una cookie vaciada es la orden de borrarla: reenviarla sería mandar
      // una sesión vacía, no la que había antes.
      .filter(({ value }) => value !== "")
  );
}

function cookieHeader(cookies: SessionCookies): string {
  return cookies
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

/** Lo poco que estos casos necesitan de un `RequestInit`. El de la DOM admite
 * `signal: null` y el de NextRequest no, así que pasarlo entero no compila. */
type RequestOptions = {
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly body?: string;
};

function requestWith(
  path: string,
  cookies: SessionCookies,
  init: RequestOptions = {},
): NextRequest {
  const headers = new Headers(init.headers);
  if (cookies.length > 0) {
    headers.set("cookie", cookieHeader(cookies));
  }
  return new NextRequest(new URL(path, ORIGIN), { ...init, headers });
}

async function signIn(
  email: string,
  password: string,
  cookies: SessionCookies = [],
): Promise<NextResponse> {
  return POST(
    requestWith(SESSION_URL, cookies, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
}

describeRls("sesión contra Supabase", () => {
  let serviceClient: ServiceRoleClient;
  let clubId: string;
  const createdUserIds: string[] = [];

  async function createMember(
    accountStatus: AccountStatus,
  ): Promise<{ readonly email: string; readonly userId: string }> {
    const email = `sesion-${randomUUID()}@example.test`;
    const { data, error } = await serviceClient.client.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `No se pudo crear la identidad de prueba: ${error?.message ?? "sin datos"}`,
      );
    }
    createdUserIds.push(data.user.id);

    const { error: memberError } = await serviceClient.client
      .from("members")
      .insert({
        club_id: clubId,
        user_id: data.user.id,
        full_name: "Socio de prueba",
        email,
        account_status: accountStatus,
      });
    if (memberError) {
      throw new Error(
        `No se pudo crear la fila de miembro de prueba: ${memberError.message}`,
      );
    }
    return { email, userId: data.user.id };
  }

  beforeAll(async () => {
    serviceClient = createServiceRoleTestClient(process.env);
    const { data, error } = await serviceClient.client
      .from("clubs")
      .select("id")
      .eq("slug", CLUB_SLUG)
      .single();
    if (error || !data) {
      throw new Error(
        `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
      );
    }
    clubId = data.id as string;
  }, RLS_NETWORK_TEST_TIMEOUT_MS);

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await serviceClient.client.auth.admin.deleteUser(userId);
    }
  }, RLS_NETWORK_TEST_TIMEOUT_MS);

  it(
    "da sesión a una cuenta activa y la lleva al panel",
    async () => {
      const { email } = await createMember("active");

      const response = await signIn(email, PASSWORD);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { destination: DASHBOARD_PATH },
      });
      expect(cookiesOf(response).length).toBeGreaterThan(0);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  // "Vuelve más tarde sin haber cerrado sesión y sigue dentro": eso sólo pasa
  // si la cookie sobrevive a cerrar el navegador, es decir, si trae fecha de
  // caducidad propia en vez de morir con la ventana.
  it(
    "deja una sesión que sobrevive a cerrar el navegador",
    async () => {
      const { email } = await createMember("active");

      const response = await signIn(email, PASSWORD);

      const lifetimes = response.cookies
        .getAll()
        .map(({ maxAge }) => maxAge ?? 0);
      expect(lifetimes.length).toBeGreaterThan(0);
      expect(Math.min(...lifetimes)).toBeGreaterThan(0);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  // Supabase autentica antes de que nadie mire si esa cuenta puede operar, así
  // que a esta altura ya existe una sesión viva. La respuesta no puede
  // entregarla: la frontera sólo pregunta si hay sesión, y con la cookie
  // puesta esta cuenta entraría en la siguiente petición.
  it(
    "no entrega ninguna sesión a una cuenta dada de baja",
    async () => {
      const { email } = await createMember("inactive");

      const response = await signIn(email, PASSWORD);

      expect(response.status).toBe(403);
      expect(cookiesOf(response)).toEqual([]);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "lleva a completar registro a una cuenta incompleta, no al panel",
    async () => {
      const { email } = await createMember("incomplete");

      const response = await signIn(email, PASSWORD);

      await expect(response.json()).resolves.toEqual({
        data: { destination: COMPLETE_REGISTRATION_PATH },
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "responde lo mismo a un correo sin cuenta que a una contraseña equivocada",
    async () => {
      const { email } = await createMember("active");

      const wrongPassword = await signIn(email, "no-es-esta-contrasena");
      const unknownEmail = await signIn(
        `nadie-${randomUUID()}@example.test`,
        PASSWORD,
      );

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      const [wrongBody, unknownBody] = await Promise.all([
        wrongPassword.json(),
        unknownEmail.json(),
      ]);
      expect(wrongBody).toEqual(unknownBody);
      expect(wrongBody).toEqual({
        error: {
          code: "unauthenticated",
          message: INVALID_CREDENTIALS_MESSAGE,
        },
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja pasar por la frontera a quien lleva la sesión recién abierta",
    async () => {
      const { email } = await createMember("active");
      const cookies = cookiesOf(await signIn(email, PASSWORD));

      const api = await proxy(requestWith(PROTECTED_API_PATH, cookies));
      const page = await proxy(requestWith(PROTECTED_PAGE_PATH, cookies));

      expect(api.status).toBe(200);
      expect(page.headers.get("location")).toBeNull();
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja de valer esa misma credencial en cuanto se cierra la sesión",
    async () => {
      const { email } = await createMember("active");
      const cookies = cookiesOf(await signIn(email, PASSWORD));

      const signOut = await DELETE(
        requestWith(SESSION_URL, cookies, { method: "DELETE" }),
      );
      expect(signOut.status).toBe(200);

      // Las MISMAS cookies de antes: es lo que tendría una segunda pestaña que
      // todavía no ha vuelto a pedir nada, y lo que tendría quien las hubiera
      // copiado.
      const replayed = await proxy(requestWith(PROTECTED_API_PATH, cookies));

      expect(replayed.status).toBe(401);
      await expect(replayed.json()).resolves.toMatchObject({
        error: { code: "unauthenticated" },
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "manda a la entrada a quien pide una pantalla con la sesión ya cerrada",
    async () => {
      const { email } = await createMember("active");
      const cookies = cookiesOf(await signIn(email, PASSWORD));
      await DELETE(requestWith(SESSION_URL, cookies, { method: "DELETE" }));

      const replayed = await proxy(requestWith(PROTECTED_PAGE_PATH, cookies));

      expect(replayed.status).toBe(307);
      expect(new URL(replayed.headers.get("location") ?? "").pathname).toBe(
        SIGN_IN_PATH,
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "cierra sesión sin quejarse cuando ya no había ninguna",
    async () => {
      const response = await DELETE(
        requestWith(SESSION_URL, [], { method: "DELETE" }),
      );

      expect(response.status).toBe(200);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
