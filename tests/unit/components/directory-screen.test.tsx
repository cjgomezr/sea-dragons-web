import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type {
  AdminDirectoryMember,
  DirectoryMember,
} from "@/lib/directory/directory";

/**
 * La pantalla del directorio (#239, RF-2 del PRD de E5). Buscar, filtrar y
 * ordenar los resuelve el servidor desde #238, así que lo que se prueba aquí
 * es que la pantalla le pide lo que quien mira pidió y enseña lo que
 * respondió: ni filtra por su cuenta ni recuerda una lista vieja.
 */

const MARIA: DirectoryMember = {
  userId: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "María Ñíguez",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Coach",
  position: "Forward",
  status: "active",
  photoUrl: null,
};

/** Sin país, sin nivel y sin posición: los tres huecos del criterio del
 * guion, y el nombre más largo de la lista para el caso de contenido largo. */
const TOMAS: DirectoryMember = {
  userId: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Tomás Errekondo Aranburu",
  country: null,
  experienceLevel: null,
  role: "Player",
  position: null,
  status: "active",
  photoUrl: null,
};

const NEREA: DirectoryMember = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "Nerea Ruiz",
  country: "ES",
  experienceLevel: "Beginner",
  role: "Player",
  position: "Goalkeeper",
  status: "active",
  photoUrl: null,
};

const ZOE: AdminDirectoryMember = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  country: "AU",
  experienceLevel: "Intermediate",
  role: "Committee",
  position: "Defender",
  status: "inactive",
  photoUrl: null,
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  isAufExpired: false,
};

const VENCIDA: AdminDirectoryMember = {
  userId: "eeeeeeee-0000-4000-8000-00000000000e",
  fullName: "Ana Admin",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Admin",
  position: "Defender",
  status: "active",
  photoUrl: null,
  aufNumber: "AUF-7",
  aufExpiry: "2020-01-31",
  isAufVerified: true,
  isAufExpired: true,
};

/** La misma socia, tal como la ve un Admin: con su registro federativo al día,
 * que es lo que distingue a la fila señalada de las demás. */
const MARIA_PARA_ADMIN: AdminDirectoryMember = {
  ...MARIA,
  aufNumber: "AUF-1",
  aufExpiry: "2030-06-30",
  isAufVerified: true,
  isAufExpired: false,
};

/** El guion que ocupa el sitio de un dato que el socio no tiene. */
const MISSING = "–";

const DIRECTORY_PATH = "/api/v1/directory";
const PENDING_REQUESTS_PATH = "/api/v1/role-requests?status=pending";

type AnyMember = DirectoryMember | AdminDirectoryMember;

type ApiStub = {
  readonly members?: readonly AnyMember[];
  /** Quién mira: sólo un Admin recibe `admin`, y con él el control de los
   * dados de baja y la marca del AUF. */
  readonly kind?: "member" | "admin";
  /** Recibe el camino pedido, para poder contestar distinto según lo que se
   * preguntó (un 403 sólo a quien pide los dados de baja, por ejemplo). */
  readonly respond?: (url: string) => Response | Promise<Response>;
};

const requestedUrls: string[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: "x" } });
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Lo que el endpoint de #238 hace con la consulta, reducido a lo que estos
 * tests necesitan distinguir. El orden lo decide el servidor, así que aquí
 * responde en el orden de la lista: lo que la pantalla tiene que probar es
 * que pidió el orden, no que sepa ordenar. */
function listingFor(stub: ApiStub, url: string): Response {
  const params = new URL(url, "http://localhost").searchParams;
  const search = params.get("q");
  const role = params.get("role");
  const includeInactive = params.get("includeInactive") === "true";
  const members = (stub.members ?? [MARIA]).filter(
    (member) =>
      (role === null || member.role === role) &&
      (includeInactive || member.status !== "inactive") &&
      (search === null ||
        normalize(member.fullName).includes(normalize(search))),
  );
  return jsonResponse(200, { data: { kind: stub.kind ?? "member", members } });
}

/** Una respuesta que resuelve cuando el test quiera, para poder contestar dos
 * consultas en el orden contrario al que se pidieron. */
type PendingResponse = (response: Response) => void;

function deferredResponses(): {
  readonly pending: PendingResponse[];
  readonly respond: () => Promise<Response>;
} {
  const pending: PendingResponse[] = [];
  return {
    pending,
    respond: () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  };
}

function listingResponse(members: readonly AnyMember[]): Response {
  return jsonResponse(200, { data: { kind: "member", members } });
}

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      // La bandeja de solicitudes que el directorio le carga a un Admin
      // (#240) se prueba en `directory-admin.test.tsx`: aquí llega vacía.
      if (url === PENDING_REQUESTS_PATH) {
        return jsonResponse(200, { data: { requests: [] } });
      }
      requestedUrls.push(url);
      if (!url.startsWith(DIRECTORY_PATH)) {
        throw new Error(`Petición inesperada: ${url}`);
      }
      return stub.respond?.(url) ?? listingFor(stub, url);
    }),
  );
}

function lastRequest(): URLSearchParams {
  const url = requestedUrls[requestedUrls.length - 1] ?? "";
  return new URL(url, "http://localhost").searchParams;
}

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<DirectoryScreen locale={locale} />);
  await screen.findByRole("region", {
    name: locale === "en" ? "Club members" : "Miembros del club",
  });
}

function memberRow(name: string): HTMLElement {
  return screen.getByRole("row", { name });
}

function listedNames(): readonly string[] {
  return screen
    .getAllByRole("row")
    .map((row) => row.getAttribute("aria-label"))
    .filter((label): label is string => label !== null);
}

function columnHeader(name: string): HTMLElement {
  return screen.getByRole("columnheader", { name });
}

async function sortBy(column: string): Promise<void> {
  await userEvent
    .setup()
    .click(within(columnHeader(column)).getByRole("button"));
}

beforeEach(() => {
  requestedUrls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla del directorio", () => {
  it("lista a los socios del club con sus iniciales, nombre, país, nivel, rol y posición", async () => {
    stubApi({ members: [MARIA, NEREA] });

    await renderScreen();

    expect(listedNames()).toEqual(["María Ñíguez", "Nerea Ruiz"]);
    const row = memberRow("María Ñíguez");
    expect(within(row).getByText("MÑ")).toBeVisible();
    expect(within(row).getByText(/Australia/)).toBeVisible();
    expect(within(row).getByText(/Advanced/)).toBeVisible();
    expect(within(row).getByRole("cell", { name: "Coach" })).toBeVisible();
    expect(within(row).getByRole("cell", { name: "Forward" })).toBeVisible();
  });

  it("enseña la foto de quien tiene una, en lugar de sus iniciales", async () => {
    const photoUrl = "https://storage.test/member-photos/nerea.webp?token=t";
    stubApi({ members: [MARIA, { ...NEREA, photoUrl }] });

    await renderScreen();

    const withPhoto = memberRow("Nerea Ruiz");
    expect(within(withPhoto).getByRole("presentation")).toHaveAttribute(
      "src",
      photoUrl,
    );
    expect(within(withPhoto).queryByText("NR")).not.toBeInTheDocument();
    expect(
      within(memberRow("María Ñíguez")).queryByRole("presentation"),
    ).not.toBeInTheDocument();
  });

  it("no enseña una foto que no llega por una dirección web", async () => {
    stubApi({
      members: [{ ...NEREA, photoUrl: "javascript:alert(1)" }],
    });

    render(<DirectoryScreen locale="en" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("dice cuántos socios enseña", async () => {
    stubApi({ members: [MARIA, NEREA] });

    await renderScreen();

    expect(screen.getByText("2 members")).toBeVisible();
  });

  it("pone un guion donde el socio no tiene país, nivel ni posición", async () => {
    stubApi({ members: [TOMAS] });

    await renderScreen();

    const row = memberRow("Tomás Errekondo Aranburu");
    // Un guion por dato que falta: el país, el nivel y la posición. Desde #283
    // el país y el nivel son un elemento cada uno, para que la tarjeta del
    // móvil pueda etiquetarlos por separado.
    const dashes = within(row).getAllByText(MISSING);
    expect(dashes).toHaveLength(3);
    dashes.forEach((dash) => expect(dash).toBeVisible());
    expect(within(row).getByRole("cell", { name: MISSING })).toBeVisible();
  });

  it("filtra por nombre sin perder el filtro de rol", async () => {
    stubApi({ members: [MARIA, NEREA, TOMAS] });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: "Player" }));
    await waitFor(() => {
      expect(listedNames()).toEqual(["Nerea Ruiz", "Tomás Errekondo Aranburu"]);
    });
    await userEvent
      .setup()
      .type(screen.getByLabelText("Search by name"), "nerea");

    await waitFor(() => {
      expect(listedNames()).toEqual(["Nerea Ruiz"]);
    });
    expect(lastRequest().get("role")).toBe("Player");
    expect(lastRequest().get("q")).toBe("nerea");
  });

  it("espera a que quien escribe termine antes de preguntar por el nombre", async () => {
    stubApi({ members: [MARIA] });
    await renderScreen();
    const requestsBeforeTyping = requestedUrls.length;

    await userEvent
      .setup()
      .type(screen.getByLabelText("Search by name"), "mar");

    await waitFor(() => {
      expect(lastRequest().get("q")).toBe("mar");
    });
    expect(requestedUrls.length - requestsBeforeTyping).toBe(1);
  });

  it("muestra sólo el rol elegido y vuelve al club entero con Todos", async () => {
    stubApi({ members: [MARIA, NEREA] });
    await renderScreen();
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Coach" }));
    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
    expect(lastRequest().get("role")).toBe("Coach");

    await user.click(screen.getByRole("radio", { name: "All" }));

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez", "Nerea Ruiz"]);
    });
    expect(lastRequest().get("role")).toBeNull();
  });

  it("arranca ordenado por nombre ascendente", async () => {
    stubApi();

    await renderScreen();

    expect(lastRequest().get("sort")).toBe("name");
    expect(lastRequest().get("direction")).toBe("asc");
    expect(columnHeader("Member")).toHaveAttribute("aria-sort", "ascending");
  });

  it.each([
    ["Role", "role"],
    ["Position", "position"],
  ])("ordena por %s al pulsar su cabecera", async (column, sort) => {
    stubApi();
    await renderScreen();

    await sortBy(column);

    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe(sort);
    });
    expect(lastRequest().get("direction")).toBe("asc");
    expect(columnHeader(column)).toHaveAttribute("aria-sort", "ascending");
  });

  it("invierte el nombre al pulsar la cabecera por la que ya venía ordenado", async () => {
    stubApi();
    await renderScreen();

    await sortBy("Member");

    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("desc");
    });
    expect(lastRequest().get("sort")).toBe("name");
    expect(columnHeader("Member")).toHaveAttribute("aria-sort", "descending");
  });

  it("invierte el sentido al volver a pulsar la misma cabecera", async () => {
    stubApi();
    await renderScreen();

    await sortBy("Role");
    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("role");
    });
    await sortBy("Role");

    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("desc");
    });
    expect(columnHeader("Role")).toHaveAttribute("aria-sort", "descending");
    expect(columnHeader("Member")).toHaveAttribute("aria-sort", "none");
  });

  it("dice que no encontró a nadie y ofrece limpiar los filtros", async () => {
    stubApi({ members: [MARIA] });
    await renderScreen();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Search by name"), "zzz");
    await waitFor(() => {
      expect(
        screen.getByText("No member matches what you're looking for."),
      ).toBeVisible();
    });
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
    expect(screen.getByLabelText("Search by name")).toHaveValue("");
  });

  it("dice que la carga falló y deja reintentar", async () => {
    let attempts = 0;
    stubApi({
      respond: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("sin red");
        }
        return jsonResponse(200, {
          data: { kind: "member", members: [MARIA] },
        });
      },
    });
    render(<DirectoryScreen locale="en" />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(
      screen.getByText(
        "We couldn't reach the server. Check your connection and try again.",
      ),
    ).toBeVisible();

    await userEvent.setup().click(retry);

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
  });

  it("dice que la sesión terminó cuando el servidor no reconoce a quien pregunta", async () => {
    stubApi({ respond: () => errorResponse(401, "unauthenticated") });

    render(<DirectoryScreen locale="en" />);

    expect(
      await screen.findByText(
        "Your session ended. Sign in again to see the directory.",
      ),
    ).toBeVisible();
  });

  it("descarta la respuesta de una consulta que ya nadie pidió", async () => {
    const { pending, respond } = deferredResponses();
    stubApi({ respond });
    render(<DirectoryScreen locale="en" />);
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await act(async () => {
      pending[0]?.(listingResponse([MARIA, NEREA]));
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Search by name"), "ma");
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await user.type(screen.getByLabelText("Search by name"), "r");
    await waitFor(() => {
      expect(pending).toHaveLength(3);
    });

    // La consulta viva ("mar") contesta primero, y la vieja ("ma") después.
    await act(async () => {
      pending[2]?.(listingResponse([MARIA]));
    });
    await act(async () => {
      pending[1]?.(listingResponse([NEREA]));
    });

    expect(listedNames()).toEqual(["María Ñíguez"]);
  });

  it("deja la lista anterior a la vista mientras llega la nueva", async () => {
    const { pending, respond } = deferredResponses();
    stubApi({ respond });
    render(<DirectoryScreen locale="en" />);
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await act(async () => {
      pending[0]?.(listingResponse([MARIA, NEREA]));
    });

    await userEvent.setup().click(screen.getByRole("radio", { name: "Coach" }));
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });

    expect(screen.getByRole("table")).toBeVisible();
    expect(listedNames()).toEqual(["María Ñíguez", "Nerea Ruiz"]);
  });

  it("dice que la cuenta no puede ver el directorio cuando el servidor lo niega", async () => {
    stubApi({ respond: () => errorResponse(403, "forbidden") });

    render(<DirectoryScreen locale="en" />);

    expect(
      await screen.findByText("Your account can't see the club's directory."),
    ).toBeVisible();
  });

  it("trata un cuerpo que no sabe leer como un fallo, no como una lista vacía", async () => {
    stubApi({ respond: () => jsonResponse(200, { data: { kind: "member" } }) });

    render(<DirectoryScreen locale="en" />);

    expect(
      await screen.findByText(
        "We couldn't load the club's directory. Try again.",
      ),
    ).toBeVisible();
  });

  it("escribe en español los roles, las posiciones y los niveles", async () => {
    stubApi({ members: [NEREA] });

    await renderScreen("es");

    const row = memberRow("Nerea Ruiz");
    expect(within(row).getByRole("cell", { name: "Jugador" })).toBeVisible();
    expect(within(row).getByRole("cell", { name: "Portería" })).toBeVisible();
    expect(within(row).getByText("España")).toBeVisible();
    expect(within(row).getByText("Principiante")).toBeVisible();
    expect(within(row).getByRole("rowheader")).toHaveTextContent(
      /España · Principiante/,
    );
    expect(screen.getByRole("radio", { name: "Comité" })).toBeVisible();
  });
});

/** El control de orden de la lista de tarjetas (#283). En el navegador sólo se
 * ve por debajo de 768px, donde la tabla pierde sus cabeceras; aquí no hay
 * hoja de estilos, así que convive con ellas, y eso es justo lo que deja
 * probar que los dos leen y escriben el mismo orden. */
function sortGroup(name = "Sort by"): HTMLElement {
  return screen.getByRole("group", { name });
}

function directionGroup(name = "Order"): HTMLElement {
  return screen.getByRole("group", { name });
}

describe("orden desde el control de la lista estrecha", () => {
  it("ofrece los mismos campos que las cabeceras y los dos sentidos", async () => {
    stubApi();

    await renderScreen();

    expect(
      within(sortGroup())
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["Member", "Role", "Position"]);
    expect(
      within(directionGroup())
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["Ascending", "Descending"]);
  });

  it("arranca con el orden por defecto elegido", async () => {
    stubApi();

    await renderScreen();

    expect(
      within(sortGroup()).getByRole("radio", { name: "Member" }),
    ).toBeChecked();
    expect(
      within(directionGroup()).getByRole("radio", { name: "Ascending" }),
    ).toBeChecked();
  });

  it("pide el campo que se elige y lo refleja en la cabecera de la tabla", async () => {
    stubApi();
    await renderScreen();

    await userEvent
      .setup()
      .click(within(sortGroup()).getByRole("radio", { name: "Role" }));

    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("role");
    });
    expect(lastRequest().get("direction")).toBe("asc");
    expect(columnHeader("Role")).toHaveAttribute("aria-sort", "ascending");
    expect(columnHeader("Member")).toHaveAttribute("aria-sort", "none");
  });

  it("pide el sentido que se elige sin cambiar de campo", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.click(
      within(sortGroup()).getByRole("radio", { name: "Position" }),
    );

    await user.click(
      within(directionGroup()).getByRole("radio", { name: "Descending" }),
    );

    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("desc");
    });
    expect(lastRequest().get("sort")).toBe("position");
    expect(columnHeader("Position")).toHaveAttribute("aria-sort", "descending");
  });

  it("enseña el orden que se eligió desde una cabecera", async () => {
    stubApi();
    await renderScreen();

    await sortBy("Member");

    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("desc");
    });
    expect(
      within(sortGroup()).getByRole("radio", { name: "Member" }),
    ).toBeChecked();
    expect(
      within(directionGroup()).getByRole("radio", { name: "Descending" }),
    ).toBeChecked();
  });

  it("se escribe en español", async () => {
    stubApi();

    await renderScreen("es");

    expect(
      within(sortGroup("Ordenar por")).getByRole("radio", { name: "Miembro" }),
    ).toBeChecked();
    expect(
      within(directionGroup("Sentido")).getByRole("radio", {
        name: "Ascendente",
      }),
    ).toBeChecked();
  });
});

describe("incluir inactivos", () => {
  it("no ofrece dar de alta a quien no es Admin", async () => {
    stubApi({ kind: "member", members: [MARIA] });

    await renderScreen();

    expect(screen.queryByRole("link", { name: "Invite member" })).toBeNull();
  });

  it("no ofrece el control a quien no es Admin", async () => {
    stubApi({ kind: "member", members: [MARIA] });

    await renderScreen();

    expect(
      screen.queryByRole("checkbox", { name: "Include deactivated accounts" }),
    ).toBeNull();
  });

  it("enseña a los dados de baja con una marca cuando un Admin lo activa", async () => {
    stubApi({ kind: "admin", members: [VENCIDA, ZOE] });
    await renderScreen();
    expect(listedNames()).toEqual(["Ana Admin"]);

    await userEvent
      .setup()
      .click(
        screen.getByRole("checkbox", { name: "Include deactivated accounts" }),
      );

    await waitFor(() => {
      expect(listedNames()).toEqual(["Ana Admin", "Zoe Zapata"]);
    });
    expect(lastRequest().get("includeInactive")).toBe("true");
    expect(
      within(memberRow("Zoe Zapata")).getByText("Deactivated"),
    ).toBeVisible();
    expect(
      within(memberRow("Ana Admin")).queryByText("Deactivated"),
    ).toBeNull();
  });

  it("reintentar tras un 403 vuelve a pedir la lista sin los dados de baja", async () => {
    const asAdmin: ApiStub = { kind: "admin", members: [VENCIDA, ZOE] };
    stubApi({
      ...asAdmin,
      // A quien deja de ser Admin con la pantalla abierta, el servidor le
      // niega justo lo que la casilla pide.
      respond: (url) =>
        new URL(url, "http://localhost").searchParams.get("includeInactive") ===
        "true"
          ? errorResponse(403, "forbidden")
          : listingFor(asAdmin, url),
    });
    await renderScreen();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("checkbox", { name: "Include deactivated accounts" }),
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(listedNames()).toEqual(["Ana Admin"]);
    });
    expect(lastRequest().get("includeInactive")).toBeNull();
  });

  it("marca como pendiente de activar a quien todavía no entró", async () => {
    stubApi({
      kind: "member",
      members: [MARIA, { ...NEREA, status: "incomplete" }],
    });

    await renderScreen();

    expect(
      within(memberRow("Nerea Ruiz")).getByText("Pending activation"),
    ).toBeVisible();
    expect(
      within(memberRow("María Ñíguez")).queryByText("Pending activation"),
    ).toBeNull();
  });

  it("señala a un Admin la fila con el registro de AUF vencido", async () => {
    stubApi({ kind: "admin", members: [VENCIDA, MARIA_PARA_ADMIN] });

    await renderScreen();

    expect(
      within(memberRow("Ana Admin")).getByText("AUF expired"),
    ).toBeVisible();
    expect(
      within(memberRow("María Ñíguez")).queryByText("AUF expired"),
    ).toBeNull();
  });
});
