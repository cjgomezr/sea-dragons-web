import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  MemberRoleControl,
  type MemberRoleSaveResult,
  type RoleEditableMember,
  useRoleDrafts,
} from "@/components/directory/MemberRoleControl";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Los borradores de rol que comparten varios controles (#240). Hasta #549
 * vivían en cada fila del directorio y se probaban allí; la fila ya no cambia
 * el rol, pero la regla sigue: mientras se guarda un rol no sale ningún otro.
 */

const NEREA: RoleEditableMember = {
  userId: "b1b1b1b1-0000-4000-8000-00000000000b",
  fullName: "Nerea Ruiz",
  role: "Player",
};

const ANA: RoleEditableMember = {
  userId: "a0a0a0a0-0000-4000-8000-00000000000a",
  fullName: "Ana Admin",
  role: "Admin",
};

function TwoControls({
  onSave,
}: {
  onSave: () => Promise<MemberRoleSaveResult>;
}): React.JSX.Element {
  const translate = createTranslator("en");
  const drafts = useRoleDrafts(onSave);
  return (
    <>
      <MemberRoleControl translate={translate} member={NEREA} drafts={drafts} />
      <MemberRoleControl translate={translate} member={ANA} drafts={drafts} />
    </>
  );
}

describe("controles de rol que comparten borradores", () => {
  it("desactiva el botón de los demás miembros mientras un cambio está en curso", async () => {
    const user = userEvent.setup();
    let settle: (result: MemberRoleSaveResult) => void = () => undefined;
    render(
      <TwoControls
        onSave={() =>
          new Promise<MemberRoleSaveResult>((resolve) => {
            settle = resolve;
          })
        }
      />,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Role for Ana Admin" }),
      "Committee",
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Role for Nerea Ruiz" }),
      "Coach",
    );
    await user.click(
      screen.getByRole("button", { name: "Save the role for Nerea Ruiz" }),
    );

    expect(
      screen.getByRole("button", { name: "Save the role for Ana Admin" }),
    ).toBeDisabled();
    await act(async () => {
      settle("settled");
    });
  });
});
