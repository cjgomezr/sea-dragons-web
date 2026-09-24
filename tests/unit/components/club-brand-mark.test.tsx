import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClubBrandMark } from "@/components/ClubBrandMark";

/**
 * La marca del club con y sin logo (#295, RF-4 del PRD de E18a): el logo
 * sustituye al recuadro de iniciales, y si su dirección ya no sirve una
 * imagen vuelven las iniciales en vez de una imagen rota.
 */

const LOGO_URL = "https://storage.example.test/club-logos/club/logo.png";
const LOGO_ALT = "Harbour Hammerheads logo";

function renderMark(logoUrl: string | null): void {
  render(
    <ClubBrandMark
      logoUrl={logoUrl}
      logoAlt={LOGO_ALT}
      fallback={<span data-initials>HH</span>}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("la marca con y sin logo", () => {
  it("con logo pinta la imagen con su texto alternativo", () => {
    renderMark(LOGO_URL);

    expect(screen.getByRole("img", { name: LOGO_ALT })).toHaveAttribute(
      "src",
      LOGO_URL,
    );
    expect(screen.queryByText("HH")).not.toBeInTheDocument();
  });

  it("sin logo pinta las iniciales", () => {
    renderMark(null);

    expect(screen.getByText("HH")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("con la ruta rota vuelve a las iniciales", () => {
    renderMark(LOGO_URL);

    fireEvent.error(screen.getByRole("img", { name: LOGO_ALT }));

    expect(screen.getByText("HH")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("vuelve a probar cuando llega un logo nuevo después de uno roto", () => {
    const { rerender } = render(
      <ClubBrandMark logoUrl={LOGO_URL} logoAlt={LOGO_ALT} fallback="HH" />,
    );
    fireEvent.error(screen.getByRole("img"));

    rerender(
      <ClubBrandMark
        logoUrl={`${LOGO_URL}?nuevo`}
        logoAlt={LOGO_ALT}
        fallback="HH"
      />,
    );

    expect(screen.getByRole("img", { name: LOGO_ALT })).toBeInTheDocument();
  });

  // En la cabecera y en la pantalla de entrar la imagen la pinta el servidor:
  // si falla antes de que React hidrate, `onError` ya no llega.
  it("vuelve a las iniciales si la imagen ya estaba rota al montar", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      0,
    );

    renderMark(LOGO_URL);

    expect(screen.getByText("HH")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
