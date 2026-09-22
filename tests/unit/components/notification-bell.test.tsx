import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NOTIFICATIONS_API_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";

/**
 * La campana de la cabecera y su lista (#266, RF-3 a RF-5 del PRD de E6). Los
 * tests hablan con una API de mentira que guarda los avisos en memoria y
 * responde como la de #265: el número sale de su conteo, la lista de su
 * listado, y marcar cambia lo que devuelven los dos.
 */

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

const UNREAD_COUNT_PATH = `${NOTIFICATIONS_API_PATH}/unread-count`;
const READ_ALL_PATH = `${NOTIFICATIONS_API_PATH}/read-all`;
const REFRESH_INTERVAL_MS = 60_000;
const MINUTE_MS = 60_000;

type StoredNotification = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  isRead: boolean;
};

type FakeApi = {
  notifications: StoredNotification[];
  /** Las rutas que responden como si no hubiera red. */
  offline: Set<string>;
  calls: { readonly url: string; readonly method: string }[];
};

let api: FakeApi;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function respond(url: string, method: string): Response {
  if (url === UNREAD_COUNT_PATH && method === "GET") {
    const unreadCount = api.notifications.filter((n) => !n.isRead).length;
    return jsonResponse(200, { data: { unreadCount } });
  }
  if (url === NOTIFICATIONS_API_PATH && method === "GET") {
    return jsonResponse(200, { data: { notifications: api.notifications } });
  }
  if (url === READ_ALL_PATH && method === "POST") {
    api.notifications = api.notifications.map((n) => ({ ...n, isRead: true }));
    return noContent();
  }
  const markOne = /^\/api\/v1\/notifications\/([^/]+)\/read$/.exec(url);
  if (markOne !== null && method === "POST") {
    api.notifications = api.notifications.map((n) =>
      n.id === markOne[1] ? { ...n, isRead: true } : n,
    );
    return noContent();
  }
  throw new Error(`La API de mentira no conoce ${method} ${url}.`);
}

function installFakeApi(notifications: StoredNotification[]): void {
  api = { notifications, offline: new Set(), calls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      api.calls.push({ url, method });
      if (api.offline.has(url)) {
        throw new TypeError("Failed to fetch");
      }
      return respond(url, method);
    }),
  );
}

let nextId = 0;

function aNotification(
  options: {
    readonly isRead?: boolean;
    readonly minutesAgo?: number;
    readonly type?: string;
    readonly data?: Record<string, unknown>;
  } = {},
): StoredNotification {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    type: options.type ?? "role_changed",
    data: options.data ?? { newRole: "Coach" },
    createdAt: new Date(
      Date.now() - (options.minutesAgo ?? 5) * MINUTE_MS,
    ).toISOString(),
    isRead: options.isRead ?? false,
  };
}

function unreadNotifications(count: number): StoredNotification[] {
  return Array.from({ length: count }, (_, index) =>
    aNotification({ minutesAgo: index + 1 }),
  );
}

function renderBell(locale: Locale = "en"): ReturnType<typeof render> {
  return render(<NotificationBell locale={locale} />);
}

function bell(): HTMLElement {
  return screen.getByRole("button", { name: /^Notifications/ });
}

async function openList(): Promise<HTMLElement> {
  await userEvent.click(bell());
  return screen.findByRole("region", { name: "Notifications" });
}

function countCalls(url: string, method = "GET"): number {
  return api.calls.filter((call) => call.url === url && call.method === method)
    .length;
}

beforeEach(() => {
  usePathname.mockReturnValue("/dashboard");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("campana", () => {
  it("muestra el número exacto de avisos sin leer", async () => {
    installFakeApi(unreadNotifications(3));

    renderBell();

    expect(await within(bell()).findByText("3")).toBeInTheDocument();
  });

  it('muestra "9+" con más de nueve avisos sin leer', async () => {
    installFakeApi(unreadNotifications(12));

    renderBell();

    expect(await within(bell()).findByText("9+")).toBeInTheDocument();
  });

  it("muestra 9 tal cual, sin el más", async () => {
    installFakeApi(unreadNotifications(9));

    renderBell();

    expect(await within(bell()).findByText("9")).toBeInTheDocument();
  });

  it("no muestra número sin avisos sin leer", async () => {
    installFakeApi([aNotification({ isRead: true })]);

    renderBell();

    await waitFor(() => expect(countCalls(UNREAD_COUNT_PATH)).toBe(1));
    expect(bell()).toHaveAccessibleName("Notifications, none unread");
    expect(bell()).not.toHaveTextContent(/\d/);
  });

  it("anuncia a un lector de pantalla cuántos avisos hay sin leer", async () => {
    installFakeApi(unreadNotifications(12));

    renderBell();

    await waitFor(() =>
      expect(bell()).toHaveAccessibleName("Notifications, 12 unread"),
    );
  });

  it("lo anuncia en español con la aplicación en español", async () => {
    installFakeApi(unreadNotifications(1));

    renderBell("es");

    expect(
      await screen.findByRole("button", { name: "Avisos, 1 sin leer" }),
    ).toBeInTheDocument();
  });

  it("actualiza el número al cambiar de pantalla", async () => {
    installFakeApi(unreadNotifications(1));
    const { rerender } = renderBell();
    await within(bell()).findByText("1");

    api.notifications = [...api.notifications, aNotification()];
    usePathname.mockReturnValue("/calendario");
    rerender(<NotificationBell locale="en" />);

    expect(await within(bell()).findByText("2")).toBeInTheDocument();
  });

  it("actualiza el número cada minuto con la aplicación abierta", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFakeApi(unreadNotifications(1));
    renderBell();
    await within(bell()).findByText("1");

    api.notifications = [...api.notifications, aNotification()];
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS));

    expect(await within(bell()).findByText("2")).toBeInTheDocument();
  });

  it("no vuelve a preguntar antes del minuto", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFakeApi(unreadNotifications(1));
    renderBell();
    await within(bell()).findByText("1");

    await act(() => vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS / 2));

    expect(countCalls(UNREAD_COUNT_PATH)).toBe(1);
  });

  it("deja de preguntar cuando la cabecera desaparece", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFakeApi(unreadNotifications(1));
    const { unmount } = renderBell();
    await within(bell()).findByText("1");

    unmount();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);

    expect(countCalls(UNREAD_COUNT_PATH)).toBe(1);
  });

  it("se queda sin número si no pudo contar, sin romper la cabecera", async () => {
    installFakeApi(unreadNotifications(2));
    api.offline.add(UNREAD_COUNT_PATH);

    renderBell();

    await waitFor(() => expect(countCalls(UNREAD_COUNT_PATH)).toBe(1));
    expect(bell()).not.toHaveTextContent(/\d/);
  });
});

describe("lista de avisos", () => {
  it("abre la lista al pulsar la campana y la cierra con Escape", async () => {
    installFakeApi(unreadNotifications(1));
    renderBell();

    await openList();
    expect(bell()).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    expect(bell()).toHaveAttribute("aria-expanded", "false");
    expect(bell()).toHaveFocus();
  });

  it("cierra la lista al pulsar fuera de ella", async () => {
    installFakeApi(unreadNotifications(1));
    render(
      <>
        <p>Contenido de la pantalla</p>
        <NotificationBell locale="en" />
      </>,
    );
    await openList();

    await userEvent.click(screen.getByText("Contenido de la pantalla"));

    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });

  it("no la cierra al pulsar dentro de ella", async () => {
    installFakeApi(unreadNotifications(1));
    renderBell();
    const list = await openList();

    await userEvent.click(within(list).getByRole("heading"));

    expect(
      screen.getByRole("region", { name: "Notifications" }),
    ).toBeInTheDocument();
  });

  it("la cierra con el botón de volver de la pantalla del móvil", async () => {
    installFakeApi(unreadNotifications(1));
    renderBell();
    const list = await openList();

    await userEvent.click(within(list).getByRole("button", { name: "Back" }));

    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    expect(bell()).toHaveFocus();
  });

  it("vuelve a cerrarla al pulsar otra vez la campana", async () => {
    installFakeApi(unreadNotifications(1));
    renderBell();
    await openList();

    await userEvent.click(bell());

    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });

  it("muestra título, cuerpo y hace cuánto llegó cada aviso", async () => {
    installFakeApi([
      aNotification({ minutesAgo: 5, data: { newRole: "Committee" } }),
    ]);
    renderBell();

    const list = await openList();

    const item = await within(list).findByRole("listitem");
    expect(item).toHaveTextContent("Your role changed");
    expect(item).toHaveTextContent("You are now Committee.");
    expect(item).toHaveTextContent("5 minutes ago");
  });

  it("los ordena del más reciente al más antiguo", async () => {
    installFakeApi([
      aNotification({ minutesAgo: 60 * 24 * 3, data: { newRole: "Player" } }),
      aNotification({ minutesAgo: 2, data: { newRole: "Coach" } }),
      aNotification({ minutesAgo: 60, data: { newRole: "Admin" } }),
    ]);
    renderBell();

    const list = await openList();

    const items = await within(list).findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("You are now Coach."),
      expect.stringContaining("You are now Admin."),
      expect.stringContaining("You are now Player."),
    ]);
  });

  it("distingue los avisos sin leer de los leídos", async () => {
    installFakeApi([
      aNotification({ minutesAgo: 1, data: { newRole: "Coach" } }),
      aNotification({
        minutesAgo: 2,
        isRead: true,
        data: { newRole: "Admin" },
      }),
    ]);
    renderBell();

    const list = await openList();

    const [unread, read] = await within(list).findAllByRole("listitem");
    expect(unread).toHaveTextContent("New");
    expect(read).not.toHaveTextContent("New");
  });

  it("dice con una frase que no hay avisos", async () => {
    installFakeApi([]);
    renderBell();

    const list = await openList();

    expect(
      await within(list).findByText("You don't have any notifications yet."),
    ).toBeInTheDocument();
    expect(within(list).queryByRole("list")).toBeNull();
  });

  it("da un texto genérico a un aviso de un tipo desconocido sin romper la lista", async () => {
    installFakeApi([
      aNotification({ minutesAgo: 1, type: "event_created", data: {} }),
      aNotification({ minutesAgo: 2, data: { newRole: "Coach" } }),
    ]);
    renderBell();

    const list = await openList();

    const [unknown, known] = await within(list).findAllByRole("listitem");
    expect(unknown).toHaveTextContent("New notification");
    expect(known).toHaveTextContent("You are now Coach.");
  });

  it("da un texto genérico a un aviso cuyos datos no encajan", async () => {
    installFakeApi([aNotification({ data: { newRole: 42 } })]);
    renderBell();

    const list = await openList();

    expect(
      await within(list).findByText("Something changed in your account."),
    ).toBeInTheDocument();
  });

  it("sale en español aunque el aviso se creara con la aplicación en inglés", async () => {
    installFakeApi([
      aNotification({ minutesAgo: 5, data: { newRole: "Committee" } }),
    ]);
    renderBell("es");
    await userEvent.click(screen.getByRole("button", { name: /^Avisos/ }));

    const list = await screen.findByRole("region", { name: "Avisos" });

    const item = await within(list).findByRole("listitem");
    expect(item).toHaveTextContent("Tu rol cambió");
    expect(item).toHaveTextContent("Ahora eres Comité.");
    expect(item).toHaveTextContent("hace 5 minutos");
  });

  it("dice que no pudo cargar la lista y deja reintentar", async () => {
    installFakeApi([aNotification({ data: { newRole: "Coach" } })]);
    api.offline.add(NOTIFICATIONS_API_PATH);
    renderBell();
    const list = await openList();

    expect(
      await within(list).findByText("We couldn't load your notifications."),
    ).toBeInTheDocument();
    api.offline.delete(NOTIFICATIONS_API_PATH);
    await userEvent.click(
      within(list).getByRole("button", { name: "Try again" }),
    );

    expect(
      await within(list).findByText("You are now Coach."),
    ).toBeInTheDocument();
  });

  it("vuelve a pedir la lista cada vez que se abre", async () => {
    installFakeApi(unreadNotifications(1));
    renderBell();
    await openList();
    await userEvent.click(bell());

    await openList();

    await waitFor(() => expect(countCalls(NOTIFICATIONS_API_PATH)).toBe(2));
  });
});

describe("marcar como leídos", () => {
  it("marcar todo deja la campana sin número y ningún aviso como nuevo", async () => {
    installFakeApi(unreadNotifications(3));
    renderBell();
    const list = await openList();
    await within(list).findAllByRole("listitem");

    await userEvent.click(
      within(list).getByRole("button", { name: "Mark all read" }),
    );

    await waitFor(() =>
      expect(bell()).toHaveAccessibleName("Notifications, none unread"),
    );
    expect(bell()).not.toHaveTextContent(/\d/);
    for (const item of within(list).getAllByRole("listitem")) {
      expect(item).not.toHaveTextContent("New");
    }
    expect(countCalls(READ_ALL_PATH, "POST")).toBe(1);
  });

  it("no ofrece marcar todo cuando no queda ninguno sin leer", async () => {
    installFakeApi([aNotification({ isRead: true })]);
    renderBell();

    const list = await openList();

    await within(list).findByRole("listitem");
    expect(
      within(list).queryByRole("button", { name: "Mark all read" }),
    ).toBeNull();
  });

  it("dice que no pudo marcar todo, lo deja como estaba y deja reintentar", async () => {
    installFakeApi(unreadNotifications(2));
    api.offline.add(READ_ALL_PATH);
    renderBell();
    const list = await openList();
    await within(list).findAllByRole("listitem");

    await userEvent.click(
      within(list).getByRole("button", { name: "Mark all read" }),
    );

    expect(
      await within(list).findByText(
        "We couldn't mark your notifications as read.",
      ),
    ).toBeInTheDocument();
    expect(within(bell()).getByText("2")).toBeInTheDocument();
    api.offline.delete(READ_ALL_PATH);
    await userEvent.click(
      within(list).getByRole("button", { name: "Try again" }),
    );
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName("Notifications, none unread"),
    );
  });

  it("abrir un aviso sin leer lo marca leído y el número baja en uno", async () => {
    installFakeApi([
      aNotification({ minutesAgo: 1, data: { newRole: "Coach" } }),
      aNotification({ minutesAgo: 2, data: { newRole: "Admin" } }),
    ]);
    renderBell();
    const list = await openList();
    await within(bell()).findByText("2");

    await userEvent.click(
      within(list).getByRole("button", { name: /You are now Coach\./ }),
    );

    expect(await within(bell()).findByText("1")).toBeInTheDocument();
    const [opened, untouched] = within(list).getAllByRole("listitem");
    expect(opened).not.toHaveTextContent("New");
    expect(untouched).toHaveTextContent("New");
    expect(
      countCalls(
        `${NOTIFICATIONS_API_PATH}/${api.notifications[0]?.id}/read`,
        "POST",
      ),
    ).toBe(1);
  });

  it("un aviso ya leído no se ofrece para abrir", async () => {
    installFakeApi([aNotification({ isRead: true })]);
    renderBell();

    const list = await openList();

    await within(list).findByRole("listitem");
    expect(
      within(list).queryByRole("button", { name: /You are now/ }),
    ).toBeNull();
  });

  it("dice que no pudo marcar un aviso y lo deja como nuevo", async () => {
    installFakeApi([aNotification({ data: { newRole: "Coach" } })]);
    const target = `${NOTIFICATIONS_API_PATH}/${api.notifications[0]?.id}/read`;
    api.offline.add(target);
    renderBell();
    const list = await openList();

    await userEvent.click(
      await within(list).findByRole("button", { name: /You are now Coach\./ }),
    );

    expect(
      await within(list).findByText(
        "We couldn't mark your notifications as read.",
      ),
    ).toBeInTheDocument();
    expect(within(list).getByRole("listitem")).toHaveTextContent("New");
    expect(within(bell()).getByText("1")).toBeInTheDocument();
  });
});
