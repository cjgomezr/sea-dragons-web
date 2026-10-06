import { describe, expect, it } from "vitest";
import { DEFAULT_DIRECTORY_QUERY } from "@/lib/directory/directory";
import {
  InvalidDirectoryQueryError,
  parseDirectoryQuery,
  writeDirectoryQuery,
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
      position: null,
      groupId: null,
      auf: null,
      membership: null,
      withoutPhone: false,
      withoutEmergencyContact: false,
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
    ["sort", "attendance"],
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
    ["una posición que no es un identificador", "position=Forward"],
    ["una posición vacía", "position="],
    ["un grupo que no es un identificador", "group=senior"],
    ["un grupo «none»", "group=none"],
    ["un AUF que no existe", "auf=soon"],
    ["una membresía que no existe", "membership=paid"],
    ["un sin teléfono que no es booleano", "withoutPhone=1"],
    ["un sin contacto de emergencia vacío", "withoutEmergencyContact="],
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

const POSITION_ID = "f0f0f0f0-0000-4000-8000-000000000003";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000001";

describe("los filtros de la consulta (#497)", () => {
  it("acepta una posición del catálogo por su identificador", () => {
    expect(parse(`position=${POSITION_ID}`).position).toEqual({
      kind: "position",
      positionId: POSITION_ID,
    });
  });

  it("acepta pedir a quien no tiene posición", () => {
    expect(parse("position=none").position).toEqual({ kind: "unassigned" });
  });

  it("acepta un grupo por su identificador", () => {
    expect(parse(`group=${GROUP_ID}`).groupId).toBe(GROUP_ID);
  });

  it.each(["missing", "expired", "expiring", "unverified"] as const)(
    "acepta el AUF %s",
    (auf) => {
      expect(parse(`auf=${auf}`).auf).toBe(auf);
    },
  );

  it.each([
    "pending",
    "trialing",
    "active",
    "past_due",
    "cancelled",
    "waived",
    "none",
  ] as const)("acepta la membresía %s", (membership) => {
    expect(parse(`membership=${membership}`).membership).toBe(membership);
  });
});

describe("los filtros de contacto de la consulta (#499)", () => {
  it.each(["withoutPhone", "withoutEmergencyContact"] as const)(
    "acepta %s como booleano",
    (parameter) => {
      expect(parse(`${parameter}=true`)[parameter]).toBe(true);
      expect(parse(`${parameter}=false`)[parameter]).toBe(false);
    },
  );
});

describe("la consulta escrita en la dirección (#497)", () => {
  it("no escribe nada de lo que ya es por defecto", () => {
    expect(writeDirectoryQuery(DEFAULT_DIRECTORY_QUERY).toString()).toBe("");
  });

  it("escribe cada filtro con el nombre y el valor que el endpoint lee", () => {
    const written = writeDirectoryQuery({
      ...DEFAULT_DIRECTORY_QUERY,
      search: "ana",
      role: "Player",
      sort: "attendance",
      direction: "desc",
      includeInactive: true,
      position: { kind: "unassigned" },
      groupId: GROUP_ID,
      auf: "expiring",
      membership: "past_due",
      withoutPhone: true,
      withoutEmergencyContact: true,
    });

    expect(Object.fromEntries(written)).toEqual({
      q: "ana",
      role: "Player",
      sort: "attendance",
      direction: "desc",
      includeInactive: "true",
      position: "none",
      group: GROUP_ID,
      auf: "expiring",
      membership: "past_due",
      withoutPhone: "true",
      withoutEmergencyContact: "true",
    });
  });

  it("vuelve a leer exactamente lo que escribió", () => {
    const query = {
      ...DEFAULT_DIRECTORY_QUERY,
      position: { kind: "position", positionId: POSITION_ID },
      membership: "none",
      auf: "unverified",
      withoutEmergencyContact: true,
    } as const;

    expect(parseDirectoryQuery(writeDirectoryQuery(query))).toEqual(query);
  });
});
