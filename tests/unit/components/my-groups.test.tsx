import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyGroups } from "@/components/account/MyGroups";
import type { MemberGroup } from "@/lib/groups/member-groups";

/**
 * La sección Mis grupos de Mi cuenta (#229). Enseña los nombres que le llegan,
 * en el orden en que le llegan: qué grupos son y cómo se ordenan lo decide el
 * dominio.
 */

const MASTERS: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000002",
  name: "Masters Squad",
};
const SENIOR: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Senior Squad",
};

describe("Mi cuenta con grupos", () => {
  it("enseña la sección con los nombres de los grupos, en orden", () => {
    render(<MyGroups locale="en" groups={[MASTERS, SENIOR]} />);

    const section = screen.getByRole("region", { name: "My groups" });
    const names = within(section)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(names).toEqual(["Masters Squad", "Senior Squad"]);
  });

  it("dice que el socio no pertenece a ningún grupo cuando no tiene", () => {
    render(<MyGroups locale="en" groups={[]} />);

    const section = screen.getByRole("region", { name: "My groups" });
    expect(within(section).queryByRole("list")).toBeNull();
    expect(
      within(section).getByText("You don't belong to any group yet."),
    ).toBeInTheDocument();
  });

  it("sale en español con la aplicación en español", () => {
    render(<MyGroups locale="es" groups={[MASTERS]} />);

    expect(
      screen.getByRole("region", { name: "Mis grupos" }),
    ).toBeInTheDocument();
  });

  it("dice en español que no pertenece a ninguno", () => {
    render(<MyGroups locale="es" groups={[]} />);

    expect(
      screen.getByText("Todavía no perteneces a ningún grupo."),
    ).toBeInTheDocument();
  });
});
