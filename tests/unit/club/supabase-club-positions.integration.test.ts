import { expect, it } from "vitest";
import { fetchClubPositions } from "@/lib/club/supabase-club-positions";
import { withClubWithArchivedPosition } from "../../support/club-positions";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  createServiceRoleTestClient,
  describeRls,
} from "../../support/rls";

/**
 * Las posiciones del club contra `seadragons-dev` (#299): lo que ningún doble
 * dice, que la consulta trae los nombres anidados, en el orden del club y con
 * la marca de archivo.
 */

describeRls("las posiciones del club contra seadragons-dev", () => {
  it(
    "trae las del club en su orden, con sus nombres y la archivada marcada",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);

      await withClubWithArchivedPosition(
        serviceClient,
        async ({ clubId, archivedPositionId }) => {
          const positions = await fetchClubPositions(
            serviceClient.client,
            clubId,
          );

          expect(
            positions.map(({ names, isArchived }) => [names, isArchived]),
          ).toEqual([
            [{ en: "Goalkeeper", es: "Portería" }, false],
            [{ en: "Defender", es: "Defensa" }, false],
            [{ en: "Forward", es: "Ataque" }, false],
            [{ en: "Utility", es: null }, true],
          ]);
          expect(positions[3]?.id).toBe(archivedPositionId);
        },
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
