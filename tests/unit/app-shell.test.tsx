import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import type { Role } from "@/lib/auth/roles";
import { type ClubBrand, DEFAULT_CLUB_BRAND } from "@/lib/club/club-brand";
import type { Locale } from "@/lib/i18n/locale";
import type { FailedPaymentAlert } from "@/lib/membership/failed-payment-alert";

const { usePathname, useRouter } = vi.hoisted(() => ({
  usePathname: vi.fn(),
  // La cáscara lleva el control de cerrar sesión, que navega al salir.
  useRouter: vi.fn(() => ({ replace: vi.fn(), refresh: vi.fn() })),
}));
vi.mock("next/navigation", () => ({ usePathname, useRouter }));

const openCheckout = vi.hoisted(() => vi.fn());
vi.mock("@/components/payments/checkout-navigation", () => ({
  openCheckout: (url: string) => openCheckout(url),
}));

const BRAND: ClubBrand = {
  ...DEFAULT_CLUB_BRAND,
  name: "Hobart Orcas",
  initials: "HO",
};

/** El máximo que admite `clubs_name_length` en `0022_club_brand.sql`. */
const LONGEST_CLUB_NAME =
  "Asociación Deportiva de Rugby Subacuático del Sur · Tasmania";

const VIEWER_ID = "00000000-0000-4000-8000-000000000001";

const ACCOUNT = {
  fullName: "Camilo Gomez",
  email: "camilo@seadragons.club",
  photoUrl: null,
};

function renderShell(
  locale: Locale = "en",
  brand: ClubBrand = BRAND,
  role: Role = "Player",
  membershipCurrent = true,
): void {
  render(
    <AppShell
      locale={locale}
      access={{ role, membershipCurrent }}
      viewerId={VIEWER_ID}
      account={ACCOUNT}
      brand={brand}
      failedPayment={null}
    >
      <p>Contenido de la sección</p>
    </AppShell>,
  );
}

/** El corte de `useIsPhone` y de la hoja de estilos. */
const PHONE_QUERY = "(width < 768px)";

/** jsdom no tiene pantalla: el `matchMedia` de `vitest.setup.ts` nunca casa,
 * así que por defecto la cáscara se pinta como en escritorio. */
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

async function openAccountMenu(name = "My account"): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("region", {
    name: name === "Mi cuenta" ? "Cuenta" : "Account",
  });
}

describe("la marca en la cabecera", () => {
  it("enseña el nombre que recibe de la base, no uno escrito en el código", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByText("Hobart Orcas")).toBeInTheDocument();
    expect(screen.queryByText(/Victoria Seadragons/)).toBeNull();
  });

  // A 360px un nombre de 60 caracteres se recorta con puntos suspensivos; el
  // título deja leerlo entero a quien pasa el ratón y el texto sigue completo
  // en el árbol, que es lo que oye un lector de pantalla.
  it("un nombre largo se lee entero aunque se vea recortado", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell("en", {
      ...DEFAULT_CLUB_BRAND,
      name: LONGEST_CLUB_NAME,
      initials: "AD",
    });

    const brand = screen.getByText(LONGEST_CLUB_NAME);
    expect(LONGEST_CLUB_NAME).toHaveLength(60);
    expect(brand).toHaveTextContent(LONGEST_CLUB_NAME);
    expect(brand).toHaveAttribute("title", LONGEST_CLUB_NAME);
  });

  it("sin logo no pinta ninguna imagen de marca", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const sidebar = screen.getByRole("complementary");
    expect(sidebar.querySelector("img.club-logo")).toBeNull();
  });
});

const LOGO_URL = "https://storage.example.test/club-logos/club/logo.png";

function renderShellWithLogo(): HTMLElement {
  usePathname.mockReturnValue("/dashboard");
  renderShell("en", { ...BRAND, logoUrl: LOGO_URL });
  return screen.getByRole("complementary");
}

function brandLockupOf(sidebar: HTMLElement): HTMLElement {
  const name = within(sidebar).getByText(BRAND.name);
  const lockup = name.parentElement;
  if (lockup === null) {
    throw new Error("el nombre del club no tiene contenedor");
  }
  return lockup;
}

describe("la marca lleva al inicio", () => {
  it("el logo y el nombre son un enlace al inicio con el nombre del club", () => {
    const sidebar = renderShellWithLogo();

    const link = within(sidebar).getByRole("link", { name: BRAND.name });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link.querySelector("img.club-logo")).not.toBeNull();
  });

  it("en el móvil también", () => {
    emulatePhone();
    usePathname.mockReturnValue("/cuenta");
    renderShell();

    expect(
      within(screen.getByRole("complementary")).getByRole("link", {
        name: BRAND.name,
      }),
    ).toHaveAttribute("href", "/dashboard");
  });
});

// #352: el logo y el nombre en una sola fila, como en el mockup.
describe("la marca en la barra lateral", () => {
  it("con logo pone el logo y el nombre en el mismo contenedor de fila", () => {
    const sidebar = renderShellWithLogo();

    const lockup = brandLockupOf(sidebar);
    const logo = lockup.querySelector("img.club-logo");
    expect(logo).toHaveAttribute("src", LOGO_URL);
    expect(lockup.firstElementChild).toBe(logo);
    expect(lockup).toHaveClass("app-brand-lockup");
  });

  it("sin logo el contenedor lleva sólo el nombre", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const lockup = brandLockupOf(screen.getByRole("complementary"));
    expect(lockup.children).toHaveLength(1);
    expect(lockup.firstElementChild).toHaveTextContent(BRAND.name);
  });

  it("con el logo roto queda sólo el nombre, sin hueco a la izquierda", () => {
    const sidebar = renderShellWithLogo();
    const lockup = brandLockupOf(sidebar);

    const logo = lockup.querySelector("img.club-logo");
    if (logo === null) {
      throw new Error("el logo no se pintó");
    }
    fireEvent.error(logo);

    expect(lockup.querySelector("img")).toBeNull();
    expect(lockup.children).toHaveLength(1);
    expect(lockup.firstElementChild).toHaveTextContent(BRAND.name);
  });

  it("el lector de pantalla oye el nombre del club una sola vez", () => {
    const sidebar = renderShellWithLogo();

    expect(within(sidebar).queryAllByRole("img")).toHaveLength(0);
    expect(within(sidebar).getByText(BRAND.name)).toBeInTheDocument();
    expect(
      brandLockupOf(sidebar).querySelector("img.club-logo"),
    ).toHaveAttribute("alt", "");
  });
});

describe("app shell", () => {
  it("renderiza marca, navegación y contenido", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    expect(screen.getByText("Hobart Orcas")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).toBeInTheDocument();
  });

  // #287: tema, idioma, Mi perfil y cerrar sesión viven en el menú de la
  // cuenta, así que la cabecera sólo lleva el nombre y dos controles.
  // #427: la lupa del móvil se suma junto a la campana.
  it("en el móvil la cabecera lleva sólo el nombre, la lupa, la campana y la cuenta", () => {
    usePathname.mockReturnValue("/calendario");
    emulatePhone();
    renderShell();

    const sidebar = screen.getByRole("complementary");
    const controls = within(sidebar).getAllByRole("button");
    expect(controls).toHaveLength(3);
    expect(controls[0]).toHaveAccessibleName("Search");
    expect(controls[1]).toHaveAccessibleName(/^Notifications/);
    expect(controls[2]).toHaveAccessibleName("My account");
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  // #266: la campana sigue en la cabecera, justo antes de la cuenta.
  it("pone la campana de avisos justo antes del botón de la cuenta", () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const bell = screen.getByRole("button", { name: /^Notifications/ });
    const account = screen.getByRole("button", { name: "My account" });
    expect(bell.compareDocumentPosition(account)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("nombra el botón de la cuenta en el idioma de la visita", () => {
    usePathname.mockReturnValue("/calendario");
    renderShell("es");

    expect(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ).toBeInTheDocument();
  });

  // FR-007: se cierra sesión desde cualquier pantalla, y la cáscara es lo
  // único que dibujan las siete por igual.
  it("ofrece cerrar sesión en cualquier pantalla de la aplicación", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  // #209: Mi cuenta (ahora Mi perfil) se alcanza desde la cabecera.
  it("enlaza Mi perfil desde el menú de la cuenta", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell();

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("link", { name: "My profile" }),
    ).toHaveAttribute("href", "/cuenta");
  });

  // #296: la configuración del club se alcanza desde el menú de la cuenta,
  // y sólo la ve quien la frontera deja entrar.
  it("enlaza la configuración del club en el menú de un Admin", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell("en", BRAND, "Admin");

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("link", { name: "Club settings" }),
    ).toHaveAttribute("href", "/club");
  });

  // #469: el Committee la abre para configurar los packs de sesiones.
  it("enlaza la configuración del club en el menú de un Committee", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell("en", BRAND, "Committee");

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("link", { name: "Club settings" }),
    ).toHaveAttribute("href", "/club");
  });

  it.each<Role>(["Coach", "Player"])(
    "no enlaza la configuración del club en el menú de un %s",
    async (role) => {
      usePathname.mockReturnValue("/calendario");
      renderShell("en", BRAND, role);

      const menu = await openAccountMenu();

      expect(
        within(menu).queryByRole("link", { name: "Club settings" }),
      ).toBeNull();
    },
  );

  it("nombra Mi perfil y cerrar sesión en el idioma de la visita", async () => {
    usePathname.mockReturnValue("/calendario");
    renderShell("es");

    const menu = await openAccountMenu("Mi cuenta");

    expect(
      within(menu).getByRole("link", { name: "Mi perfil" }),
    ).toHaveAttribute("href", "/cuenta");
    expect(
      within(menu).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  // E17 RF-3: un socio con sesión cambia de idioma sin salir de la aplicación.
  it("ofrece cambiar de idioma en cualquier pantalla de la aplicación", async () => {
    usePathname.mockReturnValue("/equipos");
    renderShell("es");

    const menu = await openAccountMenu("Mi cuenta");

    expect(
      within(menu).getByRole("radio", { name: "English" }),
    ).toBeInTheDocument();
  });

  it("pone el idioma justo después de la apariencia", async () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const menu = await openAccountMenu();

    const groups = within(menu).getAllByRole("radiogroup");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName("Appearance");
    expect(groups[1]).toHaveAccessibleName("Language");
  });

  // E17 RF-5: la cáscara pasa el idioma a las dos navegaciones, que son hojas
  // de cliente y no pueden leer la cookie por su cuenta.
  it("nombra las dos navegaciones en el idioma de la visita", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell
        locale="es"
        access={{ role: "Player", membershipCurrent: true }}
        viewerId={VIEWER_ID}
        account={ACCOUNT}
        brand={BRAND}
        failedPayment={null}
      >
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("navigation", { name: "Principal" }),
    ).toHaveTextContent("Directorio");
    expect(
      screen.getByRole("navigation", { name: "Secciones" }),
    ).toHaveTextContent("Inicio");
  });

  // #213: la cáscara reparte el rol que leyó el servidor a las dos
  // navegaciones, que esconden lo que ese rol no puede abrir.
  it("ofrece a cada navegación sólo lo que el rol recibido puede abrir", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell
        locale="en"
        access={{ role: "Player", membershipCurrent: true }}
        viewerId={VIEWER_ID}
        account={ACCOUNT}
        brand={BRAND}
        failedPayment={null}
      >
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const sidebar = screen.getByRole("navigation", { name: "Main" });
    expect(sidebar).not.toHaveTextContent("Teams");
    expect(sidebar).not.toHaveTextContent("Evaluations");
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).not.toHaveTextContent("Teams");
  });

  // La administración vive dentro del directorio desde #240: ninguna de las
  // dos navegaciones la ofrece, ni siquiera a un Admin.
  it("no enseña Administración en ninguna de las dos navegaciones a un Admin", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell
        locale="en"
        access={{ role: "Admin", membershipCurrent: true }}
        viewerId={VIEWER_ID}
        account={ACCOUNT}
        brand={BRAND}
        failedPayment={null}
      >
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).not.toHaveTextContent("Administration");
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).not.toHaveTextContent("Administration");
  });

  it("muestra el contenido recibido dentro del área principal", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell
        locale="en"
        access={{ role: "Player", membershipCurrent: true }}
        viewerId={VIEWER_ID}
        account={ACCOUNT}
        brand={BRAND}
        failedPayment={null}
      >
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByText("Contenido de la sección"));
  });
});

// #717, RF-10 del PRD de E26: en escritorio la campana y la cuenta suben a la
// barra de arriba, y la barra lateral se queda con la marca.
function topbarOf(): HTMLElement {
  const topbar = document.querySelector<HTMLElement>(".app-topbar");
  if (topbar === null) {
    throw new Error("la cáscara no pintó la barra de arriba");
  }
  return topbar;
}

const PHOTO_URL = "https://storage.example.test/member-photos/camilo-thumb.jpg";

describe("la cabecera de escritorio (#717)", () => {
  it("pone la campana y la cuenta en la barra de arriba, después del buscador", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const controls = within(topbarOf()).getAllByRole("button");
    expect(
      controls.map((control) => control.getAttribute("aria-label")),
    ).toEqual([expect.stringMatching(/^Notifications/), "My account"]);
    expect(
      screen
        .getByRole("search")
        .compareDocumentPosition(controls[0] as HTMLElement),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("deja la barra lateral sólo con la marca y la navegación", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).queryAllByRole("button")).toHaveLength(0);
    expect(within(sidebar).getByText("Hobart Orcas")).toBeInTheDocument();
  });

  it("el buscador sigue siendo el único cuadro de búsqueda de la barra", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const searchBar = screen.getByRole("search");
    expect(topbarOf()).toContainElement(searchBar);
    expect(within(searchBar).queryAllByRole("button")).toHaveLength(0);
  });

  it("el botón de la cuenta lleva las iniciales de quien mira", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const account = screen.getByRole("button", { name: "My account" });
    expect(account).toHaveTextContent("CG");
    expect(account).toHaveClass("account-avatar-button");
  });

  it("con foto, el botón de la cuenta la enseña en vez de las iniciales", () => {
    usePathname.mockReturnValue("/dashboard");
    render(
      <AppShell
        locale="en"
        access={{ role: "Player", membershipCurrent: true }}
        viewerId={VIEWER_ID}
        account={{ ...ACCOUNT, photoUrl: PHOTO_URL }}
        brand={BRAND}
        failedPayment={null}
      >
        <p>Contenido de la sección</p>
      </AppShell>,
    );

    const account = screen.getByRole("button", { name: "My account" });
    expect(account.querySelector("img")).toHaveAttribute("src", PHOTO_URL);
    expect(account).not.toHaveTextContent("CG");
  });

  it("el botón de la cuenta dice que el menú está abierto", async () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();
    const account = screen.getByRole("button", { name: "My account" });

    await userEvent.click(account);

    expect(account).toHaveAttribute("aria-expanded", "true");
  });

  it("sin acceso a la búsqueda la barra de arriba sigue llevando la campana y la cuenta", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell("en", BRAND, "Player", false);

    expect(
      within(topbarOf()).getByRole("button", { name: "My account" }),
    ).toBeInTheDocument();
    expect(
      within(topbarOf()).getByRole("button", { name: /^Notifications/ }),
    ).toBeInTheDocument();
  });
});

describe("la cabecera del móvil (#717)", () => {
  it("deja la barra de arriba sin botones", () => {
    usePathname.mockReturnValue("/dashboard");
    emulatePhone();
    renderShell();

    expect(within(topbarOf()).queryAllByRole("button")).toHaveLength(0);
  });

  it("el botón de la cuenta sigue siendo el icono, sin iniciales", () => {
    usePathname.mockReturnValue("/dashboard");
    emulatePhone();
    renderShell();

    const account = screen.getByRole("button", { name: "My account" });
    expect(account).not.toHaveTextContent("CG");
    expect(account).toHaveClass("app-header-icon");
  });
});

// #427, RF-8 del PRD de E14: la búsqueda global.
describe("la búsqueda en la cáscara", () => {
  it("pone el cuadro de búsqueda en la barra de arriba del contenido", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell();

    const searchBar = screen.getByRole("search");
    expect(
      within(searchBar).getByRole("combobox", { name: "Search" }),
    ).toHaveAttribute("placeholder", "Search members, events, news…");
    expect(searchBar.compareDocumentPosition(screen.getByRole("main"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("pone la lupa del móvil justo antes de la campana", () => {
    usePathname.mockReturnValue("/dashboard");
    emulatePhone();
    renderShell("es");

    const magnifier = screen.getByRole("button", { name: "Buscar" });
    const bell = screen.getByRole("button", { name: /^Avisos/ });
    expect(magnifier.parentElement?.nextElementSibling).toBe(
      bell.parentElement,
    );
    expect(magnifier).toHaveAttribute("aria-expanded", "false");
  });

  it("la lupa abre la búsqueda a pantalla completa con el foco en el cuadro", async () => {
    usePathname.mockReturnValue("/dashboard");
    emulatePhone();
    renderShell();
    const magnifier = screen.getByRole("button", { name: "Search" });

    await userEvent.click(magnifier);

    const screenSearch = screen.getByRole("dialog", { name: "Search" });
    expect(within(screenSearch).getByRole("combobox")).toHaveFocus();
    expect(magnifier).toHaveAttribute("aria-expanded", "true");
  });

  it("Cerrar cierra la búsqueda y devuelve el foco a la lupa", async () => {
    usePathname.mockReturnValue("/dashboard");
    emulatePhone();
    renderShell();
    const magnifier = screen.getByRole("button", { name: "Search" });
    await userEvent.click(magnifier);

    await userEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(magnifier).toHaveFocus();
  });

  it("Escape en la pantalla entera la cierra y devuelve el foco a la lupa", async () => {
    usePathname.mockReturnValue("/dashboard");
    emulatePhone();
    renderShell();
    const magnifier = screen.getByRole("button", { name: "Search" });
    await userEvent.click(magnifier);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(magnifier).toHaveFocus();
  });
});

describe("la cáscara de quien no tiene la membresía al día (#453)", () => {
  it("no ofrece la búsqueda, que encuentra socios y noticias", () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell("en", BRAND, "Player", false);

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /search/i }),
    ).not.toBeInTheDocument();
  });

  it("sigue ofreciendo la cuenta, con Mi perfil y cerrar sesión", async () => {
    usePathname.mockReturnValue("/dashboard");
    renderShell("en", BRAND, "Player", false);

    const menu = await openAccountMenu();

    expect(
      within(menu).getByRole("link", { name: "My profile" }),
    ).toBeInTheDocument();
  });
});

const RETRY_PAYMENT_PATH = "/api/v1/membership/retry-payment";
const INVOICE_URL = "https://invoice.stripe.com/i/acct_1/test_inv_open";
const FAILED_PAYMENT: FailedPaymentAlert = {
  failedAt: new Date("2026-10-01T03:12:00.000Z"),
};

function renderShellWithFailedPayment(
  failedPayment: FailedPaymentAlert | null,
  locale: Locale = "en",
): void {
  usePathname.mockReturnValue("/dashboard");
  render(
    <AppShell
      locale={locale}
      access={{ role: "Player", membershipCurrent: false }}
      viewerId={VIEWER_ID}
      account={ACCOUNT}
      brand={BRAND}
      failedPayment={failedPayment}
    >
      <p>Contenido de la sección</p>
    </AppShell>,
  );
}

function stubRetryResponse(status: number, body: unknown): typeof fetch {
  const fetchDouble = vi.fn(async (input: RequestInfo | URL) =>
    String(input) === RETRY_PAYMENT_PATH
      ? new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
      : new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchDouble);
  return fetchDouble;
}

function failedPaymentAlert(name = "Payment failed"): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("la alerta de pago fallido (#474)", () => {
  afterEach(() => {
    openCheckout.mockReset();
    vi.unstubAllGlobals();
  });

  it("con la membresía past_due enseña arriba la fecha del fallo y el botón de reintentar", () => {
    renderShellWithFailedPayment(FAILED_PAYMENT);

    const alert = failedPaymentAlert();
    expect(alert).toHaveTextContent("1 October 2026");
    expect(
      within(alert).getByRole("button", { name: "Retry payment" }),
    ).toBeEnabled();
    expect(alert.compareDocumentPosition(screen.getByRole("main"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("sin la fila del cobro fallido avisa igual, sin fecha", () => {
    renderShellWithFailedPayment({ failedAt: null });

    expect(failedPaymentAlert()).toHaveTextContent(
      "Your last membership payment didn't go through.",
    );
  });

  it("no aparece sin un cobro fallido", () => {
    renderShellWithFailedPayment(null);

    expect(
      screen.queryByRole("region", { name: "Payment failed" }),
    ).not.toBeInTheDocument();
  });

  it("cambia el texto y la fecha con el idioma", () => {
    renderShellWithFailedPayment(FAILED_PAYMENT, "es");

    const alert = failedPaymentAlert("Pago fallido");
    expect(alert).toHaveTextContent("1 de octubre de 2026");
    expect(
      within(alert).getByRole("button", { name: "Reintentar el pago" }),
    ).toBeInTheDocument();
  });

  it("el botón pide la factura abierta y lleva a su página de Stripe", async () => {
    const fetchDouble = stubRetryResponse(200, { data: { url: INVOICE_URL } });
    renderShellWithFailedPayment(FAILED_PAYMENT);

    await userEvent.click(
      within(failedPaymentAlert()).getByRole("button", {
        name: "Retry payment",
      }),
    );

    await waitFor(() => expect(openCheckout).toHaveBeenCalledWith(INVOICE_URL));
    expect(fetchDouble).toHaveBeenCalledWith(
      RETRY_PAYMENT_PATH,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("dice que no hay nada pendiente cuando no hay factura abierta", async () => {
    stubRetryResponse(409, {
      error: {
        code: "conflict",
        message: "No tienes ningún pago pendiente.",
        reason: "no_open_invoice",
      },
    });
    renderShellWithFailedPayment(FAILED_PAYMENT);

    await userEvent.click(
      screen.getByRole("button", { name: "Retry payment" }),
    );

    expect(
      await within(failedPaymentAlert()).findByRole("alert"),
    ).toHaveTextContent("There's nothing pending to pay.");
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it("dice que no se pudo abrir el pago cuando Stripe falla", async () => {
    stubRetryResponse(502, {
      error: {
        code: "bad_gateway",
        message: "Stripe no pudo abrir el pago.",
        reason: "stripe_failed",
      },
    });
    renderShellWithFailedPayment(FAILED_PAYMENT);

    await userEvent.click(
      screen.getByRole("button", { name: "Retry payment" }),
    );

    expect(
      await within(failedPaymentAlert()).findByRole("alert"),
    ).toHaveTextContent("We couldn't open the payment.");
    expect(openCheckout).not.toHaveBeenCalled();
  });
});
