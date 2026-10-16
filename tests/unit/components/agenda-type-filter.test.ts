import { describe, expect, it } from "vitest";
import {
  AGENDA_TYPE_CHIPS,
  agendaRequestTypes,
  readAgendaTypeFilter,
  searchWithAgendaTypes,
  toggleAgendaType,
} from "@/components/calendar/agenda-type-filter";

/**
 * Los chips de tipo de la agenda (#647, RF-6 del PRD de E24) viven en la
 * dirección (`?types=`): recargar o volver atrás deja el mismo filtro.
 */

describe("readAgendaTypeFilter", () => {
  it("enciende todos los tipos cuando falta el parámetro", () => {
    expect(readAgendaTypeFilter(null)).toEqual(AGENDA_TYPE_CHIPS);
  });

  it("apaga todos los tipos cuando el parámetro llega vacío", () => {
    expect(readAgendaTypeFilter("")).toEqual([]);
  });

  it("lee los tipos en el orden de los chips, sin repetir", () => {
    expect(readAgendaTypeFilter("social,training,social")).toEqual([
      "training",
      "social",
    ]);
  });

  it("ignora un tipo desconocido y se queda con los válidos", () => {
    expect(readAgendaTypeFilter("foo,meeting")).toEqual(["meeting"]);
  });

  it("enciende todos cuando ninguno de los tipos existe", () => {
    expect(readAgendaTypeFilter("foo")).toEqual(AGENDA_TYPE_CHIPS);
  });
});

describe("toggleAgendaType", () => {
  it("apaga un tipo encendido", () => {
    expect(toggleAgendaType(AGENDA_TYPE_CHIPS, "meeting")).toEqual([
      "training",
      "competition",
      "social",
    ]);
  });

  it("enciende un tipo apagado en su sitio", () => {
    expect(toggleAgendaType(["social"], "training")).toEqual([
      "training",
      "social",
    ]);
  });
});

describe("searchWithAgendaTypes", () => {
  it("quita el parámetro con todos los tipos encendidos", () => {
    expect(
      searchWithAgendaTypes("?types=social&evento=x", AGENDA_TYPE_CHIPS),
    ).toBe("?evento=x");
  });

  it("escribe los tipos encendidos y deja los demás parámetros", () => {
    expect(searchWithAgendaTypes("?evento=x", ["training", "social"])).toBe(
      "?evento=x&types=training%2Csocial",
    );
  });

  it("deja el parámetro vacío con todos apagados", () => {
    expect(searchWithAgendaTypes("", [])).toBe("?types=");
  });

  it("devuelve una dirección sin consulta cuando no queda ningún parámetro", () => {
    expect(searchWithAgendaTypes("?types=social", AGENDA_TYPE_CHIPS)).toBe("");
  });
});

describe("agendaRequestTypes", () => {
  it("no pide tipos a la API con todos encendidos: es lo que da por defecto", () => {
    expect(agendaRequestTypes(AGENDA_TYPE_CHIPS)).toEqual([]);
  });

  it("pide los tipos encendidos cuando hay alguno apagado", () => {
    expect(agendaRequestTypes(["social"])).toEqual(["social"]);
  });
});
