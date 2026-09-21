import { describe, expect, it } from "vitest";
import { DEFAULT_DIRECTORY_QUERY } from "@/lib/directory/directory";
import {
  InvalidDirectoryQueryError,
  parseDirectoryQuery,
} from "@/lib/directory/directory-query";

/**
 * La consulta del directorio (#238): qué acepta `GET /api/v1/directory` y qué
 * rechaza antes de tocar la base.
 */

function parse(search: string): ReturnType<typeof parseDirectoryQuery> {
  return parseDirectoryQuery(new URLSearchParams(search));
}

describe("la consulta del directorio", () => {
  it("sin parámetros busca todo, por nombre ascendente y sin dados de baja", () => {
    expect(parse("")).toEqual({
      search: null,
      role: null,
      sort: "name",
      direction: "asc",
      includeInactive: false,
    });
    expect(DEFAULT_DIRECTORY_QUERY).toEqual(parse(""));
  });

  it("recorta la búsqueda y toma por vacía la que sólo trae espacios", () => {
    expect(parse("q=%20%20maria%20%20").search).toBe("maria");
    expect(parse("q=%20%20").search).toBeNull();
  });

  it.each(["Admin", "Coach", "Committee", "Player"] as const)(
    "acepta el filtro por %s",
    (role) => {
      expect(parse(`role=${role}`).role).toBe(role);
    },
  );

  it.each([
    ["sort", "role"],
    ["sort", "position"],
    ["direction", "desc"],
  ] as const)("acepta %s=%s", (parameter, value) => {
    expect(parse(`${parameter}=${value}`)).toMatchObject({
      [parameter]: value,
    });
  });

  it("acepta incluir a los dados de baja", () => {
    expect(parse("includeInactive=true").includeInactive).toBe(true);
    expect(parse("includeInactive=false").includeInactive).toBe(false);
  });

  it.each([
    ["un rol que no existe", "role=Trainer"],
    ["un rol con otra grafía", "role=coach"],
    ["un rol vacío", "role="],
    ["un orden que no existe", "sort=country"],
    ["una dirección que no existe", "direction=descending"],
    ["un incluir inactivos que no es booleano", "includeInactive=1"],
  ])("rechaza %s", (_case, search) => {
    expect(() => parse(search)).toThrow(InvalidDirectoryQueryError);
  });

  it("nombra en el mensaje los parámetros que están mal", () => {
    expect(() => parse("role=Trainer&sort=country")).toThrow(/role, sort/);
  });

  it("ignora los parámetros que no conoce", () => {
    expect(parse("page=2")).toEqual(DEFAULT_DIRECTORY_QUERY);
  });
});
