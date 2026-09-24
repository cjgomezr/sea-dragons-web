import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  CLUB_SETTINGS_API_PATH,
  CLUB_SETTINGS_PATH,
  DASHBOARD_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  ClubIdentityUpdate,
  ClubSettings,
  ClubSettingsGateways,
} from "@/lib/club/club-settings";

/**
 * La configuración del club por la API (#296, RF-6 del PRD de E18a). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción: el 401 y el 403 son los de verdad.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const STORED: ClubSettings = {
  name: "Harbour Hammerheads",
  initials: "HH",
  accentColor: "#1c6ea4",
  logoPath: null,
};

const VALID_BODY = {
  name: "Bay Barracudas",
  initials: "BB",
  accentColor: STORED.accentColor,
  expected: {
    name: STORED.name,
    initials: STORED.initials,
    accentColor: STORED.accentColor,
  },
} as const;

const readSessionState = vi.fn();
const invalidateClubBrand = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let identityUpdate: ClubIdentityUpdate | null = null;

function clubSettingsGateways(): ClubSettingsGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    settings: {
      findClubSettings: async () => STORED,
      updateClubIdentity: async (_clubId, write) => {
        writes.push(`identity ${write.identity.name}`);
        return (
          identityUpdate ?? {
            kind: "updated",
            settings: { ...STORED, ...write.identity },
          }
        );
      },
    },
    audit: {
      insertAuditLogRow: async (row: AuditLogInsertRow) => {
        writes.push(`audit ${row.action}`);
        return { error: null };
      },
    },
  };
}

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => ADMIN_ID,
}));

vi.mock("@/lib/club/supabase-club-settings-gateways", () => ({
  createSupabaseClubSettingsGateways: () => ({
    kind: "ready",
    gateways: clubSettingsGateways(),
  }),
}));

vi.mock("@/lib/club/supabase-club-brand", () => ({
  invalidateClubBrand: () => invalidateClubBrand(),
}));

const { proxy } = await import("@/proxy");
const { GET, PATCH, POST } = await import("@/app/api/v1/club/settings/route");

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
}

async function throughBoundary(
  request: NextRequest,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(request)
    : boundaryResponse;
}

function patchSettings(body: unknown): Promise<Response> {
  const request = new NextRequest(new URL(CLUB_SETTINGS_API_PATH, ORIGIN), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return throughBoundary(request, PATCH);
}

function getSettings(): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(CLUB_SETTINGS_API_PATH, ORIGIN)),
    GET,
  );
}

async function errorOf(
  response: Response,
): Promise<{ code: string; reason?: string }> {
  const body = (await response.json()) as {
    error: { code: string; reason?: string };
  };
  return body.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  identityUpdate = null;
  givenSession({ kind: "active", role: "Admin" });
});

describe("endpoint de la configuración: GET", () => {
  it("responde 200 con la configuración del club a un Admin", async () => {
    const response = await getSettings();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: STORED });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await getSettings();

    expect(response.status).toBe(401);
    await expect(errorOf(response)).resolves.toMatchObject({
      code: "unauthenticated",
    });
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await getSettings();

      expect(response.status).toBe(403);
    },
  );
});

describe("endpoint de la configuración: PATCH", () => {
  it("responde 200 con lo guardado y anota el cambio", async () => {
    const response = await patchSettings(VALID_BODY);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { ...STORED, name: "Bay Barracudas", initials: "BB" },
    });
    expect(writes).toEqual([
      "identity Bay Barracudas",
      "audit club.settings_changed",
    ]);
  });

  it("invalida la caché de la marca después de guardar", async () => {
    await patchSettings(VALID_BODY);

    expect(invalidateClubBrand).toHaveBeenCalledOnce();
  });

  it("guarda un acento nuevo e invalida la caché de la marca", async () => {
    const response = await patchSettings({
      ...VALID_BODY,
      accentColor: "#7b3fa0",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { accentColor: "#7b3fa0" },
    });
    expect(invalidateClubBrand).toHaveBeenCalledTimes(1);
  });

  it("acepta quitar las iniciales con null", async () => {
    const response = await patchSettings({ ...VALID_BODY, initials: null });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { initials: null },
    });
  });

  it("responde 401 sin sesión y no escribe nada", async () => {
    givenSession({ kind: "anonymous" });

    const response = await patchSettings(VALID_BODY);

    expect(response.status).toBe(401);
    expect(writes).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "responde 403 a un %s sin escribir nada",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await patchSettings(VALID_BODY);

      expect(response.status).toBe(403);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: "forbidden",
      });
      expect(writes).toEqual([]);
    },
  );

  it.each([
    ["un nombre vacío", { name: "" }, "name_required"],
    ["un nombre de 61 caracteres", { name: "a".repeat(61) }, "name_too_long"],
    ["unas iniciales de 4", { initials: "ABCD" }, "initials_too_long"],
    // #294 (RF-3)
    ["un acento sin #", { accentColor: "7b3fa0" }, "accent_color_invalid"],
    [
      "un acento de tres cifras",
      { accentColor: "#7b3" },
      "accent_color_invalid",
    ],
    [
      "un acento con el que ningún texto llega a AA",
      { accentColor: "#7a7a7a" },
      "accent_color_no_readable_text",
    ],
    [
      "un acento ilegible sobre el fondo",
      { accentColor: "#ffd700" },
      "accent_color_unreadable_on_background",
    ],
  ])(
    "responde 400 a %s, con el campo en el motivo",
    async (_case, change, reason) => {
      const response = await patchSettings({ ...VALID_BODY, ...change });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toEqual(
        expect.objectContaining({ code: "validation_error", reason }),
      );
      expect(writes).toEqual([]);
      expect(invalidateClubBrand).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["sin el estado esperado", { name: "X", initials: null }],
    ["con un campo que no es de esta pantalla", { ...VALID_BODY, slug: "x" }],
    ["con el nombre como número", { ...VALID_BODY, name: 7 }],
    ["con el acento como número", { ...VALID_BODY, accentColor: 0x7b3fa0 }],
    ["sin el acento", { ...VALID_BODY, accentColor: undefined }],
  ])("responde 400 a un cuerpo %s", async (_case, body) => {
    const response = await patchSettings(body);

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("responde 409 si otro Admin guardó entretanto, sin anotar nada", async () => {
    identityUpdate = { kind: "changed_meanwhile" };

    const response = await patchSettings(VALID_BODY);

    expect(response.status).toBe(409);
    await expect(errorOf(response)).resolves.toMatchObject({
      code: "conflict",
      reason: "club_settings_changed",
    });
    expect(writes).toEqual(["identity Bay Barracudas"]);
    expect(invalidateClubBrand).not.toHaveBeenCalled();
  });

  it("no acepta otro método", async () => {
    const response = await POST(
      new NextRequest(new URL(CLUB_SETTINGS_API_PATH, ORIGIN), {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
  });
});

describe("la pantalla de configuración en la frontera", () => {
  function redirectedTo(response: Response): string | null {
    const location = response.headers.get("location");
    return location === null ? null : new URL(location).pathname;
  }

  function requestScreen(): Promise<Response> {
    return proxy(new NextRequest(new URL(CLUB_SETTINGS_PATH, ORIGIN)));
  }

  it("deja pasar a un Admin", async () => {
    const response = await requestScreen();

    expect(response.headers.get(CONTINUE_HEADER)).toBe("1");
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "manda al panel a un %s, como a cualquier pantalla que su rol no alcanza",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await requestScreen();

      expect(redirectedTo(response)).toBe(DASHBOARD_PATH);
    },
  );

  it("manda a iniciar sesión a quien no la tiene", async () => {
    givenSession({ kind: "anonymous" });

    const response = await requestScreen();

    expect(redirectedTo(response)).toBe(SIGN_IN_PATH);
  });
});
