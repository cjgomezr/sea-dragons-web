import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signProfilePhotoUrl,
  signProfilePhotoUrls,
} from "@/lib/members/supabase-profile-photo-gateways";

/**
 * La firma de las fotos contra un cliente de Supabase de mentira (#245). Lo
 * que se fija aquí es que una foto que Storage no firma (el fichero ya no
 * está) no tumba la lista entera: se registra y se deja fuera.
 */

const REAL_PATH = "4c1f2a9e-0000-4000-8000-000000000001/foto.png";
const MISSING_PATH = "4c1f2a9e-0000-4000-8000-000000000001/perdida.png";
const SIGNED_URL = "https://storage.test/sign/foto.png?token=t";

type SignedEntry = {
  readonly path: string | null;
  readonly signedUrl: string | null;
  readonly error: string | null;
};

function clientSigning(
  result:
    | { readonly data: readonly SignedEntry[]; readonly error: null }
    | { readonly data: null; readonly error: { message: string } },
): SupabaseClient {
  return {
    storage: {
      from: () => ({ createSignedUrls: async () => result }),
    },
  } as unknown as SupabaseClient;
}

const ONE_SIGNED_ONE_MISSING = clientSigning({
  data: [
    { path: REAL_PATH, signedUrl: SIGNED_URL, error: null },
    {
      path: MISSING_PATH,
      signedUrl: null,
      error: "Either the object does not exist or you do not have access to it",
    },
  ],
  error: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("firma de las fotos de perfil", () => {
  it("deja fuera la foto que Storage no firma y firma las demás", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const signed = await signProfilePhotoUrls(ONE_SIGNED_ONE_MISSING, [
      REAL_PATH,
      MISSING_PATH,
    ]);

    expect([...signed]).toEqual([[REAL_PATH, SIGNED_URL]]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(MISSING_PATH));
  });

  it("devuelve null para una sola foto que no se pudo firmar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      signProfilePhotoUrl(ONE_SIGNED_ONE_MISSING, MISSING_PATH),
    ).resolves.toBeNull();
  });

  it("lanza si falla la llamada entera", async () => {
    const client = clientSigning({
      data: null,
      error: { message: "Storage caído" },
    });

    await expect(signProfilePhotoUrls(client, [REAL_PATH])).rejects.toThrow(
      "Storage caído",
    );
  });

  it("no llama a Storage sin fotos que firmar", async () => {
    const createSignedUrls = vi.fn();
    const client = {
      storage: { from: () => ({ createSignedUrls }) },
    } as unknown as SupabaseClient;

    await expect(signProfilePhotoUrls(client, [])).resolves.toEqual(new Map());
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
