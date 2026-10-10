import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type {
  AdminDirectoryMember,
  CoachDirectoryMember,
  CommitteeDirectoryMember,
  DirectoryMember,
} from "@/lib/directory/directory";
import { DEFAULT_DIRECTORY_QUERY } from "@/lib/directory/directory";
import {
  DEFENDER,
  FORWARD,
  GOALKEEPER,
  SEEDED_POSITIONS,
  asDirectoryPosition,
} from "../helpers/seeded-positions";

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
  position: asDirectoryPosition(FORWARD),
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
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
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
};

const NEREA: DirectoryMember = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "Nerea Ruiz",
  country: "ES",
  experienceLevel: "Beginner",
  role: "Player",
  position: asDirectoryPosition(GOALKEEPER),
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
};

const ZOE: AdminDirectoryMember = {
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  country: "AU",
  experienceLevel: "Intermediate",
  role: "Committee",
  position: asDirectoryPosition(DEFENDER),
  status: "inactive",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  isAufExpired: false,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "zoe@club.test",
  phone: null,
  emergencyContact: null,
};

const VENCIDA: AdminDirectoryMember = {
  userId: "eeeeeeee-0000-4000-8000-00000000000e",
  fullName: "Ana Admin",
  country: "AU",
  experienceLevel: "Advanced",
  role: "Admin",
  position: asDirectoryPosition(DEFENDER),
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "no_data" },
  aufNumber: "AUF-7",
  aufExpiry: "2020-01-31",
  isAufVerified: true,
  isAufExpired: true,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "vencida@club.test",
  phone: null,
  emergencyContact: null,
};

/** La misma socia, tal como la ve un Admin: con su registro federativo al día,
 * que es lo que distingue a la fila señalada de las demás. */
const MARIA_PARA_ADMIN: AdminDirectoryMember = {
  ...MARIA,
  aufNumber: "AUF-1",
  aufExpiry: "2030-06-30",
  isAufVerified: true,
  isAufExpired: false,
  isAufExpiring: false,
  isEvaluated: true,
  membershipStatus: "active",
  email: "maria.para.admin@club.test",
  phone: null,
  emergencyContact: null,
};

/** Invitada el 5 de octubre y todavía sin entrar (#549). */
const INVITED_NEREA: DirectoryMember = {
  ...NEREA,
  status: "incomplete",
  invitedOn: "2026-10-05",
};

/** Con la membresía atrasada (#453): un punto de peligro (#549). */
const PAST_DUE_MARIA: AdminDirectoryMember = {
  ...MARIA_PARA_ADMIN,
  membershipStatus: "past_due",
};

/** El guion que ocupa el sitio de un dato que el socio no tiene. */
const MISSING = "–";

const DIRECTORY_PATH = "/api/v1/directory";
const PENDING_REQUESTS_PATH = "/api/v1/role-requests?status=pending";
const POSITIONS_PATH = "/api/v1/club/positions";
const GROUPS_PATH = "/api/v1/groups";

const SENIOR_GROUP = {
  id: "9a9a9a9a-0000-4000-8000-000000000001",
  name: "Senior Squad",
  memberCount: 2,
};

/** Lo que el servidor deja filtrar a cada vista, si el test no dice otra
 * cosa. Un Committee recibe la vista de socio con el grupo: lo pide así. */
const FILTERS_BY_KIND = {
  member: ["position"],
  committee: ["position", "group", "withoutPhone", "withoutEmergencyContact"],
  coach: ["position", "group"],
  admin: [
    "position",
    "group",
    "auf",
    "membership",
    "withoutPhone",
    "withoutEmergencyContact",
  ],
} as const;

type AnyMember =
  | DirectoryMember
  | CommitteeDirectoryMember
  | CoachDirectoryMember
  | AdminDirectoryMember;

type ApiStub = {
  readonly members?: readonly AnyMember[];
  /** Quién mira: sólo un Admin recibe `admin`, y con él el control de los
   * dados de baja y la marca del AUF. */
  readonly kind?: "member" | "committee" | "coach" | "admin";
  /** Recibe el camino pedido, para poder contestar distinto según lo que se
   * preguntó (un 403 sólo a quien pide los dados de baja, por ejemplo). */
  readonly respond?: (url: string) => Response | Promise<Response>;
  /** Los filtros que el servidor dice que se pueden usar (#497). */
  readonly availableFilters?: readonly string[];
  /** El total del club que dice el servidor; por defecto, los de `members`
   * que no están dados de baja. */
  readonly total?: number;
};

const requestedUrls: string[] = [];
const groupRequests: string[] = [];

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

/** El club entero de la respuesta, sin búsqueda, rol ni filtros: el total
 * de la cabecera (#548). */
function clubSizeOf(stub: ApiStub, includeInactive: boolean): number {
  return (stub.members ?? [MARIA]).filter(
    (member) => includeInactive || member.status !== "inactive",
  ).length;
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
  const position = params.get("position");
  const members = (stub.members ?? [MARIA]).filter(
    (member) =>
      (role === null || member.role === role) &&
      (includeInactive || member.status !== "inactive") &&
      (position === null || (member.position?.id ?? "none") === position) &&
      (search === null ||
        normalize(member.fullName).includes(normalize(search))),
  );
  const kind = stub.kind ?? "member";
  return jsonResponse(200, {
    data: {
      kind,
      members,
      availableFilters: stub.availableFilters ?? FILTERS_BY_KIND[kind],
      total: stub.total ?? clubSizeOf(stub, includeInactive),
    },
  });
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
  return jsonResponse(200, {
    data: {
      kind: "member",
      members,
      availableFilters: ["position"],
      total: members.length,
    },
  });
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
      // Las opciones de los filtros (#497): las posiciones del club y sus
      // grupos. No cuentan como lecturas del directorio.
      if (url === POSITIONS_PATH) {
        return jsonResponse(200, {
          data: { positions: SEEDED_POSITIONS.map(asDirectoryPosition) },
        });
      }
      if (url === GROUPS_PATH) {
        groupRequests.push(url);
        return jsonResponse(200, { data: { groups: [SENIOR_GROUP] } });
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

/** El ancho desde el que Filtros abre el popover en vez de la hoja (#548). */
const WIDE_SCREEN_QUERY = "(min-width: 768px)";

function stubScreenWidth(isWide: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isWide && query === WIDE_SCREEN_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function showAsDesktop(): void {
  stubScreenWidth(true);
}

function showAsPhone(): void {
  stubScreenWidth(false);
}

const FILTERS_NAME = { en: "Filters", es: "Filtros" } as const;

/** El popover de los filtros, abierto desde su botón si todavía no lo está. */
async function openFilters(locale: "en" | "es" = "en"): Promise<HTMLElement> {
  const name = FILTERS_NAME[locale];
  const open = screen.queryByRole("dialog", { name });
  if (open !== null) {
    return open;
  }
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  return screen.getByRole("dialog", { name });
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
  groupRequests.length = 0;
  window.history.replaceState(null, "", "/directorio");
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

  it("abre en grande la foto de una fila al pulsarla (#355)", async () => {
    const photoUrl = "https://storage.test/member-photos/nerea.webp?token=t";
    const largeUrl = "https://storage.test/member-photos/nerea-l.webp?token=l";
    const largePhotoPath = `${DIRECTORY_PATH}/${NEREA.userId}/photo`;
    stubApi({
      members: [MARIA, { ...NEREA, photoUrl }],
      respond: (url) =>
        url === largePhotoPath
          ? jsonResponse(200, { data: { photoUrl: largeUrl } })
          : listingFor({ members: [MARIA, { ...NEREA, photoUrl }] }, url),
    });
    await renderScreen();

    await userEvent.click(
      within(memberRow("Nerea Ruiz")).getByRole("button", {
        name: "Open the photo of Nerea Ruiz",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Nerea Ruiz" });
    expect(
      await within(dialog).findByRole("img", { name: "Photo of Nerea Ruiz" }),
    ).toHaveAttribute("src", largeUrl);
    expect(
      within(memberRow("María Ñíguez")).queryByRole("button", {
        name: /Open the photo/,
      }),
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
    ["Role", "role", "asc", "ascending"],
    ["Position", "position", "asc", "ascending"],
    // La asistencia empieza de mayor a menor (#549).
    ["Attendance", "attendance", "desc", "descending"],
  ])(
    "ordena por %s al pulsar su cabecera",
    async (column, sort, direction, ariaSort) => {
      stubApi();
      await renderScreen();

      await sortBy(column);

      await waitFor(() => {
        expect(lastRequest().get("sort")).toBe(sort);
      });
      expect(lastRequest().get("direction")).toBe(direction);
      expect(columnHeader(column)).toHaveAttribute("aria-sort", ariaSort);
    },
  );

  it("invierte la asistencia, de menor a mayor, al volver a pulsarla (#549)", async () => {
    stubApi();
    await renderScreen();

    await sortBy("Attendance");
    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("attendance");
    });
    await sortBy("Attendance");

    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("asc");
    });
    expect(columnHeader("Attendance")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
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
      expect(screen.getByText("No members match these filters")).toBeVisible();
    });
    expect(
      screen.getByText("Showing all roles · Name: zzz. Try removing a filter."),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

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
          data: {
            kind: "member",
            members: [MARIA],
            availableFilters: ["position"],
            total: 1,
          },
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

  it("escribe en inglés la posición que no tiene nombre en español", async () => {
    stubApi({
      members: [
        {
          ...NEREA,
          position: {
            id: "90000000-0000-4000-8000-000000000009",
            names: { en: "Sweeper", es: null },
          },
        },
      ],
    });

    await renderScreen("es");

    expect(
      within(memberRow("Nerea Ruiz")).getByRole("cell", { name: "Sweeper" }),
    ).toBeVisible();
  });
});

/** La hoja del orden de la lista del móvil (#553). En el navegador sólo se
 * ve por debajo de 768px, donde la tabla pierde sus cabeceras; aquí no hay
 * hoja de estilos, así que convive con ellas, y eso es justo lo que deja
 * probar que las dos leen y escriben el mismo orden. Lo demás de la hoja se
 * prueba en `directory-mobile.test.tsx`. */
function sortSheetButton(name = /^Sort:/): HTMLElement {
  return screen.getByRole("button", { name });
}

async function sortFromSheet(
  field: string,
  locale: "en" | "es" = "en",
): Promise<void> {
  const user = userEvent.setup();
  await user.click(sortSheetButton(locale === "en" ? /^Sort:/ : /^Orden:/));
  await user.click(
    within(
      screen.getByRole("dialog", {
        name: locale === "en" ? "Sort by" : "Ordenar por",
      }),
    ).getByRole("button", { name: new RegExp(`^${field}`) }),
  );
}

describe("orden desde la hoja de la lista estrecha", () => {
  it("pide el campo que se elige y lo refleja en la cabecera de la tabla", async () => {
    stubApi();
    await renderScreen();

    await sortFromSheet("Role");

    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("role");
    });
    expect(lastRequest().get("direction")).toBe("asc");
    expect(columnHeader("Role")).toHaveAttribute("aria-sort", "ascending");
    expect(columnHeader("Member")).toHaveAttribute("aria-sort", "none");
  });

  it("enseña el orden que se eligió desde una cabecera", async () => {
    stubApi();
    await renderScreen();

    await sortBy("Member");

    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("desc");
    });
    expect(sortSheetButton()).toHaveAccessibleName("Sort: Name, descending");
  });
});

describe("incluir inactivos", () => {
  it("no ofrece dar de alta a quien no es Admin", async () => {
    stubApi({ kind: "member", members: [MARIA] });

    await renderScreen();

    expect(screen.queryByRole("link", { name: "Invite member" })).toBeNull();
  });

  it("no ofrece el control a quien no es Admin", async () => {
    showAsDesktop();
    stubApi({ kind: "member", members: [MARIA] });

    await renderScreen();

    expect(
      within(await openFilters()).queryByRole("checkbox", {
        name: "Include deactivated accounts",
      }),
    ).toBeNull();
  });

  it("enseña a los dados de baja con una marca cuando un Admin lo activa", async () => {
    showAsDesktop();
    stubApi({ kind: "admin", members: [VENCIDA, ZOE] });
    await renderScreen();
    expect(listedNames()).toEqual(["Ana Admin"]);

    await userEvent.setup().click(
      within(await openFilters()).getByRole("checkbox", {
        name: "Include deactivated accounts",
      }),
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
    showAsDesktop();
    await renderScreen();
    const user = userEvent.setup();

    await user.click(
      within(await openFilters()).getByRole("checkbox", {
        name: "Include deactivated accounts",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(listedNames()).toEqual(["Ana Admin"]);
    });
    expect(lastRequest().get("includeInactive")).toBeNull();
  });

  it("marca como invitado a quien todavía no entró, con el día de la invitación", async () => {
    stubApi({ kind: "member", members: [MARIA, INVITED_NEREA] });

    await renderScreen();

    const invited = memberRow("Nerea Ruiz");
    expect(within(invited).getByText("Invited")).toBeVisible();
    expect(
      within(invited).getByText(
        "Invited on 5 October 2026 · not signed in yet",
      ),
    ).toBeVisible();
    expect(within(invited).queryByText(/Spain/)).toBeNull();
    expect(within(memberRow("María Ñíguez")).queryByText(/Invited/)).toBeNull();
  });

  it("señala a un Admin la fila con el registro de AUF vencido", async () => {
    stubApi({ kind: "admin", members: [VENCIDA, MARIA_PARA_ADMIN] });

    await renderScreen();

    expect(
      within(memberRow("Ana Admin")).getByRole("img", { name: "AUF expired" }),
    ).toBeVisible();
    expect(
      within(memberRow("María Ñíguez")).queryByRole("img", {
        name: "AUF expired",
      }),
    ).toBeNull();
  });
});

// Desde #549 la fila sólo señala la membresía atrasada, con un punto; el
// estado completo está en la ficha.
describe("punto de membresía (#453, #549)", () => {
  it("señala a un Admin con un punto de peligro la membresía atrasada", async () => {
    stubApi({
      kind: "admin",
      members: [{ ...VENCIDA, isAufExpired: false }, PAST_DUE_MARIA],
    });

    await renderScreen();

    const dot = within(memberRow("María Ñíguez")).getByRole("img", {
      name: "Membership past due",
    });
    expect(dot).toHaveAttribute("title", "Membership past due");
    expect(dot).toHaveClass("directory-dot-danger");
    expect(
      within(memberRow("Ana Admin")).queryByRole("img", {
        name: "Membership past due",
      }),
    ).toBeNull();
  });

  it.each([
    "pending",
    "trialing",
    "active",
    "cancelled",
    "waived",
    null,
  ] as const)(
    "no señala en la fila la membresía %s: el estado está en la ficha",
    async (membershipStatus) => {
      stubApi({
        kind: "admin",
        members: [{ ...MARIA_PARA_ADMIN, membershipStatus }],
      });

      await renderScreen();

      const row = memberRow("María Ñíguez");
      expect(within(row).queryByRole("img")).toBeNull();
      expect(within(row).queryByText(/Membership/)).toBeNull();
    },
  );

  it("no enseña la membresía a quien no es Admin", async () => {
    stubApi({ kind: "member", members: [MARIA] });

    await renderScreen();

    expect(
      within(memberRow("María Ñíguez")).queryByText(/Membership/),
    ).toBeNull();
  });

  it("se escribe en español", async () => {
    stubApi({ kind: "admin", members: [PAST_DUE_MARIA] });

    await renderScreen("es");

    expect(
      within(memberRow("María Ñíguez")).getByRole("img", {
        name: "Membresía vencida",
      }),
    ).toHaveAttribute("title", "Membresía vencida");
  });
});
describe("marca de sin evaluar", () => {
  const SIN_EVALUAR: CoachDirectoryMember = {
    ...NEREA,
    isEvaluated: false,
    emergencyContact: null,
  };
  const EVALUADA: CoachDirectoryMember = {
    ...MARIA,
    isEvaluated: true,
    emergencyContact: null,
  };

  it.each([
    ["Coach", { kind: "coach", members: [EVALUADA, SIN_EVALUAR] }],
    [
      "Admin",
      {
        kind: "admin",
        members: [
          { ...MARIA_PARA_ADMIN, isEvaluated: true },
          { ...ZOE, status: "active", isEvaluated: false },
        ],
      },
    ],
  ] as const)(
    "a un %s le marca sólo a quien no tiene evaluación",
    async (_role, stub) => {
      stubApi(stub);

      await renderScreen();

      const unevaluated = stub.members[1].fullName;
      expect(
        within(memberRow(unevaluated)).getByRole("link", {
          name: `Not evaluated: evaluate ${unevaluated}`,
        }),
      ).toBeVisible();
      expect(
        within(memberRow("María Ñíguez")).queryByText("Not evaluated"),
      ).toBeNull();
    },
  );

  it("la marca lleva a la evaluación de esa persona", async () => {
    stubApi({ kind: "coach", members: [SIN_EVALUAR] });

    await renderScreen();

    expect(
      within(memberRow("Nerea Ruiz")).getByRole("link", {
        name: /Not evaluated/,
      }),
    ).toHaveAttribute("href", `/evaluaciones?miembro=${NEREA.userId}`);
  });

  it("no marca a un dado de baja: no se le puede crear evaluación", async () => {
    stubApi({
      // Sin pedir los dados de baja: aquí sólo importa cómo se pinta la fila.
      respond: () =>
        jsonResponse(200, {
          data: {
            kind: "admin",
            members: [{ ...ZOE, isEvaluated: false }],
            availableFilters: FILTERS_BY_KIND.admin,
            total: 1,
          },
        }),
    });

    await renderScreen();

    expect(
      within(memberRow("Zoe Zapata")).getByText("Deactivated"),
    ).toBeVisible();
    expect(
      within(memberRow("Zoe Zapata")).queryByText("Not evaluated"),
    ).toBeNull();
  });

  it("a un Player o un Committee no le enseña ninguna marca de evaluación", async () => {
    stubApi({ kind: "member", members: [MARIA, NEREA] });

    await renderScreen();

    expect(screen.queryByText("Not evaluated")).toBeNull();
    expect(screen.queryByRole("link", { name: /evaluate/i })).toBeNull();
  });

  it("se escribe en español", async () => {
    stubApi({ kind: "coach", members: [SIN_EVALUAR] });

    await renderScreen("es");

    expect(
      within(memberRow("Nerea Ruiz")).getByRole("link", {
        name: "Sin evaluar: evaluar a Nerea Ruiz",
      }),
    ).toHaveTextContent("Sin evaluar");
  });
});

/** La columna de asistencia (#396, FR-015, FR-019). El porcentaje lo cuenta
 * y ordena el servidor (#394): la pantalla lo pinta, pinta "Sin datos" a
 * quien no tiene sesiones elegibles y pide el orden. */
describe("columna de asistencia", () => {
  const CON_ASISTENCIA: DirectoryMember = {
    ...MARIA,
    attendance: { kind: "rate", percent: 90, sessions: 18 },
  };
  const SIN_ASISTENCIA: DirectoryMember = NEREA;

  function attendanceCell(name: string): HTMLElement {
    const row = memberRow(name);
    const cells = within(row).getAllByRole("cell");
    const lastCell = cells[cells.length - 1];
    if (lastCell === undefined) {
      throw new Error(`La fila de ${name} no tiene celdas.`);
    }
    return lastCell;
  }

  it("pinta el porcentaje de cada socio bajo la cabecera de asistencia", async () => {
    stubApi({ members: [CON_ASISTENCIA, SIN_ASISTENCIA] });

    await renderScreen();

    expect(columnHeader("Attendance")).toBeVisible();
    expect(attendanceCell("María Ñíguez")).toHaveTextContent(/^90%$/);
  });

  it("pinta sin datos a quien no tiene sesiones elegibles, no un 0", async () => {
    stubApi({ members: [CON_ASISTENCIA, SIN_ASISTENCIA] });

    await renderScreen();

    expect(attendanceCell("Nerea Ruiz")).toHaveTextContent(/^No data$/);
  });

  it("se escribe en español, con el símbolo separado", async () => {
    stubApi({ members: [CON_ASISTENCIA, SIN_ASISTENCIA] });

    await renderScreen("es");

    expect(columnHeader("Asistencia")).toBeVisible();
    expect(attendanceCell("María Ñíguez").textContent).toBe("90 %");
    expect(attendanceCell("Nerea Ruiz")).toHaveTextContent(/^Sin datos$/);
  });

  it("pide la asistencia de mayor a menor desde la hoja, y al repetir, al revés", async () => {
    stubApi();
    await renderScreen();

    await sortFromSheet("Attendance");
    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("attendance");
    });
    expect(lastRequest().get("direction")).toBe("desc");
    expect(columnHeader("Attendance")).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    await sortFromSheet("Attendance");
    await waitFor(() => {
      expect(lastRequest().get("direction")).toBe("asc");
    });
    expect(columnHeader("Attendance")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("enseña la lista en el orden que responde el servidor, con los sin datos al final", async () => {
    const MENOS: DirectoryMember = {
      ...TOMAS,
      attendance: { kind: "rate", percent: 40, sessions: 4 },
    };
    stubApi({ members: [CON_ASISTENCIA, MENOS, SIN_ASISTENCIA] });
    await renderScreen();

    await sortBy("Attendance");

    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("attendance");
    });
    expect(listedNames()).toEqual([
      "María Ñíguez",
      "Tomás Errekondo Aranburu",
      "Nerea Ruiz",
    ]);
  });

  it("ofrece el orden por asistencia en español", async () => {
    stubApi();
    await renderScreen("es");

    await sortFromSheet("Asistencia", "es");

    await waitFor(() => {
      expect(lastRequest().get("sort")).toBe("attendance");
    });
  });
});

// #427: "Ver todos" y un socio de la búsqueda global llegan con el texto.
describe("llegar con un texto buscado", () => {
  it("pone el texto en la búsqueda y la primera lectura ya lo filtra", async () => {
    stubApi({ members: [MARIA, NEREA] });

    render(
      <DirectoryScreen
        locale="en"
        initialQuery={{ ...DEFAULT_DIRECTORY_QUERY, search: "nerea" }}
      />,
    );

    await waitFor(() => {
      expect(listedNames()).toEqual(["Nerea Ruiz"]);
    });
    expect(screen.getByLabelText("Search by name")).toHaveValue("nerea");
    expect(requestedUrls).toHaveLength(1);
    expect(lastRequest().get("q")).toBe("nerea");
  });
});

// #497: filtros por posición, grupo, AUF y membresía, en la dirección.
describe("filtros del directorio", () => {
  // Desde #548 los filtros viven en el popover de Filtros, que se abre
  // desde 768 px. Los dos casos de la hoja del móvil lo dicen ellos mismos.
  beforeEach(showAsDesktop);

  function filterBar(): Promise<HTMLElement> {
    return openFilters();
  }

  function optionsOf(select: HTMLElement): readonly string[] {
    return within(select)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
  }

  it("ofrece a cualquiera la posición, con las del club y sin posición", async () => {
    stubApi({ members: [MARIA, TOMAS] });
    await renderScreen();

    const position = await within(await filterBar()).findByRole("combobox", {
      name: "Position",
    });
    await waitFor(() => {
      expect(optionsOf(position)).toEqual([
        "All positions",
        "Goalkeeper",
        "Defender",
        "Forward",
        "No position",
      ]);
    });
  });

  it("a un Player no le enseña el grupo, el AUF ni la membresía, ni pide los grupos", async () => {
    stubApi({ kind: "member", availableFilters: ["position"] });
    await renderScreen();

    const bar = await filterBar();
    expect(
      within(bar).queryByRole("combobox", { name: "Group" }),
    ).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole("combobox", { name: "AUF" }),
    ).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole("combobox", { name: "Membership" }),
    ).not.toBeInTheDocument();
    expect(groupRequests).toEqual([]);
  });

  it.each([
    ["Coach", "coach", { ...MARIA, isEvaluated: true, emergencyContact: null }],
    [
      "Committee",
      "committee",
      {
        ...MARIA,
        email: "maria@club.test",
        phone: null,
        emergencyContact: null,
      },
    ],
  ] as const)(
    "a un %s le ofrece el grupo, pero no el AUF ni la membresía",
    async (_role, kind, member) => {
      stubApi({
        kind,
        members: [member],
        availableFilters: ["position", "group"],
      });
      await renderScreen();

      const group = await within(await filterBar()).findByRole("combobox", {
        name: "Group",
      });
      await waitFor(() => {
        expect(optionsOf(group)).toEqual(["All groups", "Senior Squad"]);
      });
      expect(
        within(await filterBar()).queryByRole("combobox", { name: "AUF" }),
      ).not.toBeInTheDocument();
    },
  );

  it("ofrece a un Admin el AUF y la membresía con todos sus valores", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();

    expect(
      optionsOf(
        within(await filterBar()).getByRole("combobox", { name: "AUF" }),
      ),
    ).toEqual([
      "Any AUF",
      "No AUF number",
      "Expired",
      "Expires within 30 days",
      "Not verified",
    ]);
    expect(
      optionsOf(
        within(await filterBar()).getByRole("combobox", { name: "Membership" }),
      ),
    ).toEqual([
      "Any membership",
      "Pending",
      "Trial",
      "Active",
      "Payment failed",
      "Cancelled",
      "Waived",
      "No membership",
    ]);
  });

  it("pide al servidor la posición elegida y enseña lo que responde", async () => {
    stubApi({ members: [MARIA, NEREA, TOMAS] });
    await renderScreen();
    const user = userEvent.setup();
    const position = within(await filterBar()).getByRole("combobox", {
      name: "Position",
    });
    await within(position).findByRole("option", { name: "Goalkeeper" });

    await user.selectOptions(position, "Goalkeeper");

    await waitFor(() => {
      expect(listedNames()).toEqual(["Nerea Ruiz"]);
    });
    expect(lastRequest().get("position")).toBe(GOALKEEPER.id);
    expect(screen.getByText("1 member")).toBeVisible();
  });

  it("combina los filtros con el rol y la búsqueda en la misma petición", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();
    const user = userEvent.setup();

    // El rol está en la barra, fuera del popover: pulsarlo lo cierra (#548).
    await user.click(screen.getByRole("radio", { name: "Coach" }));
    const bar = await filterBar();
    await within(bar).findByRole("option", { name: "Senior Squad" });
    await user.selectOptions(
      within(bar).getByRole("combobox", { name: "Group" }),
      "Senior Squad",
    );
    await user.selectOptions(
      within(bar).getByRole("combobox", { name: "AUF" }),
      "Expires within 30 days",
    );
    await user.selectOptions(
      within(bar).getByRole("combobox", { name: "Membership" }),
      "No membership",
    );
    await user.type(screen.getByLabelText("Search by name"), "mar");

    await waitFor(() => {
      expect(lastRequest().get("q")).toBe("mar");
    });
    expect(Object.fromEntries(lastRequest())).toMatchObject({
      role: "Coach",
      group: SENIOR_GROUP.id,
      auf: "expiring",
      membership: "none",
    });
  });

  it("dice que no hay nadie con esos filtros y deja quitarlos", async () => {
    stubApi({ members: [MARIA] });
    await renderScreen();
    const user = userEvent.setup();
    const position = within(await filterBar()).getByRole("combobox", {
      name: "Position",
    });
    await within(position).findByRole("option", { name: "No position" });

    await user.selectOptions(position, "No position");
    await waitFor(() => {
      expect(screen.getByText("No members match these filters")).toBeVisible();
    });
    expect(
      screen.getByText(
        "Showing all roles · Position: No position. Try removing a filter.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
    expect(lastRequest().get("position")).toBeNull();
    expect(
      within(await filterBar()).getByRole("combobox", { name: "Position" }),
    ).toHaveValue("");
  });

  it("guarda los filtros en la dirección de la página", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();
    const user = userEvent.setup();

    await user.selectOptions(
      within(await filterBar()).getByRole("combobox", { name: "AUF" }),
      "Expired",
    );

    await waitFor(() => {
      expect(window.location.search).toBe("?auf=expired");
    });
    expect(window.location.pathname).toBe("/directorio");
  });

  it("arranca con los filtros que trae la dirección", async () => {
    stubApi({ members: [MARIA, NEREA] });

    render(
      <DirectoryScreen
        locale="en"
        initialQuery={{
          ...DEFAULT_DIRECTORY_QUERY,
          position: { kind: "position", positionId: FORWARD.id },
        }}
      />,
    );

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
    expect(requestedUrls).toHaveLength(1);
    expect(lastRequest().get("position")).toBe(FORWARD.id);
    const bar = await filterBar();
    await waitFor(() => {
      expect(
        within(bar).getByRole("combobox", { name: "Position" }),
      ).toHaveValue(FORWARD.id);
    });
  });

  it("dice en el botón Filtros cuántos filtros hay activos", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();

    await user.selectOptions(
      within(await filterBar()).getByRole("combobox", { name: "AUF" }),
      "Expired",
    );
    await user.selectOptions(
      within(await filterBar()).getByRole("combobox", { name: "Membership" }),
      "Active",
    );

    expect(
      screen.getByRole("button", { name: "Filters: 2 active" }),
    ).toBeVisible();
  });

  it("abre los filtros en una hoja y devuelve el foco al botón al cerrarla con Escape", async () => {
    showAsPhone();
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Filters" });

    await user.click(toggle);

    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    expect(
      within(sheet).getByRole("combobox", { name: "Membership" }),
    ).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("aplica lo que se elige en la hoja", async () => {
    showAsPhone();
    stubApi({ members: [MARIA, NEREA] });
    await renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    const position = within(sheet).getByRole("combobox", { name: "Position" });
    await within(position).findByRole("option", { name: "Forward" });

    await user.selectOptions(position, "Forward");
    await user.click(
      within(sheet).getByRole("button", { name: "Show results" }),
    );

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filters: 1 active" }),
    ).toHaveFocus();
  });

  it("explica el 403 de un filtro del rol y al reintentar pide sin él", async () => {
    stubApi({
      respond: (url) =>
        new URL(url, "http://localhost").searchParams.has("group")
          ? jsonResponse(403, {
              error: {
                code: "forbidden",
                message: "x",
                reason: "directory_filter_forbidden",
              },
            })
          : listingFor({ members: [MARIA] }, url),
    });
    render(
      <DirectoryScreen
        locale="en"
        initialQuery={{ ...DEFAULT_DIRECTORY_QUERY, groupId: SENIOR_GROUP.id }}
      />,
    );

    expect(
      await screen.findByText(
        "Your role can't use one of these filters. Try again without them.",
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(listedNames()).toEqual(["María Ñíguez"]);
    });
    expect(lastRequest().get("group")).toBeNull();
  });

  it("escribe en español los filtros y sus valores", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen("es");

    const bar = await openFilters("es");
    const position = within(bar).getByRole("combobox", { name: "Posición" });
    await within(position).findByRole("option", { name: "Portería" });
    expect(optionsOf(position)).toEqual([
      "Todas las posiciones",
      "Portería",
      "Defensa",
      "Ataque",
      "Sin posición",
    ]);
    expect(
      optionsOf(within(bar).getByRole("combobox", { name: "AUF" })),
    ).toEqual([
      "Cualquier AUF",
      "Sin número de AUF",
      "Vencido",
      "Vence en los próximos 30 días",
      "Sin verificar",
    ]);
    expect(
      optionsOf(within(bar).getByRole("combobox", { name: "Membresía" })),
    ).toEqual([
      "Cualquier membresía",
      "Pendiente",
      "En prueba",
      "Activa",
      "Pago fallido",
      "Cancelada",
      "Exenta",
      "Sin membresía",
    ]);
    expect(screen.getByRole("button", { name: "Filtros" })).toBeVisible();
  });
});
// #499: el contacto de cada socio según quién mira, y sus dos filtros.
describe("el contacto en el directorio", () => {
  const LUIS = {
    name: "Luis Ñíguez",
    phone: "+61 499 111 222",
    relationship: "Father",
  } as const;
  const MARIA_CON_CONTACTO = {
    email: "maria@club.test",
    phone: "0412 345 678",
    emergencyContact: LUIS,
  } as const;
  const NEREA_SIN_CONTACTO = {
    email: "nerea@club.test",
    phone: null,
    emergencyContact: null,
  } as const;

  it.each([
    [
      "Admin",
      {
        kind: "admin",
        members: [{ ...MARIA_PARA_ADMIN, ...MARIA_CON_CONTACTO }],
      },
    ],
    [
      "Committee",
      { kind: "committee", members: [{ ...MARIA, ...MARIA_CON_CONTACTO }] },
    ],
  ] as const)(
    "a un %s le enseña el correo, el teléfono y el contacto de emergencia, que se pulsan",
    async (_role, stub) => {
      stubApi(stub);
      await renderScreen();

      expect(columnHeader("Contact")).toBeVisible();
      const cell = memberRow("María Ñíguez");
      expect(
        within(cell).getByRole("link", { name: "maria@club.test" }),
      ).toHaveAttribute("href", "mailto:maria@club.test");
      expect(
        within(cell).getByRole("link", { name: "0412 345 678" }),
      ).toHaveAttribute("href", "tel:0412345678");
      expect(within(cell).getByText(/Luis Ñíguez/)).toBeVisible();
      expect(within(cell).getByText(/Father/)).toBeVisible();
      expect(
        within(cell).getByRole("link", { name: "+61 499 111 222" }),
      ).toHaveAttribute("href", "tel:+61499111222");
    },
  );

  it("a un Coach le enseña sólo el contacto de emergencia", async () => {
    stubApi({
      kind: "coach",
      // Aunque el servidor mandara el correo, la vista del Coach no lo pinta.
      members: [
        {
          ...MARIA,
          isEvaluated: true,
          emergencyContact: LUIS,
          email: "maria@club.test",
        },
      ],
    });
    await renderScreen();

    const cell = memberRow("María Ñíguez");
    expect(within(cell).getByText(/Emergency contact/)).toBeVisible();
    expect(
      within(cell).getByRole("link", { name: "+61 499 111 222" }),
    ).toHaveAttribute("href", "tel:+61499111222");
    expect(within(cell).queryByText(/Email/)).not.toBeInTheDocument();
    expect(
      within(memberRow("María Ñíguez")).queryByRole("link", {
        name: /maria@club\.test/,
      }),
    ).not.toBeInTheDocument();
  });

  it("a un Player no le enseña la columna ni ningún enlace de contacto", async () => {
    stubApi({ kind: "member", members: [MARIA] });
    await renderScreen();

    expect(
      screen.queryByRole("columnheader", { name: "Contact" }),
    ).not.toBeInTheDocument();
    const links = within(memberRow("María Ñíguez")).queryAllByRole("link");
    for (const link of links) {
      expect(link.getAttribute("href")).not.toMatch(/^(tel|mailto):/);
    }
  });

  it("pone la etiqueta con un guion en el dato que falta", async () => {
    stubApi({
      kind: "committee",
      members: [{ ...NEREA, ...NEREA_SIN_CONTACTO }],
    });
    await renderScreen();

    const cell = memberRow("Nerea Ruiz");
    expect(within(cell).getByText("Phone").parentElement).toHaveTextContent(
      `Phone${MISSING}`,
    );
    expect(
      within(cell).getByText("Emergency contact").parentElement,
    ).toHaveTextContent(`Emergency contact${MISSING}`);
  });

  it("ofrece a quien ve el contacto los filtros sin teléfono y sin contacto de emergencia, y los lleva a la dirección", async () => {
    showAsDesktop();
    stubApi({
      kind: "committee",
      members: [{ ...NEREA, ...NEREA_SIN_CONTACTO }],
    });
    await renderScreen();
    const user = userEvent.setup();
    const bar = await openFilters();

    await user.click(within(bar).getByRole("checkbox", { name: "No phone" }));
    await user.click(
      within(bar).getByRole("checkbox", { name: "No emergency contact" }),
    );

    await waitFor(() => {
      expect(lastRequest().get("withoutEmergencyContact")).toBe("true");
    });
    expect(lastRequest().get("withoutPhone")).toBe("true");
    expect(window.location.search).toBe(
      "?withoutPhone=true&withoutEmergencyContact=true",
    );
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("no ofrece los filtros de contacto a un Coach", async () => {
    showAsDesktop();
    stubApi({
      kind: "coach",
      members: [{ ...MARIA, isEvaluated: true, emergencyContact: null }],
    });
    await renderScreen();

    const bar = await openFilters();
    expect(
      within(bar).queryByRole("checkbox", { name: "No phone" }),
    ).not.toBeInTheDocument();
  });

  it("lo dice todo en español", async () => {
    showAsDesktop();
    stubApi({
      kind: "committee",
      members: [{ ...MARIA, ...MARIA_CON_CONTACTO }],
    });
    await renderScreen("es");

    const cell = within(memberRow("María Ñíguez")).getByRole("cell", {
      name: /Contacto/,
    });
    expect(columnHeader("Contacto")).toBeVisible();
    expect(within(cell).getByText("Correo")).toBeVisible();
    expect(within(cell).getByText("Teléfono")).toBeVisible();
    expect(within(cell).getByText("Contacto de emergencia")).toBeVisible();
    const bar = await openFilters("es");
    expect(
      within(bar).getByRole("checkbox", { name: "Sin teléfono" }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("checkbox", { name: "Sin contacto de emergencia" }),
    ).toBeInTheDocument();
  });
});
// #548: la cabecera, la barra de una fila, el popover de Filtros y las fichas
// de los filtros activos.

/** El nombre visible de un campo, por su `<label>`. */
function fieldLabel(field: HTMLElement): string {
  const id = field.getAttribute("id");
  return id === null
    ? ""
    : (document.querySelector(`label[for="${id}"]`)?.textContent ?? "");
}

describe("cabecera del directorio", () => {
  it("dice cuántos socios enseña de cuántos tiene el club", async () => {
    stubApi({ members: [MARIA, NEREA, TOMAS], total: 5 });

    await renderScreen();

    expect(
      screen.getByRole("heading", { level: 1, name: "Directory" }),
    ).toBeVisible();
    expect(screen.getByText("3 of 5 members")).toBeVisible();
  });

  it("lo dice en singular con un solo socio en el club", async () => {
    stubApi({ members: [MARIA], total: 1 });

    await renderScreen();

    expect(screen.getByText("1 of 1 member")).toBeVisible();
  });

  it("lo dice en español", async () => {
    stubApi({ members: [MARIA, NEREA], total: 4 });

    await renderScreen("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "Directorio" }),
    ).toBeVisible();
    expect(screen.getByText("2 de 4 miembros")).toBeVisible();
  });

  it("a un Admin le pone correo, exportar e invitar como botones de solo icono con su título", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });

    await renderScreen();

    const email = screen.getByRole("button", { name: "Write an email" });
    const csv = screen.getByRole("button", { name: "Export CSV" });
    const invite = screen.getByRole("link", { name: "Invite member" });
    expect(email).toHaveAttribute("title", "Write an email");
    expect(csv).toHaveAttribute("title", "Export CSV");
    expect(invite).toHaveAttribute("title", "Invite member");
    for (const action of [email, csv, invite]) {
      expect(action).toHaveTextContent("");
    }
  });

  it("a un Committee le pone correo y exportar, sin invitar", async () => {
    stubApi({
      kind: "committee",
      members: [
        {
          ...MARIA,
          email: "maria@club.test",
          phone: null,
          emergencyContact: null,
        },
      ],
    });

    await renderScreen();

    expect(
      screen.getByRole("button", { name: "Write an email" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Invite member" })).toBeNull();
  });

  it.each([
    ["Coach", "coach", { ...MARIA, isEvaluated: true, emergencyContact: null }],
    ["Player", "member", MARIA],
  ] as const)(
    "a un %s no le pone ninguna acción de la cabecera",
    async (_role, kind, member) => {
      stubApi({ kind, members: [member] });

      await renderScreen();

      expect(
        screen.queryByRole("button", { name: "Write an email" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Invite member" })).toBeNull();
    },
  );
});

describe("barra del directorio", () => {
  it("lleva la búsqueda, el rol, Filtros y el botón del panel lateral (#550)", async () => {
    stubApi();

    await renderScreen();

    expect(
      screen.getByRole("searchbox", { name: "Search by name" }),
    ).toBeVisible();
    const roles = screen.getByRole("group", { name: "Filter by role" });
    expect(
      within(roles)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["All", "Player", "Coach", "Committee", "Admin"]);
    expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Side panel" })).toBeVisible();
  });

  it("a un Coach le da la misma barra, con sólo sus filtros en el popover", async () => {
    showAsDesktop();
    stubApi({
      kind: "coach",
      members: [{ ...MARIA, isEvaluated: true, emergencyContact: null }],
    });
    await renderScreen();

    const popover = await openFilters();

    expect(within(popover).getAllByRole("combobox").map(fieldLabel)).toEqual([
      "Position",
      "Group",
    ]);
    expect(within(popover).queryAllByRole("checkbox")).toEqual([]);
  });
});

describe("el popover de Filtros", () => {
  beforeEach(showAsDesktop);

  it("ofrece a un Admin los cuatro desplegables, las tres casillas y el pie", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();

    const popover = await openFilters();

    expect(popover.tagName).not.toBe("DIALOG");
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(popover).getAllByRole("combobox").map(fieldLabel)).toEqual([
      "Position",
      "Group",
      "AUF",
      "Membership",
    ]);
    expect(within(popover).getAllByRole("checkbox").map(fieldLabel)).toEqual([
      "No phone",
      "No emergency contact",
      "Include deactivated accounts",
    ]);
    expect(
      within(popover).getByRole("button", { name: "Clear all" }),
    ).toBeVisible();
    expect(
      within(popover).getByRole("button", { name: "Show 1 member" }),
    ).toBeVisible();
  });

  it("filtra al elegir y Mostrar cierra el popover y devuelve el foco a Filtros", async () => {
    stubApi({ members: [MARIA, NEREA, TOMAS] });
    await renderScreen();
    const user = userEvent.setup();
    const popover = await openFilters();
    const position = within(popover).getByRole("combobox", {
      name: "Position",
    });
    await within(position).findByRole("option", { name: "Goalkeeper" });

    await user.selectOptions(position, "Goalkeeper");
    await waitFor(() => {
      expect(listedNames()).toEqual(["Nerea Ruiz"]);
    });
    await user.click(
      within(popover).getByRole("button", { name: "Show 1 member" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filters: 1 active" }),
    ).toHaveFocus();
  });

  it("cuenta los socios en plural en el botón Mostrar", async () => {
    stubApi({ members: [MARIA, NEREA] });
    await renderScreen();

    const popover = await openFilters();

    expect(
      within(popover).getByRole("button", { name: "Show 2 members" }),
    ).toBeVisible();
  });

  it("Borrar todo quita los filtros del popover y lo deja abierto", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();
    const user = userEvent.setup();
    const popover = await openFilters();
    await user.selectOptions(
      within(popover).getByRole("combobox", { name: "AUF" }),
      "Expired",
    );
    await user.click(
      within(popover).getByRole("checkbox", { name: "No phone" }),
    );
    await waitFor(() => {
      expect(lastRequest().get("withoutPhone")).toBe("true");
    });

    await user.click(
      within(popover).getByRole("button", { name: "Clear all" }),
    );

    await waitFor(() => {
      expect(lastRequest().get("auf")).toBeNull();
    });
    expect(lastRequest().get("withoutPhone")).toBeNull();
    expect(within(popover).getByRole("combobox", { name: "AUF" })).toHaveValue(
      "",
    );
    expect(
      within(popover).getByRole("checkbox", { name: "No phone" }),
    ).not.toBeChecked();
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeVisible();
  });

  it("Escape lo cierra y devuelve el foco a Filtros", async () => {
    stubApi();
    await renderScreen();
    await openFilters();

    await userEvent.setup().keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();
  });

  it("pulsar fuera lo cierra y devuelve el foco a Filtros", async () => {
    stubApi();
    await renderScreen();
    await openFilters();

    // El total de la cabecera: texto, nada que reciba el foco. El título ya
    // no sirve, porque lo recibe al volver de las solicitudes (#553).
    await userEvent.setup().click(screen.getByText("1 of 1 member"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();
  });

  it("pulsar otro control lo cierra y deja el foco en ese control", async () => {
    stubApi();
    await renderScreen();
    await openFilters();
    const search = screen.getByRole("searchbox", { name: "Search by name" });

    await userEvent.setup().click(search);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(search).toHaveFocus();
  });

  it("pulsar otra vez Filtros lo cierra", async () => {
    stubApi();
    await renderScreen();
    await openFilters();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se escribe en español", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen("es");

    const popover = await openFilters("es");

    expect(
      within(popover).getByRole("button", { name: "Borrar todo" }),
    ).toBeVisible();
    expect(
      within(popover).getByRole("button", { name: "Mostrar 1 miembro" }),
    ).toBeVisible();
    expect(
      within(popover).getByRole("checkbox", {
        name: "Incluir las cuentas desactivadas",
      }),
    ).toBeVisible();
  });
});

describe("la hoja de Filtros en el móvil", () => {
  it("lleva también la casilla de los dados de baja para un Admin", async () => {
    showAsPhone();
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    await renderScreen();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Filters" }));

    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(sheet.tagName).toBe("DIALOG");
    expect(
      within(sheet).getByRole("checkbox", {
        name: "Include deactivated accounts",
      }),
    ).toBeInTheDocument();
  });
});

describe("las fichas de los filtros activos", () => {
  function chipTexts(name = "Active filters"): readonly string[] {
    return within(screen.getByRole("list", { name }))
      .getAllByRole("listitem")
      .map((chip) => chip.textContent ?? "");
  }

  function renderWithFilters(locale: "en" | "es" = "en"): void {
    render(
      <DirectoryScreen
        locale={locale}
        initialQuery={{
          ...DEFAULT_DIRECTORY_QUERY,
          auf: "expired",
          withoutPhone: true,
        }}
      />,
    );
  }

  it("no enseña fichas sin filtros activos", async () => {
    stubApi();

    await renderScreen();

    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });

  it("enseña cada filtro activo con su nombre y su valor", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });

    renderWithFilters();

    await waitFor(() => {
      expect(chipTexts()).toEqual(["AUF: Expired", "No phone"]);
    });
    expect(
      screen.getByRole("button", { name: "Filters: 2 active" }),
    ).toBeVisible();
  });

  it("nombra la posición elegida", async () => {
    stubApi({ members: [MARIA] });

    render(
      <DirectoryScreen
        locale="en"
        initialQuery={{
          ...DEFAULT_DIRECTORY_QUERY,
          position: { kind: "position", positionId: FORWARD.id },
        }}
      />,
    );

    await waitFor(() => {
      expect(chipTexts()).toEqual(["Position: Forward"]);
    });
  });

  it("la ✕ quita ese filtro, de la petición y de la dirección", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    renderWithFilters();
    const remove = await screen.findByRole("button", {
      name: "Remove the filter AUF: Expired",
    });
    expect(remove).toHaveAttribute("title", "Remove the filter AUF: Expired");

    await userEvent.setup().click(remove);

    await waitFor(() => {
      expect(lastRequest().get("auf")).toBeNull();
    });
    expect(lastRequest().get("withoutPhone")).toBe("true");
    expect(window.location.search).toBe("?withoutPhone=true");
    expect(chipTexts()).toEqual(["No phone"]);
  });

  it("Borrar las quita todas", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });
    renderWithFilters();
    await screen.findByRole("list", { name: "Active filters" });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
  });

  it("se escriben en español", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });

    renderWithFilters("es");

    await waitFor(() => {
      expect(chipTexts("Filtros activos")).toEqual([
        "AUF: Vencido",
        "Sin teléfono",
      ]);
    });
    expect(
      screen.getByRole("button", { name: "Quitar el filtro AUF: Vencido" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Borrar" })).toBeVisible();
  });
});

/** La lista compacta del rediseño de E21 (#549, RF-3): el encabezado que
 * ordena, los puntos de estado que sólo ve el Admin, la fila del invitado y
 * la leyenda. Medidas: `docs/design/directorio-admin/README.md`. */
describe("la lista compacta (#549)", () => {
  /** Sin número de AUF: un punto de aviso. */
  const SIN_AUF: AdminDirectoryMember = {
    ...MARIA_PARA_ADMIN,
    aufNumber: null,
    aufExpiry: null,
  };
  /** Vigente, pero vence en los próximos 30 días: un punto de aviso. */
  const POR_VENCER: AdminDirectoryMember = {
    ...MARIA_PARA_ADMIN,
    aufExpiry: "2026-10-20",
    isAufExpiring: true,
  };
  /** Vencido y con la membresía atrasada: dos puntos de peligro. */
  const DOS_PUNTOS: AdminDirectoryMember = {
    ...VENCIDA,
    membershipStatus: "past_due",
  };

  function dotsOf(name: string): readonly (string | null)[] {
    return within(memberRow(name))
      .queryAllByRole("img")
      .map((dot) => dot.getAttribute("title"));
  }

  it("pone el encabezado Miembro, Rol, Posición y Asistencia, la última abreviada", async () => {
    stubApi({ members: [MARIA] });

    await renderScreen();

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Member↑", "Role", "Position", "Attend."]);
    expect(columnHeader("Attendance")).toBeVisible();
  });

  it("escribe el encabezado en español", async () => {
    stubApi({ members: [MARIA] });

    await renderScreen("es");

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Miembro↑", "Rol", "Posición", "Asist."]);
    expect(columnHeader("Asistencia")).toBeVisible();
  });

  it("pinta el avatar a 32 px", async () => {
    const photoUrl = "https://storage.test/member-photos/nerea.webp?token=t";
    stubApi({ members: [{ ...NEREA, photoUrl }] });

    await renderScreen();

    const photo = within(memberRow("Nerea Ruiz")).getByRole("presentation");
    expect(photo).toHaveAttribute("width", "32");
    expect(photo).toHaveAttribute("height", "32");
  });

  it("marca sólo el encabezado activo, con ↑ o ↓ según el sentido", async () => {
    stubApi();
    await renderScreen();
    expect(within(columnHeader("Role")).queryByText(/[↑↓]/)).toBeNull();

    await sortBy("Member");

    await waitFor(() => {
      expect(within(columnHeader("Member")).getByText("↓")).toBeVisible();
    });
    await sortBy("Attendance");
    await waitFor(() => {
      expect(within(columnHeader("Attendance")).getByText("↓")).toBeVisible();
    });
    expect(within(columnHeader("Member")).queryByText(/[↑↓]/)).toBeNull();
  });

  it("a un Admin ya no le pone selector de rol ni botón Guardar en la fila", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });

    await renderScreen();

    const table = screen.getByRole("table");
    expect(within(table).queryByRole("combobox")).toBeNull();
    expect(within(table).queryByRole("button", { name: /save/i })).toBeNull();
    expect(
      within(memberRow("María Ñíguez")).getByRole("cell", { name: "Coach" }),
    ).toBeVisible();
  });

  it.each([
    ["el AUF vencido", VENCIDA, ["AUF expired"], "danger"],
    [
      "la membresía atrasada",
      PAST_DUE_MARIA,
      ["Membership past due"],
      "danger",
    ],
    ["la falta de número de AUF", SIN_AUF, ["No AUF number"], "warning"],
    ["el AUF que vence pronto", POR_VENCER, ["AUF expiring soon"], "warning"],
  ] as const)(
    "señala a un Admin %s con un punto que se lee y lleva su title",
    async (_case, member, titles, tone) => {
      stubApi({ kind: "admin", members: [member] });

      await renderScreen();

      expect(dotsOf(member.fullName)).toEqual(titles);
      const [title] = titles;
      const dot = within(memberRow(member.fullName)).getByRole("img", {
        name: title,
      });
      expect(dot).toHaveClass(`directory-dot-${tone}`);
    },
  );

  it("pone los dos puntos de peligro a quien tiene el AUF vencido y la membresía atrasada", async () => {
    stubApi({ kind: "admin", members: [DOS_PUNTOS] });

    await renderScreen();

    expect(dotsOf("Ana Admin")).toEqual(["AUF expired", "Membership past due"]);
  });

  it("no pone ningún punto a quien lo tiene todo al día", async () => {
    stubApi({ kind: "admin", members: [MARIA_PARA_ADMIN] });

    await renderScreen();

    expect(dotsOf("María Ñíguez")).toEqual([]);
  });

  it("escribe los puntos en español", async () => {
    stubApi({ kind: "admin", members: [DOS_PUNTOS, SIN_AUF, POR_VENCER] });

    await renderScreen("es");

    expect(dotsOf("Ana Admin")).toEqual(["AUF vencido", "Membresía vencida"]);
    expect(
      screen.getAllByRole("img", { name: "Sin número de AUF" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "AUF por vencer" })).toHaveLength(
      1,
    );
  });

  it("pone a un Admin la leyenda de los puntos debajo de la lista", async () => {
    stubApi({ kind: "admin", members: [VENCIDA] });

    await renderScreen();

    const legend = screen.getByRole("list", { name: "Status dots" });
    expect(within(legend).getByText("Needs action")).toBeVisible();
    expect(within(legend).getByText("Check soon")).toBeVisible();
  });

  it("escribe la leyenda en español", async () => {
    stubApi({ kind: "admin", members: [VENCIDA] });

    await renderScreen("es");

    const legend = screen.getByRole("list", { name: "Puntos de estado" });
    expect(within(legend).getByText("Necesita acción")).toBeVisible();
    expect(within(legend).getByText("Revisar pronto")).toBeVisible();
  });

  it.each([
    ["Committee", "committee"],
    ["Coach", "coach"],
    ["Player", "member"],
  ] as const)(
    "a un %s no le pone puntos de AUF ni de membresía, ni la leyenda (D4)",
    async (_role, kind) => {
      stubApi({ kind, members: [DOS_PUNTOS, SIN_AUF] });

      await renderScreen();

      expect(screen.queryAllByRole("img")).toEqual([]);
      expect(screen.queryByRole("list", { name: "Status dots" })).toBeNull();
    },
  );

  it("escribe en español la fila de un invitado", async () => {
    stubApi({ members: [INVITED_NEREA] });

    await renderScreen("es");

    const invited = memberRow("Nerea Ruiz");
    expect(within(invited).getByText("Invitado")).toBeVisible();
    expect(
      within(invited).getByText(
        "Invitado el 5 de octubre de 2026 · todavía no ha entrado",
      ),
    ).toBeVisible();
  });

  it("escribe en español el estado vacío con el rol y el filtro activos", async () => {
    stubApi({ members: [MARIA] });
    await renderScreen("es");
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Comité" }));
    await user.type(screen.getByLabelText("Buscar por nombre"), "zzz");

    await waitFor(() => {
      expect(
        screen.getByText("Ningún miembro coincide con estos filtros"),
      ).toBeVisible();
    });
    expect(
      screen.getByText(
        "Mostrando Comité · Nombre: zzz. Prueba a quitar un filtro.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Borrar filtros" }),
    ).toBeVisible();
  });
});
