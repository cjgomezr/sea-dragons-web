import { describe, expect, it } from "vitest";
import {
  type MemberGroup,
  type MemberGroupsGateway,
  listMemberGroups,
} from "@/lib/groups/member-groups";

/**
 * Mis grupos (#229, RF-8 del PRD de E4): los grupos a los que pertenece quien
 * pregunta, y ninguno más. Quién pertenece a qué lo guarda la base; aquí se
 * decide a quién se pregunta y en qué orden sale.
 */

const CALLER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

const SENIOR: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Senior Squad",
};
const MASTERS: MemberGroup = {
  id: "5e000000-0000-4000-8000-000000000002",
  name: "Masters Squad",
};

type RecordingGateway = MemberGroupsGateway & {
  readonly askedFor: string[];
};

function gatewayReturning(groups: readonly MemberGroup[]): RecordingGateway {
  const askedFor: string[] = [];
  return {
    askedFor,
    listGroupsOf: async (userId) => {
      askedFor.push(userId);
      return groups;
    },
  };
}

describe("mis grupos", () => {
  it("devuelve los grupos del socio en orden alfabético", async () => {
    const gateway = gatewayReturning([SENIOR, MASTERS]);

    const groups = await listMemberGroups(gateway, CALLER_ID);

    expect(groups).toEqual([MASTERS, SENIOR]);
  });

  it("ordena sin distinguir mayúsculas", async () => {
    const juniors = {
      id: "5e000000-0000-4000-8000-000000000003",
      name: "juniors",
    };
    const gateway = gatewayReturning([SENIOR, juniors, MASTERS]);

    const groups = await listMemberGroups(gateway, CALLER_ID);

    expect(groups.map((group) => group.name)).toEqual([
      "juniors",
      "Masters Squad",
      "Senior Squad",
    ]);
  });

  it("devuelve una lista vacía cuando el socio no tiene grupos", async () => {
    const gateway = gatewayReturning([]);

    await expect(listMemberGroups(gateway, CALLER_ID)).resolves.toEqual([]);
  });

  it("pregunta sólo por los grupos de quien llama", async () => {
    const gateway = gatewayReturning([SENIOR]);

    await listMemberGroups(gateway, CALLER_ID);

    expect(gateway.askedFor).toEqual([CALLER_ID]);
  });

  it("no altera la lista que le entrega la base", async () => {
    const stored = [SENIOR, MASTERS];
    const gateway = gatewayReturning(stored);

    await listMemberGroups(gateway, CALLER_ID);

    expect(stored).toEqual([SENIOR, MASTERS]);
  });
});
