import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";
import {
  clubSignInText,
  findSignInTextsIssues,
  NO_SIGN_IN_TEXTS,
  readSignInTexts,
  SIGN_IN_TAGLINE_MAX_LENGTH,
  SIGN_IN_WELCOME_MAX_LENGTH,
  type SignInTexts,
  type SignInTextsGateways,
  SignInTextsValidationError,
  toSignInTexts,
  updateSignInTexts,
} from "@/lib/club/sign-in-texts";

/**
 * Los textos del inicio de sesión que escribe el club (#301, RF-5 del PRD de
 * E18a): un lema y un párrafo por idioma. Un idioma sin texto no toma el del
 * otro: la pantalla cae al catálogo de la aplicación (D2).
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";

const SPANISH_ONLY: SignInTexts = {
  en: { tagline: null, welcome: null },
  es: { tagline: "Bajo el agua, juntos.", welcome: "Entrena con nosotros." },
};

type Fake = {
  readonly gateways: SignInTextsGateways;
  readonly writes: { clubId: string; texts: SignInTexts }[];
  readonly auditRows: AuditLogInsertRow[];
};

function fake(options: { callerRole?: Role; stored?: SignInTexts } = {}): Fake {
  const writes: Fake["writes"] = [];
  const auditRows: AuditLogInsertRow[] = [];
  let stored = options.stored ?? NO_SIGN_IN_TEXTS;
  const gateways: SignInTextsGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: options.callerRole ?? "Admin",
      }),
    },
    signInTexts: {
      findSignInTexts: async () => stored,
      replaceSignInTexts: async (clubId, texts) => {
        writes.push({ clubId, texts });
        stored = texts;
        return texts;
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
  return { gateways, writes, auditRows };
}

describe("textos del inicio de sesión", () => {
  describe("el texto del club en un idioma", () => {
    it("devuelve el que el club escribió en ese idioma", () => {
      expect(clubSignInText(SPANISH_ONLY, "es", "tagline")).toBe(
        "Bajo el agua, juntos.",
      );
    });

    it("no toma el del otro idioma cuando falta en éste", () => {
      expect(clubSignInText(SPANISH_ONLY, "en", "tagline")).toBeNull();
      expect(clubSignInText(SPANISH_ONLY, "en", "welcome")).toBeNull();
    });

    it("no devuelve nada en un club que no escribió ninguno", () => {
      expect(clubSignInText(NO_SIGN_IN_TEXTS, "es", "welcome")).toBeNull();
    });
  });

  describe("las filas de la base", () => {
    it("reparte cada fila en su idioma", () => {
      expect(
        toSignInTexts([
          { locale: "es", tagline: "Bajo el agua, juntos.", welcome: null },
        ]),
      ).toEqual({
        en: { tagline: null, welcome: null },
        es: { tagline: "Bajo el agua, juntos.", welcome: null },
      });
    });

    it("sin filas no hay textos del club", () => {
      expect(toSignInTexts([])).toEqual(NO_SIGN_IN_TEXTS);
    });

    it("falla con un idioma que la aplicación no habla", () => {
      expect(() =>
        toSignInTexts([{ locale: "fr", tagline: "Plongez.", welcome: null }]),
      ).toThrow(/fr/);
    });
  });

  describe("los límites", () => {
    it("acepta un lema y un párrafo justo en el límite", () => {
      const texts: SignInTexts = {
        en: {
          tagline: "a".repeat(SIGN_IN_TAGLINE_MAX_LENGTH),
          welcome: "b".repeat(SIGN_IN_WELCOME_MAX_LENGTH),
        },
        es: { tagline: null, welcome: null },
      };

      expect(findSignInTextsIssues(texts)).toEqual([]);
    });

    it("rechaza un lema de más de 140 caracteres, diciendo en qué idioma", () => {
      const texts: SignInTexts = {
        ...NO_SIGN_IN_TEXTS,
        es: { tagline: "a".repeat(141), welcome: null },
      };

      expect(findSignInTextsIssues(texts)).toEqual([
        { locale: "es", kind: "tagline", code: "tagline_too_long" },
      ]);
    });

    it("rechaza un párrafo de más de 320 caracteres", () => {
      const texts: SignInTexts = {
        ...NO_SIGN_IN_TEXTS,
        en: { tagline: null, welcome: "b".repeat(321) },
      };

      expect(findSignInTextsIssues(texts)).toEqual([
        { locale: "en", kind: "welcome", code: "welcome_too_long" },
      ]);
    });

    it("cuenta un emoji como un carácter, como Postgres", () => {
      const texts: SignInTexts = {
        ...NO_SIGN_IN_TEXTS,
        en: { tagline: "🐉".repeat(140), welcome: null },
      };

      expect(findSignInTextsIssues(texts)).toEqual([]);
    });

    it("mide el texto sin los espacios de los extremos", () => {
      const texts: SignInTexts = {
        ...NO_SIGN_IN_TEXTS,
        en: { tagline: `  ${"a".repeat(140)}  `, welcome: null },
      };

      expect(findSignInTextsIssues(texts)).toEqual([]);
    });
  });

  describe("guardarlos", () => {
    it("guarda los de cada idioma por separado", async () => {
      const { gateways, writes } = fake();
      const texts: SignInTexts = {
        en: { tagline: "Beneath the surface.", welcome: "Train with us." },
        es: {
          tagline: "Bajo la superficie.",
          welcome: "Entrena con nosotros.",
        },
      };

      const saved = await updateSignInTexts(gateways, {
        callerId: ADMIN_ID,
        texts,
      });

      expect(writes).toEqual([{ clubId: CLUB_ID, texts }]);
      expect(saved).toEqual(texts);
    });

    it("guarda un texto vacío o de sólo espacios como ninguno, para que vuelva el de la aplicación", async () => {
      const { gateways, writes } = fake({ stored: SPANISH_ONLY });

      await updateSignInTexts(gateways, {
        callerId: ADMIN_ID,
        texts: {
          en: { tagline: "", welcome: null },
          es: { tagline: "   ", welcome: "" },
        },
      });

      expect(writes[0]?.texts).toEqual(NO_SIGN_IN_TEXTS);
    });

    it("guarda el texto sin los espacios de los extremos", async () => {
      const { gateways, writes } = fake();

      await updateSignInTexts(gateways, {
        callerId: ADMIN_ID,
        texts: {
          ...NO_SIGN_IN_TEXTS,
          en: { tagline: "  Dive in.  ", welcome: null },
        },
      });

      expect(writes[0]?.texts.en.tagline).toBe("Dive in.");
    });

    it("no guarda nada si un texto se pasa del límite", async () => {
      const { gateways, writes } = fake();

      const saving = updateSignInTexts(gateways, {
        callerId: ADMIN_ID,
        texts: {
          ...NO_SIGN_IN_TEXTS,
          en: { tagline: "a".repeat(141), welcome: null },
        },
      });

      await expect(saving).rejects.toBeInstanceOf(SignInTextsValidationError);
      expect(writes).toEqual([]);
    });

    it("anota en la bitácora qué textos cambiaron, sin sus valores", async () => {
      const { gateways, auditRows } = fake({ stored: SPANISH_ONLY });

      await updateSignInTexts(gateways, {
        callerId: ADMIN_ID,
        texts: {
          en: { tagline: "Dive in.", welcome: null },
          es: SPANISH_ONLY.es,
        },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        action: "club.sign_in_texts_changed",
        entity_type: "club",
        entity_id: CLUB_ID,
        metadata: { fields: ["en.tagline"] },
      });
      expect(JSON.stringify(auditRows[0])).not.toContain("Dive in.");
    });

    it("no escribe ni anota nada si no cambió ningún texto", async () => {
      const { gateways, writes, auditRows } = fake({ stored: SPANISH_ONLY });

      const saved = await updateSignInTexts(gateways, {
        callerId: ADMIN_ID,
        texts: SPANISH_ONLY,
      });

      expect(saved).toEqual(SPANISH_ONLY);
      expect(writes).toEqual([]);
      expect(auditRows).toEqual([]);
    });

    it.each<Role>(["Coach", "Committee", "Player"])(
      "no deja a un %s cambiarlos",
      async (callerRole) => {
        const { gateways, writes } = fake({ callerRole });

        const saving = updateSignInTexts(gateways, {
          callerId: ADMIN_ID,
          texts: SPANISH_ONLY,
        });

        await expect(saving).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
        expect(writes).toEqual([]);
      },
    );
  });

  describe("leerlos para editarlos", () => {
    it("devuelve al Admin los guardados de su club", async () => {
      const { gateways } = fake({ stored: SPANISH_ONLY });

      await expect(
        readSignInTexts(gateways, { callerId: ADMIN_ID }),
      ).resolves.toEqual(SPANISH_ONLY);
    });

    it("no se los enseña a quien no es Admin", async () => {
      const { gateways } = fake({ callerRole: "Coach" });

      await expect(
        readSignInTexts(gateways, { callerId: ADMIN_ID }),
      ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
    });
  });
});
