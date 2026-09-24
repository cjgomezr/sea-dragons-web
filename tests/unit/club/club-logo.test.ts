import { describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  CLUB_LOGO_MAX_BYTES,
  type ClubLogoGateways,
  ClubLogoValidationError,
  removeClubLogo,
  replaceClubLogo,
  validateClubLogoFile,
} from "@/lib/club/club-logo";
import {
  ClubSettingsConflictError,
  ClubSettingsForbiddenError,
} from "@/lib/club/club-settings";

/**
 * El logo del club (#295, RF-4 del PRD de E18a), contado sin Supabase. Sólo
 * el Admin lo sube o lo quita; sólo valen PNG y WebP de hasta 512 KB que se
 * puedan decodificar, y cambiarlo borra el fichero anterior.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const NEW_FILE_ID = "9b2e7d10-0000-4000-8000-0000000000aa";
const OLD_PATH = `${CLUB_ID}/logo-anterior.png`;
const PUBLIC_BASE = "https://storage.example.test/club-logos/";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const WEBP_BYTES = Uint8Array.from([
  ...Buffer.from("RIFF"),
  0x24,
  0x00,
  0x00,
  0x00,
  ...Buffer.from("WEBPVP8 "),
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SVG_BYTES = Uint8Array.from(Buffer.from("<svg xmlns='x'></svg>"));

type FakeOptions = {
  readonly callerRole?: Role;
  readonly logoPath?: string | null;
  readonly isUndecodable?: boolean;
  /** Otro Admin cambió el logo entre la lectura y esta escritura. */
  readonly changedMeanwhile?: boolean;
  readonly failsRemovingOld?: boolean;
};

type Fake = {
  readonly gateways: ClubLogoGateways;
  readonly stored: Set<string>;
  readonly uploads: { path: string; type: string }[];
  readonly savedPaths: (string | null)[];
  readonly auditRows: AuditLogInsertRow[];
};

function fake(options: FakeOptions = {}): Fake {
  const initialPath = options.logoPath ?? null;
  const stored = new Set(initialPath === null ? [] : [initialPath]);
  const uploads: Fake["uploads"] = [];
  const savedPaths: Fake["savedPaths"] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const gateways: ClubLogoGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: options.callerRole ?? "Admin",
      }),
    },
    logos: {
      findLogoPath: async () => initialPath,
      saveLogoPath: async (_clubId, write) => {
        if (options.changedMeanwhile === true) {
          return { kind: "changed_meanwhile" };
        }
        savedPaths.push(write.path);
        return { kind: "saved" };
      },
    },
    storage: {
      upload: async (path, _bytes, type) => {
        uploads.push({ path, type });
        stored.add(path);
      },
      remove: async (path) => {
        if (options.failsRemovingOld === true && path === initialPath) {
          throw new Error("Storage no contesta");
        }
        stored.delete(path);
      },
      publicUrl: (path) => `${PUBLIC_BASE}${path}`,
    },
    images: { isDecodable: async () => options.isUndecodable !== true },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
    newFileId: () => NEW_FILE_ID,
  };
  return { gateways, stored, uploads, savedPaths, auditRows };
}

function upload(
  fakeState: Fake,
  bytes: Uint8Array,
): ReturnType<typeof replaceClubLogo> {
  return replaceClubLogo(fakeState.gateways, { callerId: ADMIN_ID, bytes });
}

async function expectRejection(
  bytes: Uint8Array,
  code: string,
  options: FakeOptions = {},
): Promise<void> {
  const state = fake(options);

  const attempt = upload(state, bytes);

  await expect(attempt).rejects.toBeInstanceOf(ClubLogoValidationError);
  await expect(attempt).rejects.toMatchObject({ code });
  expect(state.uploads).toEqual([]);
  expect(state.savedPaths).toEqual([]);
}

describe("logo del club", () => {
  describe("tipo y tamaño", () => {
    it("acepta un PNG y lo guarda con su extensión", async () => {
      const state = fake();

      const logo = await upload(state, PNG_BYTES);

      expect(state.uploads).toEqual([
        { path: `${CLUB_ID}/${NEW_FILE_ID}.png`, type: "image/png" },
      ]);
      expect(logo).toEqual({
        logoUrl: `${PUBLIC_BASE}${CLUB_ID}/${NEW_FILE_ID}.png`,
      });
    });

    it("acepta un WebP y lo guarda con su extensión", async () => {
      const state = fake();

      await upload(state, WEBP_BYTES);

      expect(state.uploads).toEqual([
        { path: `${CLUB_ID}/${NEW_FILE_ID}.webp`, type: "image/webp" },
      ]);
    });

    it("rechaza un JPEG sin guardar nada", async () => {
      await expectRejection(JPEG_BYTES, "logo_type_unsupported");
    });

    it("rechaza un SVG sin guardar nada", async () => {
      await expectRejection(SVG_BYTES, "logo_type_unsupported");
    });

    it("rechaza un fichero vacío", async () => {
      await expectRejection(new Uint8Array(), "logo_empty");
    });

    it("rechaza un logo de más de 512 KB", async () => {
      const heavy = new Uint8Array(CLUB_LOGO_MAX_BYTES + 1);
      heavy.set(PNG_BYTES);

      await expectRejection(heavy, "logo_too_large");
    });

    it("acepta un logo de 512 KB justos", async () => {
      const exact = new Uint8Array(CLUB_LOGO_MAX_BYTES);
      exact.set(PNG_BYTES);
      const state = fake();

      await upload(state, exact);

      expect(state.uploads).toHaveLength(1);
    });

    it("rechaza un PNG que no se puede decodificar", async () => {
      await expectRejection(PNG_BYTES, "logo_undecodable", {
        isUndecodable: true,
      });
    });
  });

  describe("comprobación previa en la pantalla", () => {
    it("deja pasar un PNG de hasta 512 KB", () => {
      expect(
        validateClubLogoFile({ type: "image/png", size: CLUB_LOGO_MAX_BYTES }),
      ).toBeNull();
    });

    it("avisa de un JPEG antes de subirlo", () => {
      expect(validateClubLogoFile({ type: "image/jpeg", size: 10 })).toBe(
        "logo_type_unsupported",
      );
    });

    it("avisa de un logo que pesa de más antes de subirlo", () => {
      expect(
        validateClubLogoFile({
          type: "image/webp",
          size: CLUB_LOGO_MAX_BYTES + 1,
        }),
      ).toBe("logo_too_large");
    });

    it("avisa de un fichero vacío antes de subirlo", () => {
      expect(validateClubLogoFile({ type: "image/png", size: 0 })).toBe(
        "logo_empty",
      );
    });
  });

  describe("sustitución", () => {
    it("apunta el logo nuevo en el club y borra el anterior", async () => {
      const state = fake({ logoPath: OLD_PATH });

      await upload(state, PNG_BYTES);

      expect(state.savedPaths).toEqual([`${CLUB_ID}/${NEW_FILE_ID}.png`]);
      expect([...state.stored]).toEqual([`${CLUB_ID}/${NEW_FILE_ID}.png`]);
    });

    it("anota el cambio en la bitácora sin la ruta del fichero", async () => {
      const state = fake({ logoPath: OLD_PATH });

      await upload(state, PNG_BYTES);

      expect(state.auditRows).toEqual([
        expect.objectContaining({
          action: "club.settings_changed",
          entity_type: "club",
          entity_id: CLUB_ID,
          metadata: { fields: ["logo"] },
        }),
      ]);
    });

    it("si otro Admin cambió el logo entretanto, borra el recién subido y avisa del conflicto", async () => {
      const state = fake({ logoPath: OLD_PATH, changedMeanwhile: true });

      await expect(upload(state, PNG_BYTES)).rejects.toBeInstanceOf(
        ClubSettingsConflictError,
      );
      expect([...state.stored]).toEqual([OLD_PATH]);
      expect(state.auditRows).toEqual([]);
    });

    it("no deshace el cambio si el anterior no se pudo borrar", async () => {
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const state = fake({ logoPath: OLD_PATH, failsRemovingOld: true });

      const logo = await upload(state, PNG_BYTES);

      expect(logo.logoUrl).toContain(NEW_FILE_ID);
      expect(report).toHaveBeenCalledWith(
        expect.stringContaining(OLD_PATH),
        expect.any(Error),
      );
      report.mockRestore();
    });
  });

  describe("retirada", () => {
    it("deja el club sin logo y borra el fichero", async () => {
      const state = fake({ logoPath: OLD_PATH });

      const logo = await removeClubLogo(state.gateways, { callerId: ADMIN_ID });

      expect(logo).toEqual({ logoUrl: null });
      expect(state.savedPaths).toEqual([null]);
      expect(state.stored.size).toBe(0);
      expect(state.auditRows).toEqual([
        expect.objectContaining({ metadata: { fields: ["logo"] } }),
      ]);
    });

    it("sin logo no escribe ni anota nada", async () => {
      const state = fake();

      await removeClubLogo(state.gateways, { callerId: ADMIN_ID });

      expect(state.savedPaths).toEqual([]);
      expect(state.auditRows).toEqual([]);
    });

    it("si otro Admin cambió el logo entretanto, no borra nada", async () => {
      const state = fake({ logoPath: OLD_PATH, changedMeanwhile: true });

      await expect(
        removeClubLogo(state.gateways, { callerId: ADMIN_ID }),
      ).rejects.toBeInstanceOf(ClubSettingsConflictError);
      expect([...state.stored]).toEqual([OLD_PATH]);
    });
  });

  describe("quién puede", () => {
    it.each<Role>(["Coach", "Committee", "Player"])(
      "a un %s no le deja subir el logo",
      async (role) => {
        const state = fake({ callerRole: role });

        await expect(upload(state, PNG_BYTES)).rejects.toBeInstanceOf(
          ClubSettingsForbiddenError,
        );
        expect(state.uploads).toEqual([]);
      },
    );

    it.each<Role>(["Coach", "Committee", "Player"])(
      "a un %s no le deja quitar el logo",
      async (role) => {
        const state = fake({ callerRole: role, logoPath: OLD_PATH });

        await expect(
          removeClubLogo(state.gateways, { callerId: ADMIN_ID }),
        ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        expect([...state.stored]).toEqual([OLD_PATH]);
      },
    );
  });
});
