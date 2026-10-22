import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignMembers,
  loadGroupAudience,
} from "@/components/groups/groups-client";

/**
 * Los dos caminos de E32 que la pantalla Grupos pide a la API v1 (#827): el
 * alta masiva y la audiencia de un grupo.
 */

const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const ANA_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const INES_ID = "f5f5f5f5-0000-4000-8000-00000000000f";

const ANA = {
  id: ANA_ID,
  fullName: "Ana Active",
  isPendingActivation: false,
  positionName: null,
  photoUrl: null,
};

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alta masiva", () => {
  it("manda un solo POST con los ids y devuelve las listas y los rechazados", async () => {
    const fetchMock = respondWith(200, {
      data: {
        members: [ANA],
        candidates: [],
        rejected: [{ userId: INES_ID, reason: "inactive" }],
      },
    });

    const outcome = await assignMembers(GROUP_ID, [ANA_ID, INES_ID]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/groups/${GROUP_ID}/members`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ userIds: [ANA_ID, INES_ID] }),
      }),
    );
    expect(outcome).toEqual({
      kind: "assigned",
      members: [ANA],
      candidates: [],
      rejected: [{ userId: INES_ID, reason: "inactive" }],
    });
  });

  it("devuelve el fallo cuando el grupo ya no existe", async () => {
    respondWith(404, { error: { code: "not_found", message: "No existe." } });

    const outcome = await assignMembers(GROUP_ID, [ANA_ID]);

    expect(outcome).toMatchObject({ kind: "failed", failure: "not_found" });
  });
});

describe("audiencia", () => {
  it("devuelve los eventos y las noticias del grupo con sus totales", async () => {
    const audience = {
      events: {
        total: 6,
        items: [
          {
            kind: "series",
            id: "5e5e5e5e-0000-4000-8000-00000000005e",
            title: "Entrenamiento",
            weekdays: [3],
            startTime: "18:00",
            nextSession: {
              id: "5f5f5f5f-0000-4000-8000-00000000005f",
              startsOn: "2026-10-28",
            },
          },
          {
            kind: "event",
            id: "e1e1e1e1-0000-4000-8000-0000000000e1",
            title: "Torneo",
            startsOn: "2026-10-31",
            startTime: "09:30",
          },
        ],
      },
      posts: {
        total: 1,
        items: [
          {
            id: "a1a1a1a1-0000-4000-8000-0000000000a1",
            title: "Convocatoria",
            publishedAt: "2026-10-12T00:00:00.000Z",
          },
        ],
      },
    };
    const fetchMock = respondWith(200, { data: audience });

    const outcome = await loadGroupAudience(GROUP_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/groups/${GROUP_ID}/audience`,
      undefined,
    );
    expect(outcome).toEqual({ kind: "loaded", audience });
  });

  it("devuelve el fallo cuando el grupo ya no existe", async () => {
    respondWith(404, { error: { code: "not_found", message: "No existe." } });

    const outcome = await loadGroupAudience(GROUP_ID);

    expect(outcome).toMatchObject({ kind: "failed", failure: "not_found" });
  });
});
