import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/AccountMenu";
import {
  ACCOUNT_PAGE_PATH,
  CLUB_SETTINGS_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { LOCALE_COOKIE_NAME, type Locale } from "@/lib/i18n/locale";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * El menú de la cuenta (#287): Mi perfil, Apariencia, Idioma y Cerrar sesión
 * detrás de un solo botón de la cabecera. Cerrar con Escape, pulsando fuera o
 * cuando el foco sale sigue al panel de avisos (#266).
 */

const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

function renderMenu(
  locale: Locale = "en",
  canConfigureClub = false,
): ReturnType<typeof render> {
  return render(
    <AccountMenu locale={locale} canConfigureClub={canConfigureClub} />,
  );
}

function accountButton(name = "My account"): HTMLElement {
  return screen.getByRole("button", { name });
}

function queryMenu(name = "My account"): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

async function openMenu(name = "My account"): Promise<HTMLElement> {
  await userEvent.click(accountButton(name));
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.cookie = `${LOCALE_COOKIE_NAME}=; max-age=0; path=/`;
  replace.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("menú de la cuenta", () => {
  it("empieza cerrado y lo dice", () => {
    renderMenu();

    expect(queryMenu()).toBeNull();
    expect(accountButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("se abre al pulsar el botón de la cuenta y lo dice", async () => {
    renderMenu();

    await openMenu();

    expect(accountButton()).toHaveAttribute("aria-expanded", "true");
  });

  it("ofrece Mi perfil, Apariencia, Idioma y Cerrar sesión, en ese orden", async () => {
    renderMenu();

    const menu = await openMenu();
    const entries = within(menu).getAllByRole("listitem");

    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveTextContent("My profile");
    expect(entries[1]).toHaveTextContent("Appearance");
    expect(entries[2]).toHaveTextContent("Language");
    expect(entries[3]).toHaveTextContent("Sign out");
  });

  it("ofrece la configuración del club justo después de Mi perfil a quien puede cambiarla (#296)", async () => {
    renderMenu("en", true);

    const menu = await openMenu();
    const entries = within(menu).getAllByRole("listitem");

    expect(entries).toHaveLength(5);
    const settings = within(menu).getByRole("link", { name: "Club settings" });
    expect(settings).toHaveAttribute("href", CLUB_SETTINGS_PATH);
    expect(entries[1]).toContainElement(settings);
  });

  it("no ofrece la configuración del club a quien no puede cambiarla", async () => {
    renderMenu();

    const menu = await openMenu();

    expect(
      within(menu).queryByRole("link", { name: "Club settings" }),
    ).toBeNull();
  });

  it("nombra la configuración del club en español", async () => {
    renderMenu("es", true);

    const menu = await openMenu("Mi cuenta");

    expect(
      within(menu).getByRole("link", { name: "Configuración del club" }),
    ).toBeInTheDocument();
  });

  it("cada entrada lleva su control", async () => {
    renderMenu();

    const menu = await openMenu();
    const entries = within(menu).getAllByRole("listitem");

    const profile = within(menu).getByRole("link", { name: "My profile" });
    expect(profile).toHaveAttribute("href", ACCOUNT_PAGE_PATH);
    expect(entries[0]).toContainElement(profile);
    expect(entries[1]).toContainElement(
      within(menu).getByRole("button", { name: /theme/i }),
    );
    expect(entries[2]).toContainElement(
      within(menu).getByRole("button", { name: /switch to español/i }),
    );
    expect(entries[3]).toContainElement(
      within(menu).getByRole("button", { name: "Sign out" }),
    );
  });

  it("se cierra al pulsar otra vez el botón de la cuenta", async () => {
    renderMenu();
    await openMenu();

    await userEvent.click(accountButton());

    expect(queryMenu()).toBeNull();
    expect(accountButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("se cierra con Escape y el foco vuelve al botón de la cuenta", async () => {
    renderMenu();
    await openMenu();

    await userEvent.keyboard("{Escape}");

    expect(queryMenu()).toBeNull();
    expect(accountButton()).toHaveFocus();
  });

  it("se cierra al pulsar fuera y el foco vuelve al botón de la cuenta", async () => {
    render(
      <>
        <p>Contenido de la pantalla</p>
        <AccountMenu locale="en" canConfigureClub={false} />
      </>,
    );
    await openMenu();

    await userEvent.click(screen.getByText("Contenido de la pantalla"));

    expect(queryMenu()).toBeNull();
    expect(accountButton()).toHaveFocus();
  });

  it("al pulsar fuera sobre otro control, el foco se queda en ese control", async () => {
    render(
      <>
        <input aria-label="Buscar" />
        <AccountMenu locale="en" canConfigureClub={false} />
      </>,
    );
    await openMenu();

    await userEvent.click(screen.getByRole("textbox", { name: "Buscar" }));

    expect(queryMenu()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Buscar" })).toHaveFocus();
  });

  it("no se cierra al pulsar dentro de él", async () => {
    renderMenu();
    const menu = await openMenu();

    await userEvent.click(within(menu).getByRole("heading"));

    expect(queryMenu()).toBeInTheDocument();
  });

  // Con el menú abierto el teclado no se pasea por lo que queda detrás: en el
  // móvil el menú tapa la pantalla entera y eso no se ve.
  it("se cierra cuando el foco sale de él y el foco vuelve al botón de la cuenta", async () => {
    render(
      <>
        <AccountMenu locale="en" canConfigureClub={false} />
        <button type="button">Control de debajo</button>
      </>,
    );
    await openMenu();

    screen.getByRole("button", { name: "Control de debajo" }).focus();

    await waitFor(() => expect(queryMenu()).toBeNull());
    expect(accountButton()).toHaveFocus();
  });

  it("se cierra con el botón de volver de la pantalla del móvil", async () => {
    renderMenu();
    const menu = await openMenu();

    await userEvent.click(within(menu).getByRole("button", { name: "Back" }));

    expect(queryMenu()).toBeNull();
    expect(accountButton()).toHaveFocus();
  });

  it("al abrirse lleva el foco dentro del menú", async () => {
    renderMenu();

    const menu = await openMenu();

    expect(menu).toContainElement(document.activeElement as HTMLElement);
  });

  it("Mi perfil lleva al perfil y cierra el menú", async () => {
    renderMenu();
    const menu = await openMenu();
    const profile = within(menu).getByRole("link", { name: "My profile" });
    // jsdom no navega: lo que importa aquí es a dónde apunta y que se cierra.
    profile.addEventListener("click", (event) => event.preventDefault());

    await userEvent.click(profile);

    expect(profile).toHaveAttribute("href", ACCOUNT_PAGE_PATH);
    expect(queryMenu()).toBeNull();
  });

  it("Cerrar sesión cierra la sesión como hoy", async () => {
    const fetchCalls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, method: init.method });
        return new Response(null, { status: 204 });
      }),
    );
    renderMenu();
    const menu = await openMenu();

    await userEvent.click(
      within(menu).getByRole("button", { name: "Sign out" }),
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SIGN_IN_PATH));
    expect(fetchCalls).toEqual([
      { url: "/api/v1/auth/session", method: "DELETE" },
    ]);
  });

  it("habla español con la aplicación en español", async () => {
    renderMenu("es");

    const menu = await openMenu("Mi cuenta");
    const entries = within(menu).getAllByRole("listitem");

    expect(entries[0]).toHaveTextContent("Mi perfil");
    expect(entries[1]).toHaveTextContent("Apariencia");
    expect(entries[2]).toHaveTextContent("Idioma");
    expect(entries[3]).toHaveTextContent("Cerrar sesión");
  });
});

describe("preferencias dentro del menú", () => {
  it("el tema cambia al momento y el menú sigue abierto", async () => {
    renderMenu();
    const menu = await openMenu();

    await userEvent.click(
      within(menu).getByRole("button", { name: "Switch to dark theme" }),
    );

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(queryMenu()).toBeInTheDocument();
  });

  it("el idioma se guarda, se pide la pantalla otra vez y el menú sigue abierto", async () => {
    renderMenu();
    const menu = await openMenu();

    await userEvent.click(
      within(menu).getByRole("button", { name: /switch to español/i }),
    );

    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=es`);
    expect(refresh).toHaveBeenCalled();
    expect(queryMenu()).toBeInTheDocument();
  });

  // El servidor rehace la cabecera con el idioma nuevo (LanguageToggle): el
  // menú abierto recibe el idioma nuevo sin cerrarse y sale traducido.
  it("con el idioma nuevo, el propio menú sale traducido sin cerrarse", async () => {
    const { rerender } = renderMenu("en");
    await openMenu();

    rerender(<AccountMenu locale="es" canConfigureClub={false} />);

    const menu = screen.getByRole("region", { name: "Mi cuenta" });
    expect(
      within(menu).getByRole("link", { name: "Mi perfil" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: /cambiar a english/i }),
    ).toBeInTheDocument();
  });
});
