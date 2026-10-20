import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AccountIdentity, AccountMenu } from "@/components/AccountMenu";
import {
  ACCOUNT_PAGE_PATH,
  CLUB_SETTINGS_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { LOCALE_COOKIE_NAME, type Locale } from "@/lib/i18n/locale";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * El menú de la cuenta (#287, rehecho en #716): la identidad arriba, Mi
 * perfil, la configuración del club, Apariencia e Idioma como controles
 * segmentados y Cerrar sesión. Cerrar con Escape, pulsando fuera o cuando el
 * foco sale sigue al panel de avisos (#266).
 */

const { replace, refresh, usePathname } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  usePathname: vi.fn(() => "/dashboard"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname,
}));

const CAMILO: AccountIdentity = {
  fullName: "Camilo Gomez",
  email: "camilo@seadragons.club",
  role: "Admin",
  photoUrl: null,
};

function renderMenu(
  locale: Locale = "en",
  canConfigureClub = false,
): ReturnType<typeof render> {
  return render(
    <AccountMenu
      locale={locale}
      trigger="icon"
      canConfigureClub={canConfigureClub}
      account={CAMILO}
    />,
  );
}

function accountButton(name = "My account"): HTMLElement {
  return screen.getByRole("button", { name });
}

/** El botón dice "Mi cuenta"; la pantalla que abre se titula "Cuenta", como
 * en el handoff (#2a). */
function menuTitle(buttonName: string): string {
  return buttonName === "Mi cuenta" ? "Cuenta" : "Account";
}

function queryMenu(name = "My account"): HTMLElement | null {
  return screen.queryByRole("region", { name: menuTitle(name) });
}

async function openMenu(name = "My account"): Promise<HTMLElement> {
  await userEvent.click(accountButton(name));
  return screen.getByRole("region", { name: menuTitle(name) });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.cookie = `${LOCALE_COOKIE_NAME}=; max-age=0; path=/`;
  replace.mockClear();
  refresh.mockClear();
  usePathname.mockReturnValue("/dashboard");
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

  it("enseña arriba quién tiene la sesión: iniciales, nombre, rol y correo", async () => {
    renderMenu();

    const menu = await openMenu();

    expect(within(menu).getByText("Camilo Gomez")).toBeInTheDocument();
    expect(
      within(menu).getByText("Admin · camilo@seadragons.club"),
    ).toBeInTheDocument();
    expect(within(menu).getByText("CG")).toBeInTheDocument();
  });

  it("con foto, la pone arriba en vez de las iniciales (#717)", async () => {
    const photoUrl = "https://storage.example.test/member-photos/camilo.jpg";
    render(
      <AccountMenu
        locale="en"
        trigger="icon"
        canConfigureClub={false}
        account={{ ...CAMILO, photoUrl }}
      />,
    );

    const menu = await openMenu();

    expect(menu.querySelector("img")).toHaveAttribute("src", photoUrl);
    expect(within(menu).queryByText("CG")).toBeNull();
  });

  it("nombra el rol en español con la aplicación en español", async () => {
    render(
      <AccountMenu
        locale="es"
        trigger="icon"
        canConfigureClub={false}
        account={{ ...CAMILO, role: "Player" }}
      />,
    );

    const menu = await openMenu("Mi cuenta");

    expect(
      within(menu).getByText("Jugador · camilo@seadragons.club"),
    ).toBeInTheDocument();
  });

  it("ofrece Mi perfil, la configuración del club, Apariencia, Idioma y Cerrar sesión, en ese orden", async () => {
    renderMenu("en", true);

    const menu = await openMenu();
    const inOrder = [
      within(menu).getByRole("link", { name: "My profile" }),
      within(menu).getByRole("link", { name: "Club settings" }),
      within(menu).getByRole("radiogroup", { name: "Appearance" }),
      within(menu).getByRole("radiogroup", { name: "Language" }),
      within(menu).getByRole("button", { name: "Sign out" }),
    ];

    const inDocumentOrder = [...inOrder].sort((first, second) =>
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );

    expect(inDocumentOrder).toEqual(inOrder);
  });

  it("Mi perfil lleva al perfil", async () => {
    renderMenu();

    const menu = await openMenu();

    expect(
      within(menu).getByRole("link", { name: "My profile" }),
    ).toHaveAttribute("href", ACCOUNT_PAGE_PATH);
  });

  it("ofrece la configuración del club a quien puede cambiarla (#296)", async () => {
    renderMenu("en", true);

    const menu = await openMenu();

    expect(
      within(menu).getByRole("link", { name: "Club settings" }),
    ).toHaveAttribute("href", CLUB_SETTINGS_PATH);
  });

  it("no ofrece la configuración del club a quien no puede cambiarla", async () => {
    renderMenu();

    const menu = await openMenu();

    expect(
      within(menu).queryByRole("link", { name: /club settings/i }),
    ).toBeNull();
  });

  it("nombra la configuración del club en español", async () => {
    renderMenu("es", true);

    const menu = await openMenu("Mi cuenta");

    expect(
      within(menu).getByRole("link", { name: "Configuración del club" }),
    ).toBeInTheDocument();
  });

  it("en la configuración del club la marca como la pantalla actual", async () => {
    usePathname.mockReturnValue(CLUB_SETTINGS_PATH);
    renderMenu("en", true);

    const menu = await openMenu();
    const settings = within(menu).getByRole("link", {
      name: /^Club settings/,
    });

    expect(settings).toHaveAttribute("aria-current", "page");
    expect(settings).toHaveTextContent("You're here");
  });

  it("dice Estás aquí en español", async () => {
    usePathname.mockReturnValue(CLUB_SETTINGS_PATH);
    renderMenu("es", true);

    const menu = await openMenu("Mi cuenta");

    expect(
      within(menu).getByRole("link", { name: /^Configuración del club/ }),
    ).toHaveTextContent("Estás aquí");
  });

  it("fuera de la configuración del club no la marca como actual", async () => {
    renderMenu("en", true);

    const menu = await openMenu();
    const settings = within(menu).getByRole("link", { name: "Club settings" });

    expect(settings).not.toHaveAttribute("aria-current");
    expect(settings).not.toHaveTextContent("You're here");
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
        <AccountMenu
          locale="en"
          trigger="icon"
          canConfigureClub={false}
          account={CAMILO}
        />
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
        <AccountMenu
          locale="en"
          trigger="icon"
          canConfigureClub={false}
          account={CAMILO}
        />
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

    await userEvent.click(within(menu).getByText("Camilo Gomez"));

    expect(queryMenu()).toBeInTheDocument();
  });

  // Con el menú abierto el teclado no se pasea por lo que queda detrás: en el
  // móvil el menú tapa la pantalla entera y eso no se ve.
  it("se cierra cuando el foco sale de él y el foco vuelve al botón de la cuenta", async () => {
    render(
      <>
        <AccountMenu
          locale="en"
          trigger="icon"
          canConfigureClub={false}
          account={CAMILO}
        />
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

  it("al abrirse lleva el foco al encabezado del menú", async () => {
    renderMenu();

    const menu = await openMenu();

    expect(within(menu).getByRole("heading")).toHaveFocus();
  });

  it("Mi perfil cierra el menú al navegar", async () => {
    renderMenu();
    const menu = await openMenu();
    const profile = within(menu).getByRole("link", { name: "My profile" });
    // jsdom no navega: lo que importa aquí es que se cierra.
    profile.addEventListener("click", (event) => event.preventDefault());

    await userEvent.click(profile);

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

    expect(
      within(menu).getByRole("link", { name: "Mi perfil" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("radiogroup", { name: "Apariencia" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("radiogroup", { name: "Idioma" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });
});

describe("Apariencia dentro del menú", () => {
  async function openAppearance(locale: Locale = "en"): Promise<HTMLElement> {
    renderMenu(locale);
    const menu = await openMenu(locale === "en" ? "My account" : "Mi cuenta");
    return within(menu).getByRole("radiogroup", {
      name: locale === "en" ? "Appearance" : "Apariencia",
    });
  }

  it("ofrece Claro, Oscuro y Sistema como radios", async () => {
    const appearance = await openAppearance();

    expect(
      within(appearance)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["light", "dark", "system"]);
    expect(
      within(appearance).getByRole("radio", { name: "Light" }),
    ).toBeInTheDocument();
    expect(
      within(appearance).getByRole("radio", { name: "Dark" }),
    ).toBeInTheDocument();
    expect(
      within(appearance).getByRole("radio", { name: "System" }),
    ).toBeInTheDocument();
  });

  it("los nombra en español", async () => {
    const appearance = await openAppearance("es");

    expect(
      within(appearance).getByRole("radio", { name: "Claro" }),
    ).toBeInTheDocument();
    expect(
      within(appearance).getByRole("radio", { name: "Oscuro" }),
    ).toBeInTheDocument();
    expect(
      within(appearance).getByRole("radio", { name: "Sistema" }),
    ).toBeInTheDocument();
  });

  it("sin elección guardada marca Sistema", async () => {
    const appearance = await openAppearance();

    expect(
      within(appearance).getByRole("radio", { name: "System" }),
    ).toBeChecked();
  });

  it("marca la preferencia guardada", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const appearance = await openAppearance();

    expect(
      within(appearance).getByRole("radio", { name: "Dark" }),
    ).toBeChecked();
  });

  it("elegir Oscuro lo aplica, lo guarda y deja el menú abierto", async () => {
    const appearance = await openAppearance();

    await userEvent.click(
      within(appearance).getByRole("radio", { name: "Dark" }),
    );

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(
      within(appearance).getByRole("radio", { name: "Dark" }),
    ).toBeChecked();
    expect(queryMenu()).toBeInTheDocument();
  });

  it("elegir Sistema lo guarda como sistema", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const appearance = await openAppearance();

    await userEvent.click(
      within(appearance).getByRole("radio", { name: "System" }),
    );

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(
      within(appearance).getByRole("radio", { name: "System" }),
    ).toBeChecked();
  });
});

describe("Idioma dentro del menú", () => {
  async function openLanguage(locale: Locale = "en"): Promise<HTMLElement> {
    renderMenu(locale);
    const menu = await openMenu(locale === "en" ? "My account" : "Mi cuenta");
    return within(menu).getByRole("radiogroup", {
      name: locale === "en" ? "Language" : "Idioma",
    });
  }

  it("ofrece English y Español con el idioma actual marcado", async () => {
    const language = await openLanguage("es");

    expect(
      within(language).getByRole("radio", { name: "English" }),
    ).not.toBeChecked();
    expect(
      within(language).getByRole("radio", { name: "Español" }),
    ).toBeChecked();
  });

  it("elegir el otro guarda la cookie, pide la pantalla otra vez y deja el menú abierto", async () => {
    const language = await openLanguage();

    await userEvent.click(
      within(language).getByRole("radio", { name: "Español" }),
    );

    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=es`);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(queryMenu()).toBeInTheDocument();
  });

  it("elegir el actual no hace nada", async () => {
    const language = await openLanguage();

    await userEvent.click(
      within(language).getByRole("radio", { name: "English" }),
    );

    expect(document.cookie).not.toContain(`${LOCALE_COOKIE_NAME}=`);
    expect(refresh).not.toHaveBeenCalled();
  });

  // El servidor rehace la cabecera con el idioma nuevo: el menú abierto
  // recibe el idioma nuevo sin cerrarse y sale traducido.
  it("con el idioma nuevo, el propio menú sale traducido sin cerrarse", async () => {
    const { rerender } = renderMenu("en");
    await openMenu();

    rerender(
      <AccountMenu
        locale="es"
        trigger="icon"
        canConfigureClub={false}
        account={CAMILO}
      />,
    );

    const menu = screen.getByRole("region", { name: "Cuenta" });
    expect(
      within(menu).getByRole("link", { name: "Mi perfil" }),
    ).toBeInTheDocument();
    expect(within(menu).getByRole("radio", { name: "Español" })).toBeChecked();
  });
});
