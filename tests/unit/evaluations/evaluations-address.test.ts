import { describe, expect, it } from "vitest";
import {
  readEvaluationsTab,
  readRosterView,
  searchWithEvaluationsTab,
  searchWithRosterView,
} from "@/lib/evaluations/evaluations-address";
import { DEFAULT_ROSTER_VIEW } from "@/lib/evaluations/roster-view";

/**
 * La pestaña, los filtros y el orden de Evaluaciones viven en la dirección
 * (#818, D8 del PRD de E31): `?tab=`, `?q=`, `?filtro=`, `?posicion=` y
 * `?orden=`. Lo que vale por defecto no se escribe.
 */

const POSITION_ID = "90510000-0000-4000-8000-000000000001";

describe("leer la dirección", () => {
  it("sin parámetros da la pestaña Jugadores y la vista por defecto", () => {
    const params = new URLSearchParams();

    expect(readEvaluationsTab(params)).toBe("players");
    expect(readRosterView(params)).toEqual(DEFAULT_ROSTER_VIEW);
  });

  it("lee la pestaña Categorías", () => {
    expect(readEvaluationsTab(new URLSearchParams("tab=categories"))).toBe(
      "categories",
    );
  });

  it("lee la búsqueda, la ficha, la posición y el orden", () => {
    const params = new URLSearchParams(
      `q=jose&filtro=sin-evaluar&posicion=${POSITION_ID}&orden=antigua`,
    );

    expect(readRosterView(params)).toEqual({
      search: "jose",
      filter: "not_evaluated",
      positionId: POSITION_ID,
      sort: "oldest",
    });
  });

  it("lee los dos órdenes por OVR", () => {
    expect(readRosterView(new URLSearchParams("orden=ovr-desc")).sort).toBe(
      "overall_desc",
    );
    expect(readRosterView(new URLSearchParams("orden=ovr-asc")).sort).toBe(
      "overall_asc",
    );
  });

  it("ante valores que no conoce se queda con los de por defecto", () => {
    const params = new URLSearchParams(
      "tab=otra&filtro=raro&orden=edad&posicion=",
    );

    expect(readEvaluationsTab(params)).toBe("players");
    expect(readRosterView(params)).toEqual(DEFAULT_ROSTER_VIEW);
  });
});

describe("escribir la dirección", () => {
  it("escribe sólo lo que no es por defecto y conserva los demás parámetros", () => {
    const search = searchWithRosterView(new URLSearchParams("miembro=abc"), {
      search: "josé",
      filter: "not_evaluated",
      positionId: POSITION_ID,
      sort: "overall_asc",
    });

    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      miembro: "abc",
      q: "josé",
      filtro: "sin-evaluar",
      posicion: POSITION_ID,
      orden: "ovr-asc",
    });
  });

  it("vuelve a la vista por defecto quitando sus parámetros", () => {
    const search = searchWithRosterView(
      new URLSearchParams("q=ana&filtro=sin-evaluar&orden=antigua"),
      DEFAULT_ROSTER_VIEW,
    );

    expect(search).toBe("");
  });

  it("escribe la pestaña Categorías y la quita al volver a Jugadores", () => {
    const withCategories = searchWithEvaluationsTab(
      new URLSearchParams("q=ana"),
      "categories",
    );
    expect(withCategories).toBe("?q=ana&tab=categories");

    expect(
      searchWithEvaluationsTab(new URLSearchParams(withCategories), "players"),
    ).toBe("?q=ana");
  });

  it("lo escrito se vuelve a leer igual", () => {
    const view = {
      search: "ana lima",
      filter: "all",
      positionId: null,
      sort: "overall_desc",
    } as const;

    expect(
      readRosterView(
        new URLSearchParams(searchWithRosterView(new URLSearchParams(), view)),
      ),
    ).toEqual(view);
  });
});
