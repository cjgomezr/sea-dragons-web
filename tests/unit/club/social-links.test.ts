import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { ClubSettingsForbiddenError } from "@/lib/club/club-settings";
import {
  isSameSocialLinks,
  NO_SOCIAL_LINKS,
  SOCIAL_LINK_MAX_LENGTH,
  SOCIAL_NETWORKS,
  type SocialLinks,
  type SocialLinksGateways,
  SocialLinksValidationError,
  type SocialNetwork,
  socialNetworkDomain,
  toSocialLinks,
  updateSocialLinks,
  validateSocialLinks,
} from "@/lib/club/social-links";

/**
 * Las redes del club (#963, RF-1 y D1 a D3 del PRD de E37): un enlace por
 * red, cada uno de su dominio, y vacío es "quitar esa red".
 */

function only(network: SocialNetwork, url: string | null): SocialLinks {
  return { ...NO_SOCIAL_LINKS, [network]: url };
}

function issuesOf(network: SocialNetwork, url: string): readonly string[] {
  const result = validateSocialLinks(only(network, url));
  return result.kind === "invalid"
    ? result.issues.map((issue) => `${issue.network}.${issue.code}`)
    : [];
}

function savedLink(network: SocialNetwork, url: string): string | null {
  const result = validateSocialLinks(only(network, url));
  if (result.kind === "invalid") {
    throw new Error(`Se esperaba válido: ${url}`);
  }
  return result.links[network];
}

describe("validateSocialLinks", () => {
  it("guarda las seis redes en este orden", () => {
    expect(SOCIAL_NETWORKS).toEqual([
      "instagram",
      "tiktok",
      "youtube",
      "facebook",
      "whatsapp",
      "website",
    ]);
  });

  it.each([
    ["instagram", "https://instagram.com/victoriaseadragons"],
    ["instagram", "https://www.instagram.com/victoriaseadragons"],
    ["instagram", "https://m.instagram.com/victoriaseadragons"],
    ["instagram", "https://WWW.Instagram.COM/victoriaseadragons"],
    ["tiktok", "https://www.tiktok.com/@seadragons"],
    ["tiktok", "https://vm.tiktok.com/ZMabc123/"],
    ["youtube", "https://www.youtube.com/@seadragons"],
    ["youtube", "https://m.youtube.com/watch?v=abc"],
    ["youtube", "https://youtu.be/abc"],
    ["facebook", "https://www.facebook.com/seadragons"],
    ["facebook", "https://m.facebook.com/seadragons"],
    ["facebook", "https://fb.com/seadragons"],
    ["whatsapp", "https://wa.me/61400000000"],
    ["whatsapp", "https://whatsapp.com/channel/0029VaABC"],
    ["whatsapp", "https://www.whatsapp.com/channel/0029VaABC"],
    ["website", "https://seadragons.org.au"],
    ["website", "https://www.example.com/club?x=1"],
  ] as const)("acepta en %s %s", (network, url) => {
    expect(issuesOf(network, url)).toEqual([]);
  });

  it.each([
    ["instagram", "https://instagram.com.evil.example/x"],
    ["instagram", "https://evilinstagram.com/x"],
    ["instagram", "https://www.tiktok.com/@seadragons"],
    ["instagram", "https://instagram.com@evil.example/x"],
    ["tiktok", "https://tiktok.co/@seadragons"],
    ["youtube", "https://youtube.com.evil.example/x"],
    ["facebook", "https://fb.me/seadragons"],
    ["whatsapp", "https://wa.me.evil.example/61400000000"],
  ] as const)("rechaza en %s otro dominio: %s", (network, url) => {
    expect(issuesOf(network, url)).toEqual([`${network}.wrong_domain`]);
  });

  it.each([
    "https://wa.me/",
    "https://wa.me/somebody",
    "https://whatsapp.com/",
    "https://whatsapp.com/channel/",
  ])("rechaza un enlace de WhatsApp sin número ni canal: %s", (url) => {
    expect(issuesOf("whatsapp", url)).toEqual(["whatsapp.wrong_domain"]);
  });

  it("rechaza un enlace de grupo de WhatsApp", () => {
    expect(issuesOf("whatsapp", "https://chat.whatsapp.com/AbCdEf123")).toEqual(
      ["whatsapp.whatsapp_group"],
    );
  });

  it.each([
    ["instagram", "http://instagram.com/victoriaseadragons"],
    ["website", "http://seadragons.org.au"],
    ["website", "seadragons.org.au"],
    ["website", "javascript:alert(1)"],
  ] as const)(
    "rechaza en %s lo que no empieza por https://: %s",
    (network, url) => {
      expect(issuesOf(network, url)).toEqual([`${network}.not_https`]);
    },
  );

  it("rechaza un https:// que no es un enlace", () => {
    expect(issuesOf("website", "https://")).toEqual(["website.not_a_link"]);
  });

  it("recorta los espacios de los extremos", () => {
    expect(
      savedLink("instagram", "  https://instagram.com/victoriaseadragons  "),
    ).toBe("https://instagram.com/victoriaseadragons");
  });

  it.each(["", "   ", null])("toma %j como quitar la red", (url) => {
    const result = validateSocialLinks(only("instagram", url));

    expect(result).toEqual({ kind: "valid", links: NO_SOCIAL_LINKS });
  });

  it("acepta 300 caracteres medidos tras recortar y rechaza 301", () => {
    const prefix = "https://example.com/";
    const atLimit = prefix + "a".repeat(SOCIAL_LINK_MAX_LENGTH - prefix.length);

    expect(issuesOf("website", `  ${atLimit}  `)).toEqual([]);
    expect(issuesOf("website", `${atLimit}a`)).toEqual(["website.too_long"]);
  });

  it("devuelve un aviso por cada red que no vale, en el orden de las redes", () => {
    const result = validateSocialLinks({
      ...NO_SOCIAL_LINKS,
      website: "http://example.com",
      instagram: "https://tiktok.com/x",
      youtube: "https://youtu.be/abc",
    });

    expect(result).toEqual({
      kind: "invalid",
      issues: [
        { network: "instagram", code: "wrong_domain" },
        { network: "website", code: "not_https" },
      ],
    });
  });
});

describe("socialNetworkDomain", () => {
  it.each([
    ["instagram", "instagram.com"],
    ["tiktok", "tiktok.com"],
    ["youtube", "youtube.com"],
    ["facebook", "facebook.com"],
    ["whatsapp", "wa.me"],
  ] as const)("nombra el dominio de %s como %s", (network, domain) => {
    expect(socialNetworkDomain(network)).toBe(domain);
  });
});

describe("toSocialLinks", () => {
  it("reparte las filas por red y deja las demás sin enlace", () => {
    expect(
      toSocialLinks([
        { network: "youtube", url: "https://youtu.be/abc" },
        { network: "website", url: "https://example.com" },
      ]),
    ).toEqual({
      ...NO_SOCIAL_LINKS,
      youtube: "https://youtu.be/abc",
      website: "https://example.com",
    });
  });

  it("falla con una red que la tabla no dejaría existir", () => {
    expect(() =>
      toSocialLinks([{ network: "myspace", url: "https://myspace.com" }]),
    ).toThrow(/myspace/);
  });
});

describe("isSameSocialLinks", () => {
  it("no ve cambio en espacios de los extremos ni en vacío frente a ninguno", () => {
    expect(
      isSameSocialLinks(
        {
          ...NO_SOCIAL_LINKS,
          instagram: " https://instagram.com/a ",
          tiktok: "",
        },
        { ...NO_SOCIAL_LINKS, instagram: "https://instagram.com/a" },
      ),
    ).toBe(true);
  });

  it("ve el cambio de un enlace", () => {
    expect(
      isSameSocialLinks(
        only("facebook", "https://fb.com/a"),
        only("facebook", "https://fb.com/b"),
      ),
    ).toBe(false);
  });
});

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const INSTAGRAM = "https://www.instagram.com/victoriaseadragons";

type Fake = {
  readonly gateways: SocialLinksGateways;
  readonly calls: string[];
  readonly auditRows: AuditLogInsertRow[];
};

function fake(options: { callerRole?: Role; stored?: SocialLinks } = {}): Fake {
  const calls: string[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  let stored = options.stored ?? NO_SOCIAL_LINKS;
  const gateways: SocialLinksGateways = {
    members: {
      findRoleRequestMember: async () => {
        calls.push("member");
        return {
          clubId: CLUB_ID,
          fullName: "Ana Admin",
          role: options.callerRole ?? "Admin",
        };
      },
    },
    socialLinks: {
      findClubIdBySlug: async () => CLUB_ID,
      findSocialLinks: async () => {
        calls.push("find");
        return stored;
      },
      replaceSocialLinks: async (_clubId, links) => {
        calls.push("replace");
        stored = links;
        return links;
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
        auditRows.push(row);
        return { error: null };
      },
    },
  };
  return { gateways, calls, auditRows };
}

describe("updateSocialLinks", () => {
  it("rechaza a un Committee sin escribir nada", async () => {
    const { gateways, calls, auditRows } = fake({ callerRole: "Committee" });

    await expect(
      updateSocialLinks(gateways, {
        callerId: ADMIN_ID,
        links: only("instagram", INSTAGRAM),
      }),
    ).rejects.toBeInstanceOf(ClubSettingsForbiddenError);
    expect(calls).not.toContain("replace");
    expect(auditRows).toEqual([]);
  });

  it("con un enlace que no vale falla antes de tocar la base", async () => {
    const { gateways, calls } = fake();

    await expect(
      updateSocialLinks(gateways, {
        callerId: ADMIN_ID,
        links: only("instagram", "https://tiktok.com/x"),
      }),
    ).rejects.toBeInstanceOf(SocialLinksValidationError);
    expect(calls).toEqual([]);
  });

  it("sin cambios no escribe ni anota", async () => {
    const { gateways, calls, auditRows } = fake({
      stored: only("instagram", INSTAGRAM),
    });

    await updateSocialLinks(gateways, {
      callerId: ADMIN_ID,
      links: only("instagram", `  ${INSTAGRAM}  `),
    });

    expect(calls).not.toContain("replace");
    expect(auditRows).toEqual([]);
  });

  it("anota las redes que cambiaron, sin los enlaces", async () => {
    const { gateways, auditRows } = fake({
      stored: only("tiktok", "https://www.tiktok.com/@seadragons"),
    });

    await updateSocialLinks(gateways, {
      callerId: ADMIN_ID,
      links: only("instagram", INSTAGRAM),
    });

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("club.social_links_changed");
    expect(auditRows[0]?.metadata).toEqual({
      networks: ["instagram", "tiktok"],
    });
    expect(JSON.stringify(auditRows[0])).not.toContain("https://");
  });
});
