import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClubSocialLinks } from "@/components/ClubSocialLinks";
import { NO_SOCIAL_LINKS, type SocialLinks } from "@/lib/club/social-links";

/** Las redes del club (#964, RF-2 y RF-3 del PRD de E37): un icono por red
 * guardada, en el orden fijo de la lista, y nada si no hay ninguna. */

const CLUB_NAME = "Hobart Orcas";

const ALL_LINKS: SocialLinks = {
  instagram: "https://www.instagram.com/hobartorcas",
  tiktok: "https://www.tiktok.com/@hobartorcas",
  youtube: "https://www.youtube.com/@hobartorcas",
  facebook: "https://www.facebook.com/hobartorcas",
  whatsapp: "https://wa.me/61400000000",
  website: "https://hobartorcas.example",
};

describe("ClubSocialLinks", () => {
  it("sin redes no pinta nada", () => {
    const { container } = render(
      <ClubSocialLinks
        links={NO_SOCIAL_LINKS}
        clubName={CLUB_NAME}
        locale="en"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("con Instagram y YouTube pinta sólo esos dos, en una lista etiquetada", () => {
    render(
      <ClubSocialLinks
        links={{
          ...NO_SOCIAL_LINKS,
          youtube: ALL_LINKS.youtube,
          instagram: ALL_LINKS.instagram,
        }}
        clubName={CLUB_NAME}
        locale="en"
      />,
    );

    const list = screen.getByRole("list", { name: "Club social links" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(
      within(list).getByRole("link", { name: "Instagram of Hobart Orcas" }),
    ).toHaveAttribute("href", ALL_LINKS.instagram);
    expect(
      within(list).getByRole("link", { name: "YouTube of Hobart Orcas" }),
    ).toHaveAttribute("href", ALL_LINKS.youtube);
  });

  it("pinta las seis redes en el orden fijo de la lista", () => {
    render(
      <ClubSocialLinks links={ALL_LINKS} clubName={CLUB_NAME} locale="en" />,
    );

    const names = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label"));
    expect(names).toEqual([
      "Instagram of Hobart Orcas",
      "TikTok of Hobart Orcas",
      "YouTube of Hobart Orcas",
      "Facebook of Hobart Orcas",
      "WhatsApp of Hobart Orcas",
      "Website of Hobart Orcas",
    ]);
  });

  it("abre cada enlace en una pestaña nueva sin dar acceso a la ventana de origen", () => {
    render(
      <ClubSocialLinks links={ALL_LINKS} clubName={CLUB_NAME} locale="en" />,
    );

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("deja el icono fuera del lector de pantalla", () => {
    const { container } = render(
      <ClubSocialLinks links={ALL_LINKS} clubName={CLUB_NAME} locale="en" />,
    );

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(6);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("en español la lista y los enlaces se nombran en español", () => {
    render(
      <ClubSocialLinks
        links={{ ...NO_SOCIAL_LINKS, instagram: ALL_LINKS.instagram }}
        clubName="Victoria Seadragons"
        locale="es"
      />,
    );

    const list = screen.getByRole("list", { name: "Redes del club" });
    expect(
      within(list).getByRole("link", {
        name: "Instagram de Victoria Seadragons",
      }),
    ).toBeInTheDocument();
  });
});
