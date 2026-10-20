import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberRecordActions } from "@/components/directory/MemberRecordActions";
import { createTranslator } from "@/lib/i18n/translator";
import type {
  CoachMemberRecord,
  CommitteeMemberRecord,
} from "@/lib/members/member-record";

/**
 * Lo que sale a la derecha de la cabecera de la ficha según quién la lee
 * (#775, D3 del PRD de E30): el Committee escribe, llama y llama al contacto
 * de emergencia; el Coach sólo llama al de emergencia; el ⋯ es del Admin. La
 * vista del Admin se prueba en la pantalla entera
 * (`member-record-screen.test.tsx`); la del Committee y la del Coach las
 * pinta la pantalla con #776.
 */

const SHARED = {
  userId: "b1b1b1b1-0000-4000-8000-00000000000b",
  fullName: "Paula Player",
  photoUrl: null,
  role: "Player",
  positionName: null,
  experienceLevel: null,
  country: null,
  emergencyContact: {
    name: "Rosa Player",
    phone: "0499 111 222",
    relationship: "Mother",
  },
  membershipPlan: "Full",
  membershipStatus: "active",
  groups: [],
  membershipRenewsOn: null,
  attendance: null,
} as const satisfies Omit<CoachMemberRecord, "view">;

const COMMITTEE_READING: CommitteeMemberRecord = {
  ...SHARED,
  view: "committee",
  email: "paula@example.com",
  phone: "0412 345 678",
};

const COACH_READING: CoachMemberRecord = { ...SHARED, view: "coach" };

const ADMIN_MENU_LABEL = "More actions";

function renderActions(
  reading: CommitteeMemberRecord | CoachMemberRecord,
): void {
  render(
    <MemberRecordActions
      translate={createTranslator("en")}
      reading={reading}
      adminMenu={<button type="button">{ADMIN_MENU_LABEL}</button>}
    />,
  );
}

describe("las acciones de la cabecera de la ficha (#775)", () => {
  it("al Committee le da correo, llamada y contacto de emergencia", () => {
    renderActions(COMMITTEE_READING);

    expect(
      screen.getByRole("link", { name: "Email Paula Player" }),
    ).toHaveAttribute("href", "mailto:paula@example.com");
    expect(
      screen.getByRole("link", { name: "Call Paula Player" }),
    ).toHaveAttribute("href", "tel:0412345678");
    expect(
      screen.getByRole("link", {
        name: "Call Paula Player's emergency contact",
      }),
    ).toHaveAttribute("href", "tel:0499111222");
  });

  it("al Coach sólo le da el contacto de emergencia (D3)", () => {
    renderActions(COACH_READING);

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", {
        name: "Call Paula Player's emergency contact",
      }),
    ).toHaveAttribute("href", "tel:0499111222");
  });

  it("al Coach le dice que no hay contacto de emergencia", () => {
    renderActions({ ...COACH_READING, emergencyContact: null });

    expect(
      screen.getByRole("button", {
        name: "Call Paula Player's emergency contact (none)",
      }),
    ).toBeDisabled();
  });

  it.each([
    ["Committee", COMMITTEE_READING],
    ["Coach", COACH_READING],
  ] as const)("al %s no le da el ⋯", (_role, reading) => {
    renderActions(reading);

    expect(
      screen.queryByRole("button", { name: ADMIN_MENU_LABEL }),
    ).not.toBeInTheDocument();
  });
});
