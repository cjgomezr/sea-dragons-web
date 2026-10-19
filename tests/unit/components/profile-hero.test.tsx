import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type HeroMember, ProfileHero } from "@/components/account/ProfileHero";

/**
 * La cabecera que comparten el perfil propio y la ficha de un socio (#771,
 * RF-2 del PRD de E30). Lo que cambia según quien mira es la ficha del AUF:
 * Committee y Coach no ven el AUF (D1, D3), así que para ellos llega null.
 */

const MEMBER: HeroMember = {
  userId: "b1b1b1b1-0000-4000-8000-00000000000b",
  fullName: "Nerea Ruiz",
  role: "Coach",
  positionNames: null,
  experienceLevel: null,
  country: null,
  membershipStatus: "active",
  auf: { isVerified: false, isExpired: false },
  joinedOn: "2024-03-06",
  photoUrl: null,
};

function renderHero(
  member: Partial<HeroMember> = {},
  locale: "en" | "es" = "en",
): HTMLElement {
  render(
    <ProfileHero
      locale={locale}
      isOwnProfile={false}
      member={{ ...MEMBER, ...member }}
    />,
  );
  return screen.getByRole("banner");
}

describe("la cabecera del perfil", () => {
  it("muestra el nombre, sus iniciales y el rol", () => {
    const header = renderHero();

    expect(
      within(header).getByRole("heading", { level: 1, name: "Nerea Ruiz" }),
    ).toBeInTheDocument();
    expect(within(header).getByText("NR")).toBeInTheDocument();
    expect(within(header).getByText("Coach")).toBeInTheDocument();
  });

  it("nombra el rol en el idioma de la visita", () => {
    const header = renderHero({ role: "Player" }, "es");

    expect(within(header).getByText("Jugador")).toBeInTheDocument();
  });

  it("sin posición, experiencia ni país no pinta la línea vacía", () => {
    const header = renderHero();

    expect(within(header).queryByText(/·/)).not.toBeInTheDocument();
  });

  it("para Committee y Coach no lleva la ficha del AUF", () => {
    const header = renderHero({ auf: null });

    expect(within(header).queryByText(/AUF/)).not.toBeInTheDocument();
    expect(within(header).getByText("Membership active")).toBeInTheDocument();
    expect(
      within(header).getByText("Member since March 2024"),
    ).toBeInTheDocument();
  });

  it("marca el AUF vencido además de su verificación", () => {
    const header = renderHero({ auf: { isVerified: true, isExpired: true } });

    expect(within(header).getByText("AUF verified")).toBeInTheDocument();
    expect(within(header).getByText("AUF expired")).toBeInTheDocument();
  });

  it("dice que no tiene membresía quien no la tiene", () => {
    const header = renderHero({ membershipStatus: null });

    expect(within(header).getByText("No membership")).toBeInTheDocument();
  });
});
