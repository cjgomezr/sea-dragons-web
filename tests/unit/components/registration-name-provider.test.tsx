import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type HeroMember, ProfileHero } from "@/components/account/ProfileHero";
import {
  RegistrationNameProvider,
  useClubTranslator,
} from "@/components/club/RegistrationNameProvider";
import type { Locale } from "@/lib/i18n/locale";

/**
 * El nombre del registro del club llega a las pantallas de cliente por la
 * cáscara (#967, RF-7 de E37), y a la cabecera del perfil, que también se
 * pinta en el servidor, como prop.
 */

function RegistrationTitle({ locale }: { locale: Locale }): React.JSX.Element {
  const translate = useClubTranslator(locale);
  return <h2>{translate("memberRecord.auf.number")}</h2>;
}

const MEMBER: HeroMember = {
  userId: "b1b1b1b1-0000-4000-8000-00000000000b",
  fullName: "Nerea Ruiz",
  role: "Player",
  positionNames: null,
  experienceLevel: null,
  country: null,
  membershipStatus: "active",
  auf: { isVerified: false, isExpired: false },
  joinedOn: "2024-03-06",
  photoUrl: null,
};

describe("el nombre del registro en las pantallas", () => {
  it("escribe el nombre que pone la cáscara", () => {
    render(
      <RegistrationNameProvider name="Licencia FEDAS">
        <RegistrationTitle locale="es" />
      </RegistrationNameProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Número de Licencia FEDAS" }),
    ).toBeInTheDocument();
  });

  it("escribe la palabra por defecto si el club no tiene nombre", () => {
    render(
      <RegistrationNameProvider name={null}>
        <RegistrationTitle locale="en" />
      </RegistrationNameProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Registration number" }),
    ).toBeInTheDocument();
  });

  it("sin cáscara usa el respaldo de la marca, AUF", () => {
    render(<RegistrationTitle locale="en" />);

    expect(
      screen.getByRole("heading", { name: "AUF number" }),
    ).toBeInTheDocument();
  });

  it("pinta como texto, sin interpretarlo, un nombre que parece HTML", () => {
    render(
      <RegistrationNameProvider name="<b>FEDAS</b>">
        <RegistrationTitle locale="en" />
      </RegistrationNameProvider>,
    );

    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("<b>FEDAS</b> number");
    expect(heading.querySelector("b")).toBeNull();
  });

  it("la cabecera del perfil dice pendiente con el nombre que recibe", () => {
    render(
      <ProfileHero
        locale="en"
        isOwnProfile={false}
        registrationName="Licencia FEDAS"
        member={MEMBER}
      />,
    );

    expect(screen.getByText("Licencia FEDAS pending")).toBeInTheDocument();
  });
});
