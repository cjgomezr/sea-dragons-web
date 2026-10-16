import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSeriesManagementGateways } from "@/lib/events/supabase-series-management-gateways";

/**
 * El adaptador de partir una serie (#653): qué le pasa a `split_series` y
 * cómo lee lo que responde. Lo que hace la función lo prueba su test de
 * migración (`split-series-migration.test.ts`).
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const SERIES_ID = "c6c6c6c6-0000-4000-8000-00000000000c";
const NEW_SERIES_ID = "c7c7c7c7-0000-4000-8000-00000000000c";
const FROM_ID = "f3f3f3f3-0000-4000-8000-00000000000f";

type Answer = { readonly data: unknown; readonly error: unknown };

type RecordedRpc = { readonly name: string; readonly args: unknown };

function fakeClient(answer: Answer): {
  readonly client: SupabaseClient;
  readonly rpcs: RecordedRpc[];
} {
  const rpcs: RecordedRpc[] = [];
  const client = {
    async rpc(name: string, args: unknown) {
      rpcs.push({ name, args });
      return answer;
    },
    // Las imágenes abren su bucket al cablearse; partir no lo usa.
    storage: { from: () => ({}) },
  };
  return { client: client as unknown as SupabaseClient, rpcs };
}

const SPLIT = {
  clubId: CLUB_ID,
  seriesId: SERIES_ID,
  fromOccurrenceId: FROM_ID,
  changes: { location: "Aquatic Centre" },
  schedule: null,
} as const;

describe("partir una serie contra Supabase", () => {
  it("llama a split_series con la sesión y los cambios en columnas", async () => {
    const { client, rpcs } = fakeClient({
      data: {
        outcome: "split",
        series_id: NEW_SERIES_ID,
        updated_occurrences: 3,
      },
      error: null,
    });

    const split =
      await createSeriesManagementGateways(client).managedSeries.splitSeries(
        SPLIT,
      );

    expect(split).toEqual({
      kind: "split",
      seriesId: NEW_SERIES_ID,
      updatedOccurrences: 3,
    });
    expect(rpcs).toEqual([
      {
        name: "split_series",
        args: {
          acting_club_id: CLUB_ID,
          target_series_id: SERIES_ID,
          from_event_id: FROM_ID,
          changes: { location: "Aquatic Centre" },
          schedule: null,
        },
      },
    ]);
  });

  it("pasa los días y las fechas nuevos en columnas (#654)", async () => {
    const { client, rpcs } = fakeClient({
      data: {
        outcome: "split",
        series_id: NEW_SERIES_ID,
        updated_occurrences: 4,
      },
      error: null,
    });

    await createSeriesManagementGateways(client).managedSeries.splitSeries({
      ...SPLIT,
      schedule: {
        weekdays: [1, 4],
        endsOn: "2027-07-29",
        sessionDates: ["2027-06-24", "2027-06-28"],
        addedDates: ["2027-06-28"],
      },
    });

    expect(rpcs[0]?.args).toMatchObject({
      schedule: {
        weekdays: [1, 4],
        ends_on: "2027-07-29",
        session_dates: ["2027-06-24", "2027-06-28"],
        added_dates: ["2027-06-28"],
      },
    });
  });

  it("lee la serie editada entera cuando la sesión era la primera", async () => {
    const { client } = fakeClient({
      data: {
        outcome: "edited",
        series_id: SERIES_ID,
        updated_occurrences: 2,
      },
      error: null,
    });

    const split =
      await createSeriesManagementGateways(client).managedSeries.splitSeries(
        SPLIT,
      );

    expect(split).toEqual({
      kind: "edited",
      seriesId: SERIES_ID,
      updatedOccurrences: 2,
    });
  });

  it.each(["occurrence_started", "session_not_in_series"] as const)(
    "lee el rechazo %s",
    async (outcome) => {
      const { client } = fakeClient({ data: { outcome }, error: null });

      const split =
        await createSeriesManagementGateways(client).managedSeries.splitSeries(
          SPLIT,
        );

      expect(split).toEqual({ kind: outcome });
    },
  );

  it("sube el error de la base con la serie y el club", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "violates foreign key constraint" },
    });

    const attempt =
      createSeriesManagementGateways(client).managedSeries.splitSeries(SPLIT);

    await expect(attempt).rejects.toThrow(
      `No se pudo partir la serie ${SERIES_ID} del club ${CLUB_ID}: violates foreign key constraint`,
    );
  });

  it("no acepta una respuesta con otra forma", async () => {
    const { client } = fakeClient({
      data: { outcome: "deleted" },
      error: null,
    });

    const attempt =
      createSeriesManagementGateways(client).managedSeries.splitSeries(SPLIT);

    await expect(attempt).rejects.toThrow();
  });
});

type RecordedFilter = readonly [string, string];

/** Un cliente que responde a una sola lectura de `events` y apunta sus
 * filtros. */
function fakeReadClient(answer: Answer): {
  readonly client: SupabaseClient;
  readonly filters: RecordedFilter[];
} {
  const filters: RecordedFilter[] = [];
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => answer,
  };
  const client = { from: () => query, storage: { from: () => ({}) } };
  return { client: client as unknown as SupabaseClient, filters };
}

const SESSION_QUERY = {
  clubId: CLUB_ID,
  seriesId: SERIES_ID,
  occurrenceId: FROM_ID,
} as const;

describe("el día de una sesión de una serie contra Supabase (#654)", () => {
  it("lo busca sólo en esa serie y en ese club", async () => {
    const { client, filters } = fakeReadClient({
      data: { starts_on: "2027-06-22" },
      error: null,
    });

    const day =
      await createSeriesManagementGateways(client).managedSeries.findSessionDay(
        SESSION_QUERY,
      );

    expect(day).toBe("2027-06-22");
    expect(filters).toEqual([
      ["club_id", CLUB_ID],
      ["series_id", SERIES_ID],
      ["id", FROM_ID],
    ]);
  });

  it("no encuentra una sesión de otra serie", async () => {
    const { client } = fakeReadClient({ data: null, error: null });

    const day =
      await createSeriesManagementGateways(client).managedSeries.findSessionDay(
        SESSION_QUERY,
      );

    expect(day).toBeNull();
  });

  it("sube el error de la base con la sesión y el club", async () => {
    const { client } = fakeReadClient({
      data: null,
      error: { message: "timeout" },
    });

    const attempt =
      createSeriesManagementGateways(client).managedSeries.findSessionDay(
        SESSION_QUERY,
      );

    await expect(attempt).rejects.toThrow(
      `No se pudo leer la sesión ${FROM_ID} de la serie ${SERIES_ID} del club ${CLUB_ID}: timeout`,
    );
  });
});
