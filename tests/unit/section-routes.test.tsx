import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";

const requestLocale = { current: "en" as Locale };

vi.mock("@/lib/i18n/request-locale", () => ({
  readRequestLocale: async () => requestLocale.current,
}));
// La marca sale de la base (#292): la del test es otra que la de Victoria,
// así que un nombre escrito a mano en la pantalla no pasaría.
vi.mock("@/lib/club/supabase-club-brand", () => ({
  readClubBrand: async () => ({ name: "Hobart Orcas", initials: "HO" }),
}));

const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
const { default: PagosPage } = await import("@/app/(app)/pagos/page");
const { default: HomePage } = await import("@/app/(app)/page");

type ServerPage = () => Promise<React.JSX.Element>;

async function renderIn(locale: Locale, Page: ServerPage): Promise<void> {
  requestLocale.current = locale;
  render(await Page());
}

/** Las secciones que siguen siendo un marcador de posición. El directorio
 * salió de aquí en #239, Noticias en #329, Evaluaciones en #322, el
 * Calendario en #311 y Equipos en #402, que les dieron su pantalla: lo que
 * enseña cada una se prueba en su test de `tests/unit/components/`. */
const SECTIONS: ReadonlyArray<
  readonly [english: string, spanish: string, Page: ServerPage]
> = [
  ["Dashboard", "Dashboard", DashboardPage],
  ["Payments", "Pagos", PagosPage],
];

describe("secciones", () => {
  it.each(SECTIONS)(
    "la ruta de %s se titula y avisa en inglés que está en construcción",
    async (english, _spanish, Page) => {
      await renderIn("en", Page);

      expect(
        screen.getByRole("heading", { level: 1, name: english }),
      ).toBeInTheDocument();
      expect(screen.getByText(/under construction/i)).toBeInTheDocument();
    },
  );

  it.each(SECTIONS)(
    "la ruta de %s dice en español lo mismo que antes de traducirla",
    async (_english, spanish, Page) => {
      await renderIn("es", Page);

      expect(
        screen.getByRole("heading", { level: 1, name: spanish }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Esta sección está en construcción."),
      ).toBeInTheDocument();
    },
  );
});

describe("panel principal", () => {
  it("explica en inglés qué es la plataforma y dónde mirar su estado", async () => {
    await renderIn("en", HomePage);

    expect(
      screen.getByRole("heading", { level: 1, name: "Hobart Orcas" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/underwater rugby club/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Service status" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "GET /api/v1/health" }),
    ).toHaveAttribute("href", "/api/v1/health");
  });

  it("dice en español lo mismo que antes de traducirlo", async () => {
    await renderIn("es", HomePage);

    expect(
      screen.getByText(
        "Plataforma del club de rugby subacuático. Esta es la cáscara inicial: el resto de las funcionalidades llega epic por epic, cada una con sus tickets y su revisión.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Estado del servicio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "La API versionada responde en el endpoint de salud, que consulta la base de datos.",
      ),
    ).toBeInTheDocument();
  });
});
