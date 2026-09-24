import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createClubSettingsGateways } from "@/lib/club/supabase-club-settings-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
} from "../../support/rls";

/**
 * El adaptador de la configuración del club (#296) contra la base de verdad.
 * Lo que aquí se prueba es lo que un doble no puede: que la escritura sólo
 * casa con la fila que el Admin tenía delante, también cuando las iniciales
 * son nulas. Cada caso siembra su propio club, para no tocar el nombre del
 * club que ven las demás pruebas.
 */

type SeededClub = { readonly id: string };

/** El acento que `0022_club_brand.sql` pone por defecto. */
const SEEDED_ACCENT = "#1c6ea4";

async function withThrowawayClub(
  initials: string | null,
  run: (club: SeededClub) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `prueba-${randomUUID()}`, name: "Harbour Hammerheads", initials }],
    ([row]) => run({ id: String(row?.id) }),
  );
}

function settingsGateway() {
  return createClubSettingsGateways(
    createServiceRoleTestClient(process.env).client,
  ).settings;
}

describeRls("configuración del club en Supabase", () => {
  it(
    "guarda el nombre, las iniciales y el acento cuando la fila sigue como se leyó",
    async () => {
      await withThrowawayClub("HH", async (club) => {
        const result = await settingsGateway().updateClubIdentity(club.id, {
          expected: {
            name: "Harbour Hammerheads",
            initials: "HH",
            accentColor: SEEDED_ACCENT,
          },
          identity: {
            name: "Bay Barracudas",
            initials: null,
            accentColor: "#7b3fa0",
          },
        });

        expect(result).toEqual({
          kind: "updated",
          settings: {
            name: "Bay Barracudas",
            initials: null,
            accentColor: "#7b3fa0",
            logoPath: null,
          },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "casa también con unas iniciales nulas",
    async () => {
      await withThrowawayClub(null, async (club) => {
        const result = await settingsGateway().updateClubIdentity(club.id, {
          expected: {
            name: "Harbour Hammerheads",
            initials: null,
            accentColor: SEEDED_ACCENT,
          },
          identity: {
            name: "Harbour Hammerheads",
            initials: "HQ",
            accentColor: SEEDED_ACCENT,
          },
        });

        expect(result).toMatchObject({
          kind: "updated",
          settings: { initials: "HQ" },
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it.each([
    ["las iniciales", { initials: "XX", accentColor: SEEDED_ACCENT }],
    ["el acento", { initials: "HH", accentColor: "#7b3fa0" }],
  ])(
    "no pisa nada si otro Admin cambió %s entretanto",
    async (_field, changed) => {
      await withThrowawayClub("HH", async (club) => {
        const gateway = settingsGateway();

        const result = await gateway.updateClubIdentity(club.id, {
          expected: { name: "Harbour Hammerheads", ...changed },
          identity: {
            name: "Bay Barracudas",
            initials: "BB",
            accentColor: "#2e7d32",
          },
        });

        expect(result).toEqual({ kind: "changed_meanwhile" });
        await expect(gateway.findClubSettings(club.id)).resolves.toMatchObject({
          name: "Harbour Hammerheads",
          initials: "HH",
          accentColor: SEEDED_ACCENT,
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
