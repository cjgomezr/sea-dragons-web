import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileEvaluation } from "@/components/account/ProfileEvaluation";

/**
 * La sección de evaluación del perfil propio (#324, RF-5 del PRD de E9). Qué
 * le llega lo decide el dominio: aquí se prueba que un aviso se pinta como
 * aviso y una evaluación como evaluación, sin mezclar las dos.
 */

const MEMBER_ID = "cccccccc-0000-4000-8000-00000000000c";
const STAFF_ONLY_NOTICE =
  "Evaluation ratings are only visible to the coaching staff.";

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("notas privadas en el perfil", () => {
  it("a quien no ve evaluaciones le explica por qué no hay nota", () => {
    render(
      <ProfileEvaluation
        locale="en"
        evaluation={{ visibility: "staff_only" }}
      />,
    );

    const evaluation = section("Evaluation");
    expect(within(evaluation).getByText(STAFF_ONLY_NOTICE)).toBeVisible();
    expect(within(evaluation).queryByText("Overall score")).toBeNull();
    expect(within(evaluation).queryByRole("list")).toBeNull();
  });

  it("al personal de entrenamiento le enseña el OVR y las categorías, sin el aviso", () => {
    render(
      <ProfileEvaluation
        locale="en"
        evaluation={{
          visibility: "visible",
          evaluation: {
            status: "evaluated",
            memberId: MEMBER_ID,
            updatedAt: "2026-09-27T01:02:03.123456+00:00",
            overallRating: 7.5,
            ratings: [
              {
                categoryId: "ca7e0000-0000-4000-8000-000000000001",
                name: "Fitness",
                rating: 8,
                isRetired: false,
              },
              {
                categoryId: "ca7e0000-0000-4000-8000-000000000002",
                name: "Speed",
                rating: 7,
                isRetired: false,
              },
            ],
            isCurrent: true,
          },
        }}
      />,
    );

    const evaluation = section("Evaluation");
    expect(within(evaluation).getByText("7.5")).toBeVisible();
    const ratings = within(evaluation).getByRole("list", {
      name: "Skill ratings",
    });
    expect(
      within(ratings)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Fitness8 out of 10", "Speed7 out of 10"]);
    expect(within(evaluation).queryByText(STAFF_ONLY_NOTICE)).toBeNull();
    expect(within(evaluation).queryByRole("slider")).toBeNull();
  });

  it("dice que no hay evaluación en vez de inventar un OVR", () => {
    render(
      <ProfileEvaluation
        locale="en"
        evaluation={{
          visibility: "visible",
          evaluation: { status: "not_evaluated", memberId: MEMBER_ID },
        }}
      />,
    );

    const evaluation = section("Evaluation");
    expect(within(evaluation).getByText("No evaluation yet.")).toBeVisible();
    expect(within(evaluation).queryByText("Overall score")).toBeNull();
  });

  it("escribe el aviso en español", () => {
    render(
      <ProfileEvaluation
        locale="es"
        evaluation={{ visibility: "staff_only" }}
      />,
    );

    expect(
      within(section("Evaluación")).getByText(
        "Las notas de las evaluaciones solo las ve el personal de entrenamiento.",
      ),
    ).toBeVisible();
  });
});
