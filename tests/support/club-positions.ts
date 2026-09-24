import { randomUUID } from "node:crypto";
import { type ServiceRoleClient, withSeededRows } from "./rls";

/**
 * Un club de usar y tirar con una posición archivada (#299). El club nace con
 * las tres de siempre (el trigger de `0025`) y se le añade al final una
 * cuarta, archivada y con nombre sólo en inglés: así un mismo club prueba el
 * orden, el archivo y el respaldo de idioma. Borrar el club se lleva sus
 * posiciones en cascada; los miembros que las usen tienen que irse antes.
 */

export const ARCHIVED_POSITION_NAME = "Utility";

/** Detrás de las tres sembradas (1, 2 y 3). */
const ARCHIVED_POSITION_SORT_ORDER = 4;

export type ClubWithArchivedPosition = {
  readonly clubId: string;
  readonly archivedPositionId: string;
};

async function insertOrFail(
  serviceClient: ServiceRoleClient,
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient.client
    .from(table)
    .insert(row)
    .select()
    .single();
  if (error) {
    throw new Error(`No se pudo sembrar ${table}: ${error.message}`);
  }
  return data;
}

export function withClubWithArchivedPosition<T>(
  serviceClient: ServiceRoleClient,
  run: (club: ClubWithArchivedPosition) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `posiciones-${randomUUID()}`, name: "Club de las posiciones" }],
    async ([club]) => {
      const clubId = club!.id as string;
      const position = await insertOrFail(serviceClient, "club_positions", {
        club_id: clubId,
        sort_order: ARCHIVED_POSITION_SORT_ORDER,
        archived_at: new Date().toISOString(),
      });
      const archivedPositionId = position.id as string;
      await insertOrFail(serviceClient, "club_position_names", {
        position_id: archivedPositionId,
        club_id: clubId,
        locale: "en",
        name: ARCHIVED_POSITION_NAME,
      });
      return run({ clubId, archivedPositionId });
    },
  );
}
