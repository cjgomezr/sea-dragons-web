import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import type { SearchResponse } from "@/app/api/v1/search/route";
import type { Role } from "@/lib/auth/roles";
import { SEARCH_API_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import type {
  EventSearchResult,
  MemberSearchResult,
  NewsSearchResult,
} from "@/lib/search/search";

/**
 * La búsqueda global de la cabecera (#427, RF-8 del PRD de E14). Habla con
 * una API de mentira que responde como `GET /api/v1/search` (#425) y apunta
 * cada petición, para contar cuántas salen y cuáles se cancelan.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/dashboard",
}));

const DEBOUNCE_MS = 300;
/** El reloj de mentira también avanza con el real (`shouldAdvanceTime`, para
 * que `findBy` funcione), así que entre teclear y mirar pasan unos
 * milisegundos de verdad: "aún no" se comprueba con este margen. */
const REAL_TIME_MARGIN_MS = 50;
const VIEWER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_MEMBER_ID = "00000000-0000-4000-8000-000000000002";
/** Un jueves de octubre, a media mañana en Melbourne. */
const NOW = new Date("2026-10-01T00:00:00Z");

type Call = { readonly url: string; readonly signal: AbortSignal | null };

let calls: Call[];
let respond: (text: string) => Promise<Response>;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function aMember(
  overrides: Partial<MemberSearchResult> = {},
): MemberSearchResult {
  return {
    kind: "member",
    userId: OTHER_MEMBER_ID,
    fullName: "Grace Geelong",
    position: null,
    photoUrl: null,
    ...overrides,
  };
}

function anEvent(
  overrides: Partial<EventSearchResult> = {},
): EventSearchResult {
  return {
    kind: "event",
    id: "00000000-0000-4000-8000-0000000000e1",
    title: "Scrimmage vs Geelong Krakens",
    startsOn: "2026-10-10",
    startTime: "10:00",
    location: "Geelong Aquatic Centre",
    eventType: "competition",
    isCancelled: false,
    ...overrides,
  };
}

function aNewsPost(
  overrides: Partial<NewsSearchResult> = {},
): NewsSearchResult {
  return {
    kind: "news",
    id: "00000000-0000-4000-8000-0000000000a1",
    title: "Geelong trip details",
    category: "news",
    publishedAt: "2026-09-20T09:00:00.000Z",
    ...overrides,
  };
}

const EMPTY: SearchResponse = {
  members: { total: 0, items: [] },
  events: { total: 0, items: [] },
  news: { total: 0, items: [] },
};

const ONE_OF_EACH: SearchResponse = {
  members: { total: 1, items: [aMember()] },
  events: { total: 1, items: [anEvent()] },
  news: { total: 1, items: [aNewsPost()] },
};

function answerWith(results: SearchResponse): void {
  respond = async () => jsonResponse(200, { data: results });
}

function installFakeApi(): void {
  calls = [];
  answerWith(ONE_OF_EACH);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, signal: init?.signal ?? null });
      const text = new URL(url, "http://localhost").searchParams.get("q");
      return respond(text ?? "");
    }),
  );
}

function searchCalls(): Call[] {
  return calls.filter((call) => call.url.startsWith(SEARCH_API_PATH));
}

type RenderOptions = {
  readonly locale?: Locale;
  readonly role?: Role;
  readonly layout?: "bar" | "screen";
  readonly onClose?: () => void;
};

function renderSearch(options: RenderOptions = {}): ReturnType<typeof render> {
  return render(
    <GlobalSearch
      locale={options.locale ?? "en"}
      viewer={{ userId: VIEWER_ID, role: options.role ?? "Player" }}
      layout={options.layout ?? "bar"}
      onClose={options.onClose}
    />,
  );
}

function setUpUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function searchBox(name: RegExp | string = /search|buscar/i): HTMLElement {
  return screen.getByRole("combobox", { name });
}

async function waitOutDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  });
}

async function search(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
): Promise<void> {
  await user.type(searchBox(), text);
  await waitOutDebounce();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  push.mockReset();
  installFakeApi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("el cuadro", () => {
  it("pulsar / fuera de un campo de texto le da el foco", async () => {
    const user = setUpUser();
    renderSearch();

    await user.keyboard("/");

    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");
  });

  it("pulsar / dentro de otro campo escribe la barra y no roba el foco", async () => {
    const user = setUpUser();
    render(
      <>
        <label>
          Notes
          <input />
        </label>
        <GlobalSearch
          locale="en"
          viewer={{ userId: VIEWER_ID, role: "Player" }}
          layout="bar"
        />
      </>,
    );
    const notes = screen.getByRole("textbox", { name: "Notes" });

    await user.click(notes);
    await user.keyboard("/");

    expect(notes).toHaveFocus();
    expect(notes).toHaveValue("/");
  });

  it("dentro de la búsqueda la barra se escribe como cualquier letra", async () => {
    const user = setUpUser();
    renderSearch();

    await user.type(searchBox(), "a/b");

    expect(searchBox()).toHaveValue("a/b");
  });

  it("en la pantalla entera nace con el foco en el cuadro", () => {
    renderSearch({ layout: "screen" });

    expect(searchBox()).toHaveFocus();
  });

  it("se llama en el idioma de la visita", () => {
    renderSearch({ locale: "es" });

    expect(searchBox(/buscar/i)).toHaveAttribute(
      "placeholder",
      "Buscar socios, eventos, noticias…",
    );
  });
});

describe("pedir", () => {
  it("espera 300 ms sin teclear antes de pedir", async () => {
    const user = setUpUser();
    renderSearch();

    await user.type(searchBox(), "Gee");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - REAL_TIME_MARGIN_MS);
    });
    expect(searchCalls()).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REAL_TIME_MARGIN_MS);
    });
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0]?.url).toBe(`${SEARCH_API_PATH}?q=Gee`);
  });

  it("pide una sola vez por lo que se escribió de seguido", async () => {
    const user = setUpUser();
    renderSearch();

    await search(user, "Geelong");

    expect(searchCalls()).toHaveLength(1);
  });

  it("con menos de dos caracteres no pide nada", async () => {
    const user = setUpUser();
    renderSearch();

    await search(user, "G");
    await search(user, " ");

    expect(searchCalls()).toHaveLength(0);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("cuenta caracteres y no espacios de los extremos", async () => {
    const user = setUpUser();
    renderSearch();

    await search(user, "  G  ");

    expect(searchCalls()).toHaveLength(0);
  });

  it("teclear de nuevo cancela la petición que estaba en camino", async () => {
    const user = setUpUser();
    let releaseFirst: (() => void) | null = null;
    respond = (text) =>
      text === "Ge"
        ? new Promise<Response>((resolve) => {
            releaseFirst = () =>
              resolve(jsonResponse(200, { data: ONE_OF_EACH }));
          })
        : Promise.resolve(jsonResponse(200, { data: EMPTY }));
    renderSearch();

    await search(user, "Ge");
    await search(user, "x");
    await act(async () => {
      releaseFirst?.();
    });

    expect(searchCalls()).toHaveLength(2);
    expect(searchCalls()[0]?.signal?.aborted).toBe(true);
    expect(searchCalls()[1]?.signal?.aborted).toBe(false);
    expect(
      await screen.findByText("Nothing matches “Gex”"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("los grupos", () => {
  it("pone cada resultado bajo Socios, Eventos y Noticias con su total", async () => {
    const user = setUpUser();
    renderSearch();

    await search(user, "Geelong");

    const listbox = await screen.findByRole("listbox");
    const groups = within(listbox).getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveAccessibleName("Members (1)");
    expect(groups[1]).toHaveAccessibleName("Events (1)");
    expect(groups[2]).toHaveAccessibleName("News (1)");
    expect(within(groups[0]!).getByRole("option")).toHaveTextContent(
      "Grace Geelong",
    );
    expect(within(groups[1]!).getByRole("option")).toHaveTextContent(
      "Scrimmage vs Geelong Krakens",
    );
    expect(within(groups[2]!).getByRole("option")).toHaveTextContent(
      "Geelong trip details",
    );
  });

  it("no pinta un grupo vacío", async () => {
    const user = setUpUser();
    answerWith({ ...EMPTY, events: ONE_OF_EACH.events });
    renderSearch();

    await search(user, "Geelong");

    const groups = within(await screen.findByRole("listbox")).getAllByRole(
      "group",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName("Events (1)");
  });

  it("ofrece Ver todos cuando el total pasa de cinco", async () => {
    const user = setUpUser();
    answerWith({
      ...EMPTY,
      members: {
        total: 12,
        items: Array.from({ length: 5 }, (_, index) =>
          aMember({ userId: `member-${index}`, fullName: `Member ${index}` }),
        ),
      },
      news: { total: 5, items: [aNewsPost()] },
    });
    renderSearch();

    await search(user, "Geelong");

    const [members, news] = within(
      await screen.findByRole("listbox"),
    ).getAllByRole("group");
    expect(members).toHaveAccessibleName("Members (12)");
    expect(
      within(members!).getByRole("option", { name: "See all members" }),
    ).toBeInTheDocument();
    expect(
      within(news!).queryByRole("option", { name: /see all/i }),
    ).toBeNull();
  });

  it("sin nada en ningún grupo dice que nada coincide con lo escrito", async () => {
    const user = setUpUser();
    answerWith(EMPTY);
    renderSearch();

    await search(user, "Zanzibar");

    expect(
      await screen.findByText("Nothing matches “Zanzibar”"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("dice las cabeceras y el vacío en español", async () => {
    const user = setUpUser();
    renderSearch({ locale: "es" });

    await search(user, "Geelong");

    const groups = within(await screen.findByRole("listbox")).getAllByRole(
      "group",
    );
    expect(groups[0]).toHaveAccessibleName("Socios (1)");
    expect(groups[1]).toHaveAccessibleName("Eventos (1)");
    expect(groups[2]).toHaveAccessibleName("Noticias (1)");
  });

  it("dice que nada coincide en español", async () => {
    const user = setUpUser();
    answerWith(EMPTY);
    renderSearch({ locale: "es" });

    await search(user, "Zanzíbar");

    expect(
      await screen.findByText("Nada coincide con «Zanzíbar»"),
    ).toBeInTheDocument();
  });
});

describe("teclado", () => {
  it("es un combobox que controla la lista al llegar los resultados", async () => {
    const user = setUpUser();
    renderSearch();
    expect(searchBox()).toHaveAttribute("aria-expanded", "false");

    await search(user, "Geelong");

    const listbox = await screen.findByRole("listbox");
    expect(searchBox()).toHaveAttribute("aria-expanded", "true");
    expect(searchBox()).toHaveAttribute("aria-controls", listbox.id);
  });

  it("las flechas marcan un resultado y otro sin mover el foco", async () => {
    const user = setUpUser();
    renderSearch();
    await search(user, "Geelong");
    const options = within(await screen.findByRole("listbox")).getAllByRole(
      "option",
    );

    await user.keyboard("{ArrowDown}");
    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      options[0]!.id,
    );
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      options[2]!.id,
    );

    await user.keyboard("{ArrowUp}");
    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      options[1]!.id,
    );
    expect(searchBox()).toHaveFocus();
  });

  it("la flecha abajo en el último vuelve al primero", async () => {
    const user = setUpUser();
    renderSearch();
    await search(user, "Geelong");
    const options = within(await screen.findByRole("listbox")).getAllByRole(
      "option",
    );

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");

    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      options[0]!.id,
    );
  });

  it("Enter abre el resultado marcado y cierra la búsqueda", async () => {
    const user = setUpUser();
    renderSearch();
    await search(user, "Geelong");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(push).toHaveBeenCalledWith(
      "/calendario?evento=00000000-0000-4000-8000-0000000000e1",
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter sin nada marcado no navega", async () => {
    const user = setUpUser();
    renderSearch();
    await search(user, "Geelong");
    await screen.findByRole("listbox");

    await user.keyboard("{Enter}");

    expect(push).not.toHaveBeenCalled();
  });

  it("Escape cierra la lista y vacía el cuadro", async () => {
    const user = setUpUser();
    const onClose = vi.fn();
    renderSearch({ onClose });
    await search(user, "Geelong");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(searchBox()).toHaveValue("");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("anuncia cuántos resultados llegaron", async () => {
    const user = setUpUser();
    renderSearch();

    await search(user, "Geelong");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("3 results"),
    );
  });

  it("anuncia el total aunque la lista sólo enseñe cinco por grupo", async () => {
    const user = setUpUser();
    answerWith({ ...EMPTY, members: { total: 12, items: [aMember()] } });
    renderSearch({ locale: "es" });

    await search(user, "Geelong");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("12 resultados"),
    );
  });

  it("anuncia un resultado en singular", async () => {
    const user = setUpUser();
    answerWith({ ...EMPTY, news: ONE_OF_EACH.news });
    renderSearch();

    await search(user, "Geelong");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 result"),
    );
  });
});

async function chooseOption(
  name: RegExp | string,
  options: RenderOptions = {},
): Promise<void> {
  const user = setUpUser();
  renderSearch(options);
  await search(user, "Geelong");
  await user.click(await screen.findByRole("option", { name }));
}

describe("destinos", () => {
  it("un socio cualquiera lleva al directorio filtrado por su nombre", async () => {
    await chooseOption(/Grace Geelong/);

    expect(push).toHaveBeenCalledWith("/directorio?q=Grace%20Geelong");
  });

  it("a un Admin el socio lo lleva a su ficha", async () => {
    await chooseOption(/Grace Geelong/, { role: "Admin" });

    expect(push).toHaveBeenCalledWith(`/directorio/${OTHER_MEMBER_ID}`);
  });

  it("uno mismo lleva al perfil propio, también a un Admin", async () => {
    answerWith({
      ...EMPTY,
      members: {
        total: 1,
        items: [aMember({ userId: VIEWER_ID, fullName: "Me Geelong" })],
      },
    });

    await chooseOption(/Me Geelong/, { role: "Admin" });

    expect(push).toHaveBeenCalledWith("/cuenta");
  });

  it("un evento próximo lleva a su fila en el calendario", async () => {
    await chooseOption(/Scrimmage vs Geelong Krakens/);

    expect(push).toHaveBeenCalledWith(
      "/calendario?evento=00000000-0000-4000-8000-0000000000e1",
    );
  });

  it("un evento pasado lleva a su fila entre los pasados", async () => {
    answerWith({
      ...EMPTY,
      events: { total: 1, items: [anEvent({ startsOn: "2026-09-12" })] },
    });

    await chooseOption(/Scrimmage vs Geelong Krakens/);

    expect(push).toHaveBeenCalledWith(
      "/calendario?evento=00000000-0000-4000-8000-0000000000e1&periodo=past",
    );
  });

  it("una noticia lleva a la publicación", async () => {
    await chooseOption(/Geelong trip details/);

    expect(push).toHaveBeenCalledWith(
      "/noticias/00000000-0000-4000-8000-0000000000a1",
    );
  });

  it("abrir un resultado cierra la búsqueda", async () => {
    const onClose = vi.fn();

    await chooseOption(/Geelong trip details/, { onClose });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["members", "/directorio?q=Geelong"],
    ["events", "/calendario"],
    ["news", "/noticias"],
  ] as const)("Ver todos de %s lleva a %s", async (group, destination) => {
    const items = ONE_OF_EACH[group].items;
    answerWith({ ...EMPTY, [group]: { total: 6, items } });

    await chooseOption(`See all ${group}`);

    expect(push).toHaveBeenCalledWith(destination);
  });
});

describe("errores", () => {
  it("sin red dice que no se pudo buscar, ofrece reintentar y conserva el texto", async () => {
    const user = setUpUser();
    respond = async () => {
      throw new TypeError("Failed to fetch");
    };
    renderSearch();

    await search(user, "Geelong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't search.",
    );
    expect(searchBox()).toHaveValue("Geelong");

    answerWith(ONE_OF_EACH);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(2);
  });

  it("un error del servidor se cuenta igual, en español", async () => {
    const user = setUpUser();
    respond = async () =>
      jsonResponse(500, { error: { code: "internal_error", message: "x" } });
    renderSearch({ locale: "es" });

    await search(user, "Geelong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo buscar.",
    );
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });
});

describe("el idioma", () => {
  it("cambia cabeceras y mensajes y conserva el texto buscado", async () => {
    const user = setUpUser();
    const view = renderSearch();
    await search(user, "Geelong");
    await screen.findByRole("listbox");

    view.rerender(
      <GlobalSearch
        locale="es"
        viewer={{ userId: VIEWER_ID, role: "Player" }}
        layout="bar"
      />,
    );

    expect(searchBox(/buscar/i)).toHaveValue("Geelong");
    expect(
      within(screen.getByRole("listbox")).getAllByRole("group")[0],
    ).toHaveAccessibleName("Socios (1)");
    expect(screen.getByRole("status")).toHaveTextContent("3 resultados");
  });
});
