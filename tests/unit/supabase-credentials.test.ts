import { describe, expect, it } from "vitest";
import {
  SUPABASE_ANON_KEY_ENV,
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
} from "@/lib/supabase/config";
import { decideSupabaseCredentials } from "../support/supabase-credentials";

const CONFIGURED = {
  [SUPABASE_URL_ENV]: "https://club.supabase.co",
  [SUPABASE_ANON_KEY_ENV]: "anon-key",
  [SUPABASE_SERVICE_ROLE_KEY_ENV]: "service-role-key",
};

describe("credenciales de Supabase en la suite de tests", () => {
  it("están disponibles cuando las tres variables están presentes", () => {
    expect(decideSupabaseCredentials(CONFIGURED)).toEqual({
      kind: "available",
    });
  });

  // La URL falta en las dos configuraciones a la vez (anónima y de servicio) y
  // sólo se nombra una: un listado con duplicados hace dudar de si son dos
  // variables distintas.
  it("se saltan nombrando cada variable ausente, sin duplicados, fuera de CI", () => {
    const decision = decideSupabaseCredentials({});

    expect(decision).toEqual({
      kind: "skip",
      reason: `faltan variables de entorno de Supabase: ${SUPABASE_URL_ENV}, ${SUPABASE_ANON_KEY_ENV}, ${SUPABASE_SERVICE_ROLE_KEY_ENV}`,
    });
  });

  // El agujero que cerró el issue #149: un runner sin llaves no falla, se
  // salta las pruebas que las necesitan y el check sale verde sin haber
  // probado nada. Desde el #149 CI las tiene, así que faltar es un fallo.
  it("lanza en CI, donde saltarse sería una corrida verde que no probó nada", () => {
    expect(() => decideSupabaseCredentials({ CI: "true" })).toThrowError(
      new RegExp(SUPABASE_URL_ENV),
    );
  });

  // Desde el #536 el checks no recibe llaves de dev: las pone la acción del
  // Supabase local. El mensaje tiene que mandar a mirar ahí.
  it("en CI dice que las llaves las pone la acción del Supabase local", () => {
    expect(() => decideSupabaseCredentials({ CI: "true" })).toThrowError(
      /\.github\/actions\/supabase-local/,
    );
  });

  // Desde el #537 tampoco la visual: el mensaje no puede mandar a buscar
  // secretos de dev que ningún workflow pasa ya.
  it("en CI no manda a buscar las llaves en los secretos de seadragons-dev", () => {
    expect(() => decideSupabaseCredentials({ CI: "true" })).toThrowError(
      /^(?![\s\S]*seadragons-dev)/,
    );
  });

  it("sigue disponible en CI cuando las credenciales sí están", () => {
    expect(decideSupabaseCredentials({ ...CONFIGURED, CI: "true" })).toEqual({
      kind: "available",
    });
  });

  it("no confunde un CI vacío con estar en CI", () => {
    expect(decideSupabaseCredentials({ CI: "" }).kind).toBe("skip");
  });
});
