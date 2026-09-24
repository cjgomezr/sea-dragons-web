import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  type ClubLogoGateways,
  removeClubLogo,
  replaceClubLogo,
} from "@/lib/club/club-logo";
import {
  CLUB_LOGO_BUCKET,
  createClubLogoGateways,
} from "@/lib/club/supabase-club-logo-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
} from "../../support/rls";

/**
 * El logo del club contra `seadragons-dev` con los adaptadores de verdad
 * (#295). Lo que ningún doble puede decir: que el bucket de
 * `0024_club_logos.sql` guarda el fichero, que su dirección se sirve sin
 * iniciar sesión, y que quitarlo lo borra de verdad.
 *
 * Cada caso siembra su propio club, para no cambiar la marca que ven las
 * demás pruebas, y vacía su carpeta al terminar: borrar el club no alcanza a
 * Storage. Quién llama y la bitácora son dobles: el club sembrado no tiene
 * miembros, y lo que aquí se prueba es el almacenamiento.
 */

const FIXTURES_DIR = path.resolve(__dirname, "../../support/fixtures");
const PNG_BYTES = new Uint8Array(
  readFileSync(path.join(FIXTURES_DIR, "foto-de-perfil.png")),
);
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const OK_STATUS = 200;

function gatewaysFor(
  serviceClient: ServiceRoleClient,
  clubId: string,
): ClubLogoGateways {
  return {
    ...createClubLogoGateways(serviceClient.client),
    members: {
      findRoleRequestMember: async () => ({
        clubId,
        fullName: "Ana Admin",
        role: "Admin",
      }),
    },
    audit: { insertAuditLogRow: async () => ({ error: null }) },
  };
}

async function listFolder(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<readonly string[]> {
  const { data, error } = await serviceClient.client.storage
    .from(CLUB_LOGO_BUCKET)
    .list(clubId);
  if (error) {
    throw new Error(`No se pudo listar la carpeta ${clubId}: ${error.message}`);
  }
  return data.map((file) => `${clubId}/${file.name}`);
}

async function emptyFolder(
  serviceClient: ServiceRoleClient,
  clubId: string,
): Promise<void> {
  const leftovers = await listFolder(serviceClient, clubId);
  if (leftovers.length > 0) {
    await serviceClient.client.storage
      .from(CLUB_LOGO_BUCKET)
      .remove([...leftovers]);
  }
}

async function withThrowawayClub(
  run: (clubId: string, serviceClient: ServiceRoleClient) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  await withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `prueba-${randomUUID()}`, name: "Harbour Hammerheads" }],
    async ([row]) => {
      const clubId = String(row?.id);
      try {
        await run(clubId, serviceClient);
      } finally {
        await emptyFolder(serviceClient, clubId);
      }
    },
  );
}

describeRls("logo del club contra seadragons-dev", () => {
  it(
    "subir deja el fichero en el bucket y se sirve sin iniciar sesión",
    async () => {
      await withThrowawayClub(async (clubId, serviceClient) => {
        const logo = await replaceClubLogo(gatewaysFor(serviceClient, clubId), {
          callerId: ADMIN_ID,
          bytes: PNG_BYTES,
        });

        expect(await listFolder(serviceClient, clubId)).toHaveLength(1);
        const response = await fetch(String(logo.logoUrl));
        expect(response.status).toBe(OK_STATUS);
        expect(response.headers.get("content-type")).toBe("image/png");
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "cambiarlo deja sólo el nuevo, y quitarlo vacía la carpeta",
    async () => {
      await withThrowawayClub(async (clubId, serviceClient) => {
        const gateways = gatewaysFor(serviceClient, clubId);
        await replaceClubLogo(gateways, {
          callerId: ADMIN_ID,
          bytes: PNG_BYTES,
        });
        const second = await replaceClubLogo(gateways, {
          callerId: ADMIN_ID,
          bytes: PNG_BYTES,
        });

        const afterReplace = await listFolder(serviceClient, clubId);
        await removeClubLogo(gateways, { callerId: ADMIN_ID });

        expect(afterReplace).toHaveLength(1);
        expect(String(second.logoUrl)).toContain(afterReplace[0]);
        expect(await listFolder(serviceClient, clubId)).toEqual([]);
        expect(await gateways.logos.findLogoPath(clubId)).toBeNull();
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
