import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import {
  type ClubIdentity,
  ClubSettingsConflictError,
  ClubSettingsForbiddenError,
  type ClubSettings,
  type ClubSettingsGateways,
  ClubSettingsValidationError,
  readClubSettings,
  updateClubSettings,
} from "@/lib/club/club-settings";

/**
 * La configuración del club (#296, RF-6 del PRD de E18a): el Admin lee y
 * cambia el nombre y las iniciales. Guardar escribe sólo si nadie cambió la
 * marca desde que la abrió, y la bitácora nombra los campos, nunca los
 * valores.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const STORED: ClubSettings = {
  name: "Harbour Hammerheads",
  initials: "HH",
  accentColor: "#1c6ea4",
  logoPath: null,
};

const LOADED: ClubIdentity = {
  name: STORED.name,
  initials: STORED.initials,
  accentColor: STORED.accentColor,
};

type FakeOptions = {
  readonly callerRole?: Role;
  readonly hasCaller?: boolean;
  /** Otro Admin guardó entre la lectura y esta escritura. */
  readonly changedMeanwhile?: boolean;
};

type Fake = {
  readonly gateways: ClubSettingsGateways;
  readonly writes: {
    clubId: string;
    expected: ClubIdentity;
    identity: ClubIdentity;
  }[];
  readonly reads: string[];
  readonly auditRows: AuditLogInsertRow[];
};

function fake(options: FakeOptions = {}): Fake {
  const writes: Fake["writes"] = [];
  const reads: string[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  let stored = STORED;
  const gateways: ClubSettingsGateways = {
    members: {
      findRoleRequestMember: async () => {
        reads.push("caller");
        return options.hasCaller === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Ana Admin",
              role: options.callerRole ?? "Admin",
            };
      },
    },
    settings: {
      findClubSettings: async (clubId) => {
        reads.push(`settings ${clubId}`);
        return stored;
      },
      updateClubIdentity: async (clubId, write) => {
        writes.push({ clubId, ...write });
        if (options.changedMeanwhile === true) {
          return { kind: "changed_meanwhile" };
        }
        stored = { ...stored, ...write.identity };
        return { kind: "updated", settings: stored };
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
  return { gateways, writes, reads, auditRows };
}

function submit(
  identity: Partial<ClubIdentity>,
  expected: ClubIdentity = LOADED,
): { identity: ClubIdentity; expected: ClubIdentity } {
  return { identity: { ...LOADED, ...identity }, expected };
}

describe("configuración del club: lectura", () => {
  it("devuelve el nombre, las iniciales, el acento y el logo del club de quien llama", async () => {
    const { gateways, reads } = fake();

    const settings = await readClubSettings(gateways, { callerId: ADMIN_ID });

    expect(settings).toEqual(STORED);
    expect(reads).toContain(`settings ${CLUB_ID}`);
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "no deja leerla a un %s",
    async (callerRole) => {
      const { gateways, reads } = fake({ callerRole });

      await expect(
        readClubSettings(gateways, { callerId: ADMIN_ID }),
      ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
      expect(reads).not.toContain(`settings ${CLUB_ID}`);
    },
  );

  it("no deja leerla a quien no es miembro de ningún club", async () => {
    const { gateways } = fake({ hasCaller: false });

    await expect(
      readClubSettings(gateways, { callerId: ADMIN_ID }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("configuración del club: guardar", () => {
  it("guarda el nombre nuevo sobre el estado que el Admin tenía delante", async () => {
    const { gateways, writes } = fake();

    const settings = await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ name: "Bay Barracudas" }),
    });

    expect(writes).toEqual([
      {
        clubId: CLUB_ID,
        expected: LOADED,
        identity: { ...LOADED, name: "Bay Barracudas" },
      },
    ]);
    expect(settings.name).toBe("Bay Barracudas");
  });

  it("guarda el nombre sin los espacios de los extremos", async () => {
    const { gateways, writes } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ name: "  Bay Barracudas  " }),
    });

    expect(writes[0]?.identity.name).toBe("Bay Barracudas");
  });

  it("guarda unas iniciales vacías como ninguna, para que se deriven del nombre", async () => {
    const { gateways, writes } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ initials: "  " }),
    });

    expect(writes[0]?.identity.initials).toBeNull();
  });

  it("anota en la bitácora quién cambió qué campos, sin los valores", async () => {
    const { gateways, auditRows } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ name: "Bay Barracudas", initials: "BB" }),
    });

    expect(auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "club.settings_changed",
        entity_type: "club",
        entity_id: CLUB_ID,
        result: "success",
        metadata: { fields: ["name", "initials"] },
      },
    ]);
    expect(JSON.stringify(auditRows)).not.toMatch(
      /Barracudas|"BB"|Hammerheads/,
    );
  });

  it("nombra sólo el campo que cambió", async () => {
    const { gateways, auditRows } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ initials: "HQ" }),
    });

    expect(auditRows[0]?.metadata).toEqual({ fields: ["initials"] });
  });

  it("no escribe ni anota nada si no cambió ningún campo", async () => {
    const { gateways, writes, auditRows } = fake();

    const settings = await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ name: ` ${LOADED.name} ` }),
    });

    expect(writes).toEqual([]);
    expect(auditRows).toEqual([]);
    expect(settings).toEqual(STORED);
  });

  it("devuelve un conflicto si otro Admin guardó entretanto, sin anotar nada", async () => {
    const { gateways, auditRows } = fake({ changedMeanwhile: true });

    await expect(
      updateClubSettings(gateways, {
        callerId: ADMIN_ID,
        submission: submit({ name: "Bay Barracudas" }),
      }),
    ).rejects.toBeInstanceOf(ClubSettingsConflictError);
    expect(auditRows).toEqual([]);
  });

  it.each<Role>(["Coach", "Committee", "Player"])(
    "no deja guardar a un %s",
    async (callerRole) => {
      const { gateways, writes } = fake({ callerRole });

      await expect(
        updateClubSettings(gateways, {
          callerId: ADMIN_ID,
          submission: submit({ name: "Bay Barracudas" }),
        }),
      ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
      expect(writes).toEqual([]);
    },
  );
});

describe("configuración del club: acento", () => {
  it("guarda el acento nuevo en minúsculas y anota el campo, sin el valor", async () => {
    const { gateways, writes, auditRows } = fake();

    const settings = await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ accentColor: "#7B3FA0" }),
    });

    expect(writes[0]?.identity.accentColor).toBe("#7b3fa0");
    expect(settings.accentColor).toBe("#7b3fa0");
    expect(auditRows[0]?.metadata).toEqual({ fields: ["accentColor"] });
  });

  it("el mismo acento en mayúsculas no cuenta como un cambio", async () => {
    const { gateways, writes } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ accentColor: LOADED.accentColor.toUpperCase() }),
    });

    expect(writes).toEqual([]);
  });
});

describe("configuración del club: validación", () => {
  it.each([
    ["un nombre vacío", { name: "" }, "name", "name_required"],
    ["un nombre de sólo espacios", { name: "   " }, "name", "name_required"],
    [
      "un nombre de más de 60 caracteres",
      { name: "a".repeat(61) },
      "name",
      "name_too_long",
    ],
    [
      "unas iniciales de más de 3 caracteres",
      { initials: "ABCD" },
      "initials",
      "initials_too_long",
    ],
    // #294 (RF-3): el acento.
    [
      "un acento que no es un hexadecimal",
      { accentColor: "purple" },
      "accentColor",
      "accent_color_invalid",
    ],
    [
      "un acento con el que ningún texto llega a AA",
      { accentColor: "#7a7a7a" },
      "accentColor",
      "accent_color_no_readable_text",
    ],
    [
      "un acento que no se lee sobre el fondo claro",
      { accentColor: "#ffd700" },
      "accentColor",
      "accent_color_unreadable_on_background",
    ],
  ] as const)(
    "rechaza %s junto a su campo, sin tocar la base",
    async (_case, identity, field, code) => {
      const { gateways, reads, writes } = fake();

      const attempt = updateClubSettings(gateways, {
        callerId: ADMIN_ID,
        submission: submit(identity),
      });

      await expect(attempt).rejects.toBeInstanceOf(ClubSettingsValidationError);
      await expect(attempt).rejects.toMatchObject({
        issues: [{ field, code }],
      });
      expect(reads).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it("acepta un nombre de exactamente 60 caracteres, contados sin los extremos", async () => {
    const { gateways, writes } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ name: ` ${"a".repeat(60)} ` }),
    });

    expect(writes[0]?.identity.name).toHaveLength(60);
  });

  it("cuenta como un carácter cada emoji del nombre", async () => {
    const { gateways, writes } = fake();

    await updateClubSettings(gateways, {
      callerId: ADMIN_ID,
      submission: submit({ name: "🐉".repeat(60) }),
    });

    expect(writes).toHaveLength(1);
  });
});
