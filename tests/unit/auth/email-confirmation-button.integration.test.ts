import { render } from "@testing-library/react";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * El botón de confirmar el correo (#477) contra `seadragons-dev`, con los
 * adaptadores de verdad. Los escáneres de enlaces del correo de empresa abren
 * la URL antes que la persona; lo que este test comprueba es que esas
 * aperturas no gastan el token en Supabase y que el POST del botón sí lo
 * canjea, una sola vez.
 *
 * La identidad sale de la reserva de socios de prueba (#415), así que ya
 * llega confirmada: el enlace se GENERA sin enviarlo con `generateLink`, de
 * tipo `magiclink`, que Supabase canjea como `email`. Lo observable es el
 * token: si las aperturas lo hubieran gastado, el POST respondería `invalida`.
 */

const APP_ORIGIN = "http://localhost:3417";
const MEMBERS_TABLE = "members";

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => "en",
}));

async function seedIncompleteMember(
  serviceClient: ServiceRoleClient,
  user: TestUser,
): Promise<void> {
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
  // Sin país ni fecha de nacimiento: la cuenta no puede quedar activa, y el
  // canje la tiene que dejar como estaba, incompleta.
  const { error } = await serviceClient.client.from(MEMBERS_TABLE).insert({
    club_id: club.id,
    user_id: user.id,
    full_name: "Socio por confirmar",
    email: user.email,
    account_status: "incomplete",
  });
  if (error) {
    throw new Error(`No se pudo sembrar el socio: ${error.message}`);
  }
}

async function generateTokenHash(
  serviceClient: ServiceRoleClient,
  email: string,
): Promise<string> {
  const { data, error } = await serviceClient.client.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    throw new Error(`No se pudo generar el enlace: ${error.message}`);
  }
  return data.properties.hashed_token;
}

async function openConfirmationLink(tokenHash: string): Promise<void> {
  const { default: EmailConfirmationPage } =
    await import("@/app/(auth)/auth/confirmar/page");
  render(
    await EmailConfirmationPage({
      searchParams: Promise.resolve({ token_hash: tokenHash, type: "email" }),
    }),
  );
}

async function pressConfirmButton(tokenHash: string): Promise<string | null> {
  const { POST } = await import("@/app/(auth)/auth/confirmar/canjear/route");
  const response = await POST(
    new NextRequest(`${APP_ORIGIN}/auth/confirmar/canjear`, {
      method: "POST",
      headers: {
        origin: APP_ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token_hash: tokenHash,
        type: "email",
      }).toString(),
    }),
  );
  return response.headers.get("location");
}

describeRls("botón de confirmar el correo contra seadragons-dev", () => {
  it(
    "abrir el enlace dos veces no gasta el token y el botón lo canjea una vez",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await withTestUser(serviceClient, async (user) => {
        await seedIncompleteMember(serviceClient, user);
        const tokenHash = await generateTokenHash(serviceClient, user.email);

        await openConfirmationLink(tokenHash);
        await openConfirmationLink(tokenHash);
        const firstPress = await pressConfirmButton(tokenHash);
        const secondPress = await pressConfirmButton(tokenHash);

        expect(firstPress).toBe(
          `${APP_ORIGIN}/registro?confirmacion=pendiente`,
        );
        expect(secondPress).toBe(
          `${APP_ORIGIN}/registro?confirmacion=invalida`,
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
