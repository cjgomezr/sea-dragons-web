import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  CLUB_LOGO_BUCKET,
  readClubLogoUrl,
} from "@/lib/club/supabase-club-logo-gateways";

const SUPABASE_URL = "https://abc.supabase.co";

describe("la dirección del logo", () => {
  // Los correos llevan esta dirección tal cual: un cliente de correo no
  // resuelve rutas relativas ni inicia sesión para bajar una imagen.
  it("es absoluta y apunta a la parte pública del almacenamiento", () => {
    const client = createClient(SUPABASE_URL, "clave-anonima-de-mentira", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const logoUrl = readClubLogoUrl(client, "club-1/logo.png");

    expect(logoUrl).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/${CLUB_LOGO_BUCKET}/club-1/logo.png`,
    );
  });

  it("es null cuando el club no tiene logo", () => {
    const client = createClient(SUPABASE_URL, "clave-anonima-de-mentira", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    expect(readClubLogoUrl(client, null)).toBeNull();
  });
});
