import { randomUUID } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, expect, it } from "vitest";
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
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * El inicio y el cierre de sesión contra `seadragons-dev`, con la frontera de
 * verdad delante. Es lo único que puede contestar la pregunta del ticket que
 * los dobles no contestan: si la credencial de una sesión recién cerrada
 * sigue valiendo. Un token que acaba de invalidarse todavía no ha caducado,
 * así que sólo el servidor de autenticación sabe que ya no sirve.
 *
 * No manda ningún correo: el socio sale de la reserva de socios de prueba
 * (#415), cuyas identidades ya nacieron confirmadas.
 */

const ORIGIN = "http://localhost:3417";
const SESSION_URL = `${ORIGIN}/api/v1/auth/session`;
const PROTECTED_API_PATH = "/api/v1/evaluaciones";
const PROTECTED_PAGE_PATH = "/calendario";
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

  /** Un socio de la reserva con la fila en el estado pedido. La fila se va
   * al devolverlo a la reserva (#415): la identidad no se crea ni se borra. */
  function withMember(
    accountStatus: AccountStatus,
    run: (member: TestUser) => Promise<void>,
  ): Promise<void> {
    return withTestUser(serviceClient, async (user) => {
      const { error } = await serviceClient.client.from("members").insert({
        club_id: clubId,
        user_id: user.id,
        full_name: "Socio de prueba",
        email: user.email,
        account_status: accountStatus,
      });
      if (error) {
        throw new Error(
          `No se pudo crear la fila de miembro de prueba: ${error.message}`,
        );
      }
      await run(user);
    });
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

  it(
    "da sesión a una cuenta activa y la lleva al panel",
    async () => {
      await withMember("active", async ({ email, password }) => {
        const response = await signIn(email, password);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          data: { destination: DASHBOARD_PATH },
        });
        expect(cookiesOf(response).length).toBeGreaterThan(0);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  // "Vuelve más tarde sin haber cerrado sesión y sigue dentro": eso sólo pasa
  // si la cookie sobrevive a cerrar el navegador, es decir, si trae fecha de
  // caducidad propia en vez de morir con la ventana.
  it(
    "deja una sesión que sobrevive a cerrar el navegador",
    async () => {
      await withMember("active", async ({ email, password }) => {
        const response = await signIn(email, password);

        const lifetimes = response.cookies
          .getAll()
          .map(({ maxAge }) => maxAge ?? 0);
        expect(lifetimes.length).toBeGreaterThan(0);
        expect(Math.min(...lifetimes)).toBeGreaterThan(0);
      });
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
      await withMember("inactive", async ({ email, password }) => {
        const response = await signIn(email, password);

        expect(response.status).toBe(403);
        expect(cookiesOf(response)).toEqual([]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "lleva a completar registro a una cuenta incompleta, no al panel",
    async () => {
      await withMember("incomplete", async ({ email, password }) => {
        const response = await signIn(email, password);

        await expect(response.json()).resolves.toEqual({
          data: { destination: COMPLETE_REGISTRATION_PATH },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "responde lo mismo a un correo sin cuenta que a una contraseña equivocada",
    async () => {
      await withMember("active", async ({ email, password }) => {
        const wrongPassword = await signIn(email, "no-es-esta-contrasena");
        const unknownEmail = await signIn(
          `nadie-${randomUUID()}@example.test`,
          password,
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
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja pasar por la frontera a quien lleva la sesión recién abierta",
    async () => {
      await withMember("active", async ({ email, password }) => {
        const cookies = cookiesOf(await signIn(email, password));

        const api = await proxy(requestWith(PROTECTED_API_PATH, cookies));
        const page = await proxy(requestWith(PROTECTED_PAGE_PATH, cookies));

        expect(api.status).toBe(200);
        expect(page.headers.get("location")).toBeNull();
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja de valer esa misma credencial en cuanto se cierra la sesión",
    async () => {
      await withMember("active", async ({ email, password }) => {
        const cookies = cookiesOf(await signIn(email, password));

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
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "manda a la entrada a quien pide una pantalla con la sesión ya cerrada",
    async () => {
      await withMember("active", async ({ email, password }) => {
        const cookies = cookiesOf(await signIn(email, password));
        await DELETE(requestWith(SESSION_URL, cookies, { method: "DELETE" }));

        const replayed = await proxy(requestWith(PROTECTED_PAGE_PATH, cookies));

        expect(replayed.status).toBe(307);
        expect(new URL(replayed.headers.get("location") ?? "").pathname).toBe(
          SIGN_IN_PATH,
        );
      });
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
