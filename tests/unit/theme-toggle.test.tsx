import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// Applying the stored theme on load belongs to ThemeScript, which runs before
// hydration; its end-to-end proof is the reload test in tests/theme.spec.ts.
// What this component owns is reading the stored choice and flipping it.
describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("reflects the stored theme in its pressed state", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    render(<ThemeToggle locale="en" />);

    expect(screen.getByRole("button", { pressed: true })).toBeInTheDocument();
  });

  it("applies the chosen theme to the document when activated", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle locale="en" />);

    await user.click(screen.getByRole("button"));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists the chosen theme so it survives a reload", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle locale="en" />);

    await user.click(screen.getByRole("button"));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("updates its accessible name to describe the next action", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle locale="en" />);
    expect(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button"));

    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeInTheDocument();
  });

  // E17: el nombre accesible es texto que alguien escucha, así que sale del
  // catálogo como el resto de la interfaz.
  it("describes the next action in Spanish when the locale is Spanish", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle locale="es" />);
    expect(
      screen.getByRole("button", { name: "Cambiar a tema oscuro" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button"));

    expect(
      screen.getByRole("button", { name: "Cambiar a tema claro" }),
    ).toBeInTheDocument();
  });
});
