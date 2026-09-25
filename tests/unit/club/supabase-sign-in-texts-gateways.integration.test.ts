import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { NO_SIGN_IN_TEXTS, type SignInTexts } from "@/lib/club/sign-in-texts";
import { createSignInTextsGateways } from "@/lib/club/supabase-sign-in-texts-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
} from "../../support/rls";

/**
 * El adaptador de los textos del inicio de sesión (#301) contra la base de
 * verdad: que guarda los dos idiomas y que dejar uno vacío lo vuelve a nulo.
 * Cada caso siembra su propio club, para no tocar la pantalla de entrar que
 * ven las demás pruebas.
 */

async function withThrowawayClub(
  run: (clubId: string) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `prueba-${randomUUID()}`, name: "Harbour Hammerheads" }],
    ([row]) => run(String(row?.id)),
  );
}

function textsGateway() {
  return createSignInTextsGateways(
    createServiceRoleTestClient(process.env).client,
  ).signInTexts;
}

const BOTH_LOCALES: SignInTexts = {
  en: { tagline: "Dive in.", welcome: "Train with us." },
  es: { tagline: "Al agua.", welcome: null },
};

describeRls("textos del inicio de sesión en Supabase", () => {
  it(
    "un club que no escribió ninguno no tiene textos",
    async () => {
      await withThrowawayClub(async (clubId) => {
        expect(await textsGateway().findSignInTexts(clubId)).toEqual(
          NO_SIGN_IN_TEXTS,
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "guarda los de cada idioma y los vuelve a leer igual",
    async () => {
      await withThrowawayClub(async (clubId) => {
        const saved = await textsGateway().replaceSignInTexts(
          clubId,
          BOTH_LOCALES,
        );

        expect(saved).toEqual(BOTH_LOCALES);
        expect(await textsGateway().findSignInTexts(clubId)).toEqual(
          BOTH_LOCALES,
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "borrarlos deja el club sin textos, como al principio",
    async () => {
      await withThrowawayClub(async (clubId) => {
        await textsGateway().replaceSignInTexts(clubId, BOTH_LOCALES);

        await textsGateway().replaceSignInTexts(clubId, NO_SIGN_IN_TEXTS);

        expect(await textsGateway().findSignInTexts(clubId)).toEqual(
          NO_SIGN_IN_TEXTS,
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
