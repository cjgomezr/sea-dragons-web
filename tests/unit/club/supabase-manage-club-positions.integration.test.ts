import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type {
  ManagedPosition,
  ManagedPositions,
} from "@/lib/club/manage-club-positions";
import { createManagedPositionsGateways } from "@/lib/club/supabase-manage-club-positions";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
} from "../../support/rls";

/**
 * El adaptador con el que el Admin administra las posiciones (#300) contra
 * `seadragons-dev`. Lo que un doble no dice: que las funciones de
 * `0027_manage_club_positions.sql` se llaman con los argumentos que esperan y
 * que su respuesta se lee bien. Cada caso siembra su propio club, que nace
 * con las tres posiciones de siempre.
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

function positionsGateway() {
  return createManagedPositionsGateways(
    createServiceRoleTestClient(process.env).client,
  ).positions;
}

/** Las tres que siembra cada club nuevo, en su orden. */
function seededThree(
  positions: ManagedPositions,
): readonly [ManagedPosition, ManagedPosition, ManagedPosition] {
  const [first, second, third] = positions;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error(`El club tiene ${positions.length} posiciones, no tres.`);
  }
  return [first, second, third];
}

function englishNames(positions: ManagedPositions): (string | null)[] {
  return positions
    .filter((position) => !position.isArchived)
    .map((position) => position.names.en);
}

describeRls("administrar posiciones en Supabase", () => {
  it(
    "crea, renombra, reordena, archiva y reactiva",
    async () => {
      await withThrowawayClub(async (clubId) => {
        const gateway = positionsGateway();

        const created = await gateway.insertPosition(clubId, {
          en: null,
          es: "Centro",
        });
        if (created.kind !== "created") {
          throw new Error(`No se creó la posición: ${created.kind}`);
        }
        const target = { clubId, positionId: created.positionId };
        await expect(
          gateway.renamePosition(target, { en: "Centre", es: "Centro" }),
        ).resolves.toEqual({ kind: "renamed" });
        const [goalkeeper, defender, forward] = seededThree(
          await gateway.findClubPositions(clubId),
        );
        await expect(
          gateway.reorderPositions(clubId, [
            created.positionId,
            forward.id,
            defender.id,
            goalkeeper.id,
          ]),
        ).resolves.toEqual({ kind: "reordered" });
        await expect(
          gateway.setPositionArchived(
            { clubId, positionId: defender.id },
            true,
          ),
        ).resolves.toEqual({ kind: "changed" });

        expect(englishNames(await gateway.findClubPositions(clubId))).toEqual([
          "Centre",
          "Forward",
          "Goalkeeper",
        ]);
        await expect(
          gateway.setPositionArchived(
            { clubId, positionId: defender.id },
            false,
          ),
        ).resolves.toEqual({ kind: "changed" });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "guarda la función de cada posición y dice cuándo no cambió",
    async () => {
      await withThrowawayClub(async (clubId) => {
        const gateway = positionsGateway();
        const [, defender, forward] = seededThree(
          await gateway.findClubPositions(clubId),
        );

        await expect(
          gateway.setPositionCoverage(
            { clubId, positionId: forward.id },
            "defender",
          ),
        ).resolves.toEqual({ kind: "changed" });
        await expect(
          gateway.setPositionCoverage(
            { clubId, positionId: forward.id },
            "defender",
          ),
        ).resolves.toEqual({ kind: "unchanged" });
        await expect(
          gateway.setPositionCoverage(
            { clubId, positionId: defender.id },
            null,
          ),
        ).resolves.toEqual({ kind: "changed" });

        const positions = await gateway.findClubPositions(clubId);
        expect(positions.map((position) => position.coverage)).toEqual([
          "goalkeeper",
          null,
          "defender",
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dice en qué idioma se repite el nombre",
    async () => {
      await withThrowawayClub(async (clubId) => {
        const result = await positionsGateway().insertPosition(clubId, {
          en: "Centre",
          es: "ataque",
        });

        expect(result).toEqual({ kind: "name_taken", locale: "es" });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "no encuentra ni reordena lo que no es del club",
    async () => {
      await withThrowawayClub(async (clubId) => {
        const gateway = positionsGateway();
        const target = { clubId, positionId: randomUUID() };

        await expect(
          gateway.renamePosition(target, { en: "Centre", es: null }),
        ).resolves.toEqual({ kind: "not_found" });
        await expect(
          gateway.setPositionArchived(target, true),
        ).resolves.toEqual({ kind: "not_found" });
        await expect(
          gateway.setPositionCoverage(target, "forward"),
        ).resolves.toEqual({ kind: "not_found" });
        await expect(
          gateway.reorderPositions(clubId, [randomUUID()]),
        ).resolves.toEqual({ kind: "positions_changed" });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
