import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDashboard } from "@/components/dashboard/dashboard-client";

/**
 * Lo que la pantalla de inicio lee de `GET /api/v1/dashboard`. Las teselas,
 * los próximos y el próximo entrenamiento del inicio de E14 salieron de la
 * respuesta con #752 (RF-10): si alguien los vuelve a poner en el esquema,
 * la pantalla los dejaría pasar y estos tests fallan.
 */

const RETIRED_FIELDS = ["tiles", "upcomingEvents", "nextTraining"] as const;

const RETIRED_PARTS = {
  tiles: {
    attendance: { kind: "unavailable" },
    members: { kind: "unavailable" },
    nextTraining: { kind: "none" },
    unreadNews: { kind: "unavailable" },
  },
  upcomingEvents: { kind: "events", events: [] },
  nextTraining: { kind: "none" },
};

const PLAYER_PAYLOAD = {
  kind: "member",
  column: "player",
  viewer: { firstName: "Alba" },
  me: { attendance: null },
  latestNews: { kind: "news", posts: [] },
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: { kind: "none" },
  week: { kind: "week", events: [] },
  membership: { status: "active", plan: "Full", renewsOn: null },
};

const RESTRICTED_PAYLOAD = {
  kind: "restricted",
  viewer: { firstName: "Alba" },
  me: { attendance: null },
  block: "past_due",
  contactReminder: { kind: "reminder", reminder: "none" },
  nextUp: { kind: "none" },
  week: { kind: "week", events: [] },
  membership: { status: "restricted", block: "past_due", endedOn: null },
  latestNews: { kind: "news", posts: [] },
};

function serve(payload: object): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: payload }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el inicio que lee la pantalla (#752)", () => {
  it.each([
    ["socio", PLAYER_PAYLOAD],
    ["restringido", RESTRICTED_PAYLOAD],
  ])("carga el inicio de %s sin los campos retirados", async (_, payload) => {
    serve(payload);

    const loaded = await loadDashboard();

    expect(loaded).toMatchObject({ kind: "loaded", dashboard: payload });
  });

  it.each([
    ["socio", PLAYER_PAYLOAD],
    ["restringido", RESTRICTED_PAYLOAD],
  ])(
    "no deja pasar tiles, upcomingEvents ni nextTraining al inicio de %s",
    async (_, payload) => {
      serve({ ...payload, ...RETIRED_PARTS });

      const loaded = await loadDashboard();

      if (loaded.kind !== "loaded") {
        throw new Error(`El inicio no cargó: ${loaded.failure}`);
      }
      for (const field of RETIRED_FIELDS) {
        expect(loaded.dashboard).not.toHaveProperty(field);
      }
    },
  );
});
