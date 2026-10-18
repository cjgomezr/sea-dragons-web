import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ScreenOnly } from "@/components/ScreenOnly";

const PHONE_QUERY = "(width < 768px)";
const desktopMatchMedia = window.matchMedia;

function emulatePhone(): void {
  window.matchMedia = (query: string) => ({
    ...desktopMatchMedia(query),
    matches: query === PHONE_QUERY,
  });
}

afterEach(() => {
  window.matchMedia = desktopMatchMedia;
});

function BothScreens(): React.JSX.Element {
  return (
    <>
      <ScreenOnly screen="phone">
        <button type="button">En el móvil</button>
      </ScreenOnly>
      <ScreenOnly screen="desktop">
        <button type="button">En escritorio</button>
      </ScreenOnly>
    </>
  );
}

describe("ScreenOnly", () => {
  it("en escritorio pinta sólo lo de escritorio", () => {
    render(<BothScreens />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "En escritorio" }),
    ).toBeInTheDocument();
  });

  it("en el móvil pinta sólo lo del móvil", () => {
    emulatePhone();
    render(<BothScreens />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "En el móvil" }),
    ).toBeInTheDocument();
  });

  // El servidor no sabe el ancho: si adivinara, el otro tamaño vería la
  // cabecera sin botones hasta hidratar. La hoja de estilos esconde la copia
  // que sobra mientras tanto.
  it("en el servidor pinta los dos, porque no sabe el ancho", () => {
    const html = renderToString(<BothScreens />);

    expect(html).toContain("En el móvil");
    expect(html).toContain("En escritorio");
  });
});
