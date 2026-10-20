import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyGroups } from "@/components/account/MyGroups";
import type { MemberGroup } from "@/lib/groups/member-groups";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Grupos en el perfil propio (#229, #774). Enseña los nombres que le llegan,
 * en el orden en que le llegan, como fichas: qué grupos son y cómo se ordenan
 * lo decide el dominio.
 */

const MASTERS: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000002",
  name: "Masters Squad",
};
const SENIOR: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Senior Squad",
};

const ENGLISH = createTranslator("en");
const SPANISH = createTranslator("es");

describe("Grupos en el perfil propio", () => {
  it("enseña la tarjeta con los nombres de los grupos, en orden", () => {
    render(<MyGroups translate={ENGLISH} groups={[MASTERS, SENIOR]} />);

    const section = screen.getByRole("region", { name: "Groups" });
    const names = within(section)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(names).toEqual(["Masters Squad", "Senior Squad"]);
  });

  it("dice que el socio no tiene grupos cuando no tiene", () => {
    render(<MyGroups translate={ENGLISH} groups={[]} />);

    const section = screen.getByRole("region", { name: "Groups" });
    expect(within(section).queryByRole("list")).toBeNull();
    expect(within(section).getByText("No groups")).toBeInTheDocument();
  });

  it("sale en español con la aplicación en español", () => {
    render(<MyGroups translate={SPANISH} groups={[MASTERS]} />);

    expect(screen.getByRole("region", { name: "Grupos" })).toBeInTheDocument();
  });

  it("dice en español que no tiene ninguno", () => {
    render(<MyGroups translate={SPANISH} groups={[]} />);

    expect(screen.getByText("Sin grupos")).toBeInTheDocument();
  });
});
