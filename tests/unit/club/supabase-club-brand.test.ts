import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_SIGN_IN_TEXTS } from "@/lib/club/sign-in-texts";
import { NO_SOCIAL_LINKS } from "@/lib/club/social-links";

/**
 * La lectura de la marca trae también las redes del club (#964), en la misma
 * consulta y la misma caché. Aquí la consulta se sustituye por su respuesta:
 * la forma de verdad la prueba `supabase-club-brand.integration.test.ts`.
 */

type QueryResult = {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
};

const selectedColumns: string[] = [];
let queryResult: QueryResult = { data: null, error: null };

vi.mock("@/lib/supabase/service-client", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: (columns: string) => {
        selectedColumns.push(columns);
        return {
          eq: () => ({ single: async () => queryResult }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/club/supabase-club-logo-gateways", () => ({
  readClubLogoUrl: () => null,
}));

const { fetchClubBrandRow } = await import("@/lib/club/supabase-club-brand");

function storedRow(
  socialLinkRows: readonly { network: string; url: string }[],
): QueryResult {
  return {
    data: {
      name: "Hobart Orcas",
      initials: "HO",
      accentColor: "#7b3fa0",
      logoPath: null,
      signInTextRows: [],
      socialLinkRows,
    },
    error: null,
  };
}

beforeEach(() => {
  selectedColumns.length = 0;
});

describe("lectura de la marca con las redes del club", () => {
  it("pide las redes en la misma consulta que la marca", async () => {
    queryResult = storedRow([]);

    await fetchClubBrandRow({});

    expect(selectedColumns).toHaveLength(1);
    expect(selectedColumns[0]).toMatch(/club_social_links\(network, url\)/);
  });

  it("devuelve cada red guardada con su enlace y las demás sin enlace", async () => {
    queryResult = storedRow([
      { network: "youtube", url: "https://www.youtube.com/@hobartorcas" },
      { network: "instagram", url: "https://www.instagram.com/hobartorcas" },
    ]);

    const row = await fetchClubBrandRow({});

    expect(row).toEqual({
      name: "Hobart Orcas",
      initials: "HO",
      accentColor: "#7b3fa0",
      logoUrl: null,
      signInTexts: NO_SIGN_IN_TEXTS,
      socialLinks: {
        ...NO_SOCIAL_LINKS,
        instagram: "https://www.instagram.com/hobartorcas",
        youtube: "https://www.youtube.com/@hobartorcas",
      },
    });
  });

  it("sin redes guardadas devuelve la marca sin ninguna", async () => {
    queryResult = storedRow([]);

    expect((await fetchClubBrandRow({})).socialLinks).toEqual(NO_SOCIAL_LINKS);
  });

  // Quien decide pintar el respaldo y dejarlo en el log es la caché.
  it("lanza si la base no deja leer la marca ni las redes", async () => {
    queryResult = { data: null, error: { message: "permission denied" } };

    await expect(fetchClubBrandRow({})).rejects.toThrow(/permission denied/);
  });
});
