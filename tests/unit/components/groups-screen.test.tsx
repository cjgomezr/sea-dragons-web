import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupsScreen } from "@/components/groups/GroupsScreen";
import type {
  GroupCandidate,
  GroupRosterMember,
} from "@/lib/groups/group-members";
import type {
  AudienceEvent,
  AudiencePost,
  GroupAudience,
} from "@/lib/groups/group-audience";
import type { GroupOverview } from "@/lib/groups/groups";

/**
 * La pantalla Grupos: la de E4 (#228) rehecha en escritorio por #828 (E32,
 * RF-2, RF-3 y RF-8). Las escrituras ya existían (#226 y #227); lo que se
 * prueba aquí es que la pantalla enseña lo que el servidor confirmó y nada
 * más: un nombre repetido no entra en la lista, un grupo que otro borró sale
 * de ella, y una acción en vuelo no se puede mandar dos veces.
 */

const SENIOR: GroupOverview = {
  id: "11111111-0000-4000-8000-000000000001",
  name: "Senior Squad",
  memberCount: 2,
  usage: { events: 2, posts: 1 },
  previewMembers: [],
};

const MASTERS: GroupOverview = {
  id: "22222222-0000-4000-8000-000000000002",
  name: "Masters Squad",
  memberCount: 0,
  usage: { events: 0, posts: 0 },
  previewMembers: [],
};

const NEREA: GroupCandidate = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Nerea Ruiz",
  isPendingActivation: false,
  positionName: "Forward",
  photoUrl: null,
  groupCount: 1,
};

const TOMAS: GroupCandidate = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Tomás Errekondo",
  isPendingActivation: false,
  positionName: "Goalkeeper",
  photoUrl: null,
  groupCount: 0,
};

const ANA: GroupCandidate = {
  id: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "Ana Admin",
  isPendingActivation: false,
  positionName: null,
  photoUrl: null,
  groupCount: 2,
};

const BEA: GroupCandidate = {
  id: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Bea Nadal",
  isPendingActivation: false,
  positionName: null,
  photoUrl: null,
  groupCount: 0,
};

type ApiCall = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

type Respond = () => Response | Promise<Response>;

type ApiStub = {
  readonly groups?: readonly GroupOverview[];
  readonly members?: readonly GroupRosterMember[];
  readonly candidates?: readonly GroupCandidate[];
  readonly loadGroups?: Respond;
  readonly createGroup?: Respond;
  readonly renameGroup?: Respond;
  readonly deleteGroup?: Respond;
  /** Devuelve `null` para dejar que responda la lista de arriba. */
  readonly loadDetail?: (url: string) => Response | Promise<Response> | null;
  readonly assignMember?: Respond;
  readonly removeMember?: Respond;
  readonly audience?: GroupAudience;
  readonly loadAudience?: Respond;
};

const NO_AUDIENCE: GroupAudience = {
  events: { items: [], total: 0 },
  posts: { items: [], total: 0 },
};

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: "x" } });
}

const NO_CONTENT = (): Response => new Response(null, { status: 204 });

const GROUPS_PATH = "/api/v1/groups";
const GROUP_PATH = /^\/api\/v1\/groups\/([^/]+)$/;
const MEMBERS_PATH = /^\/api\/v1\/groups\/([^/]+)\/members$/;
const CANDIDATES_PATH = /^\/api\/v1\/groups\/([^/]+)\/candidates$/;
const MEMBERSHIP_PATH = /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)$/;
const AUDIENCE_PATH = /^\/api\/v1\/groups\/([^/]+)\/audience$/;
const DIRECTORY_EMAILS_PATH = "/api/v1/directory/emails";

const CREATED_ID = "99999999-0000-4000-8000-000000000009";

/** El nombre que el cuerpo de la petición lleva, para que la respuesta de
 * crear o renombrar devuelva lo que se pidió y no un valor fijo. Crear y
 * renombrar responden el grupo a secas, sin uso ni vista previa. */
function nameIn(body: unknown): string {
  return (body as { name?: string }).name ?? "";
}

function groupResponses(url: string, body: unknown): Response {
  const renamed = GROUP_PATH.exec(url)?.[1] ?? "";
  return url === GROUPS_PATH
    ? jsonResponse(201, {
        data: { id: CREATED_ID, name: nameIn(body), memberCount: 0 },
      })
    : jsonResponse(200, {
        data: { id: renamed, name: nameIn(body), memberCount: 2 },
      });
}

function detailResponse(stub: ApiStub, url: string): Response {
  return MEMBERS_PATH.test(url)
    ? jsonResponse(200, { data: { members: stub.members ?? [NEREA] } })
    : jsonResponse(200, { data: { candidates: stub.candidates ?? [TOMAS] } });
}

/** Asignar responde el socio a secas, sin posición ni foto. */
function membershipResponse(stub: ApiStub, url: string): Response {
  const userId = MEMBERSHIP_PATH.exec(url)?.[2] ?? "";
  const member = (stub.candidates ?? [TOMAS]).find(
    (candidate) => candidate.id === userId,
  );
  const { id, fullName, isPendingActivation } = member ?? TOMAS;
  return jsonResponse(200, { data: { id, fullName, isPendingActivation } });
}

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined ? null : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      if (url === GROUPS_PATH && method === "GET") {
        return (
          stub.loadGroups?.() ??
          jsonResponse(200, { data: { groups: stub.groups ?? [SENIOR] } })
        );
      }
      if (url === GROUPS_PATH && method === "POST") {
        return stub.createGroup?.() ?? groupResponses(url, body);
      }
      if (GROUP_PATH.test(url) && method === "PATCH") {
        return stub.renameGroup?.() ?? groupResponses(url, body);
      }
      if (GROUP_PATH.test(url) && method === "DELETE") {
        return stub.deleteGroup?.() ?? NO_CONTENT();
      }
      if (MEMBERSHIP_PATH.test(url) && method === "PUT") {
        return stub.assignMember?.() ?? membershipResponse(stub, url);
      }
      if (MEMBERSHIP_PATH.test(url) && method === "DELETE") {
        return stub.removeMember?.() ?? NO_CONTENT();
      }
      if (MEMBERS_PATH.test(url) || CANDIDATES_PATH.test(url)) {
        return stub.loadDetail?.(url) ?? detailResponse(stub, url);
      }
      if (AUDIENCE_PATH.test(url)) {
        return (
          stub.loadAudience?.() ??
          jsonResponse(200, { data: stub.audience ?? NO_AUDIENCE })
        );
      }
      if (url === DIRECTORY_EMAILS_PATH) {
        return method === "GET"
          ? jsonResponse(200, { data: { limit: 90, remaining: 90 } })
          : jsonResponse(200, {
              data: { sentCount: 1, failed: [], remaining: 89 },
            });
      }
      throw new Error(`Petición inesperada: ${method} ${url}`);
    }),
  );
}

/** Por defecto mira un Admin, que puede escribir desde el Directorio. */
async function renderScreen(
  locale: "en" | "es" = "en",
  options: { readonly canWriteEmails: boolean } = { canWriteEmails: true },
): Promise<void> {
  render(
    <GroupsScreen locale={locale} canWriteEmails={options.canWriteEmails} />,
  );
  await screen.findByRole("region", {
    name: locale === "en" ? "Club groups" : "Grupos del club",
  });
}

function groupsSection(): HTMLElement {
  return screen.getByRole("region", { name: /Club groups|Grupos del club/ });
}

function groupRow(name: string): HTMLElement {
  return within(groupsSection()).getByRole("button", { name });
}

/** Los nombres accesibles de las filas, que son el nombre del grupo. */
function rowNames(): string[] {
  return within(groupsSection())
    .queryAllByRole("listitem")
    .map((item) => {
      const button = within(item).getByRole("button");
      const labelId = button.getAttribute("aria-labelledby") ?? "";
      return document.getElementById(labelId)?.textContent ?? "";
    });
}

function statusNotice(): HTMLElement {
  return screen.getByRole("status");
}

async function createGroup(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "New group name" }),
    name,
  );
  await user.click(screen.getByRole("button", { name: "Create" }));
}

async function selectGroup(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(groupRow(name));
  await screen.findByRole("heading", { level: 2, name });
}

function groupPanel(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/** Abre el grupo y espera a que sus socios hayan llegado. */
async function openGroup(name: string): Promise<HTMLElement> {
  await selectGroup(name);
  await screen.findByRole("searchbox", { name: "Search in this group" });
  return groupPanel(name);
}

async function openPicker(panel: HTMLElement): Promise<void> {
  const user = userEvent.setup();
  await user.click(within(panel).getByRole("button", { name: "Add members" }));
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("la lista de grupos", () => {
  it("lista los grupos del club con su conteo, en orden alfabético", async () => {
    stubApi({ groups: [SENIOR, MASTERS] });

    await renderScreen();

    expect(rowNames()).toEqual(["Masters Squad", "Senior Squad"]);
    expect(groupRow("Senior Squad")).toHaveAccessibleDescription(
      "2 events · 1 post · 2 members",
    );
    expect(groupRow("Masters Squad")).toHaveAccessibleDescription(
      "Not used yet · 0 members",
    );
  });

  it("encabeza la lista con cuántos grupos hay y la columna de miembros", async () => {
    stubApi({ groups: [SENIOR, MASTERS] });

    await renderScreen();

    expect(within(groupsSection()).getByText("2 GROUPS")).toBeVisible();
    expect(within(groupsSection()).getByText("MEMBERS")).toBeVisible();
  });

  it("enseña el uso de cada grupo y su conteo en la fila", async () => {
    stubApi({ groups: [SENIOR, MASTERS] });

    await renderScreen();

    expect(
      within(groupRow("Senior Squad")).getByText("2 events · 1 post"),
    ).toBeVisible();
    expect(
      within(groupRow("Masters Squad")).getByText("Not used yet"),
    ).toBeVisible();
    expect(within(groupRow("Senior Squad")).getByText("2")).toBeVisible();
  });

  it("pinta hasta tres avatares de la vista previa en la fila", async () => {
    const preview = [ANA, NEREA, TOMAS].map(({ id, fullName }) => ({
      id,
      fullName,
      photoUrl: null,
    }));
    stubApi({
      groups: [{ ...SENIOR, memberCount: 5, previewMembers: preview }],
    });

    await renderScreen();

    expect(within(groupRow("Senior Squad")).getByText("AA")).toBeVisible();
    expect(within(groupRow("Senior Squad")).getByText("NR")).toBeVisible();
    expect(within(groupRow("Senior Squad")).getByText("TE")).toBeVisible();
  });

  it("dice con una frase que el club no tiene grupos e invita a crear el primero", async () => {
    stubApi({ groups: [] });

    await renderScreen();

    expect(
      screen.getByText("No groups yet. Create the first one above."),
    ).toBeVisible();
    expect(within(groupsSection()).queryAllByRole("listitem")).toEqual([]);
  });

  it("sin grupos no pinta el panel de elegir uno", async () => {
    stubApi({ groups: [] });

    await renderScreen();

    expect(
      screen.queryByText("Pick a group to see and manage its members."),
    ).toBeNull();
  });

  it("sin grupo elegido, el panel invita a elegir uno", async () => {
    stubApi({ groups: [SENIOR] });

    await renderScreen();

    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
  });

  it("la fila elegida lleva aria-current y pulsarla otra vez la deselecciona", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR, MASTERS] });
    await renderScreen();

    await selectGroup("Senior Squad");
    expect(groupRow("Senior Squad")).toHaveAttribute("aria-current", "true");
    expect(groupRow("Masters Squad")).not.toHaveAttribute("aria-current");

    await user.click(groupRow("Senior Squad"));

    expect(groupRow("Senior Squad")).not.toHaveAttribute("aria-current");
    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
  });

  it("un error al cargar deja volver a intentarlo", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      groups: [SENIOR],
      loadGroups: () => {
        attempts += 1;
        return attempts === 1
          ? errorResponse(500, "internal_error")
          : jsonResponse(200, { data: { groups: [SENIOR] } });
      },
    });
    render(<GroupsScreen locale="en" canWriteEmails />);

    expect(
      await screen.findByText("We couldn't load the club's groups."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("button", { name: "Senior Squad" }),
    ).toBeVisible();
  });

  it("dice la causa cuando quien mira puede arreglarla de otra forma", async () => {
    stubApi({
      loadGroups: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    render(<GroupsScreen locale="en" canWriteEmails />);

    expect(
      await screen.findByText(
        "We couldn't reach the server. Check your connection and try again.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("en español, la pantalla sale en español", async () => {
    stubApi({ groups: [SENIOR, MASTERS] });

    await renderScreen("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "Grupos" }),
    ).toBeVisible();
    expect(within(groupsSection()).getByText("2 GRUPOS")).toBeVisible();
    expect(within(groupsSection()).getByText("MIEMBROS")).toBeVisible();
    expect(
      within(groupRow("Senior Squad")).getByText("2 eventos · 1 noticia"),
    ).toBeVisible();
    expect(
      within(groupRow("Masters Squad")).getByText("Sin usar todavía"),
    ).toBeVisible();
    expect(
      screen.getByText("Elige un grupo para ver y gestionar sus miembros."),
    ).toBeVisible();
  });

  it("en español, un club sin grupos lo dice en español", async () => {
    stubApi({ groups: [] });

    await renderScreen("es");

    expect(
      screen.getByText("Todavía no hay grupos. Crea el primero arriba."),
    ).toBeVisible();
  });
});

describe("crear un grupo", () => {
  it("al crear un grupo, aparece en la lista en su lugar alfabético y queda elegido", async () => {
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await createGroup("Alevines");

    await waitFor(() =>
      expect(rowNames()).toEqual(["Alevines", "Senior Squad"]),
    );
    expect(groupRow("Alevines")).toHaveAttribute("aria-current", "true");
    expect(groupRow("Alevines")).toHaveAccessibleDescription(
      "Not used yet · 0 members",
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "Alevines" }),
    ).toBeVisible();
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      { url: GROUPS_PATH, method: "POST", body: { name: "Alevines" } },
    ]);
  });

  it("al crear, avisa de que ahora toca añadir a sus miembros", async () => {
    stubApi({ groups: [] });
    await renderScreen();

    await createGroup("Alevines");

    await waitFor(() =>
      expect(statusNotice()).toHaveTextContent(
        "Alevines created · now add its members",
      ),
    );
  });

  it("Enter en el campo también crea el grupo", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [] });
    await renderScreen();

    await user.type(
      screen.getByRole("textbox", { name: "New group name" }),
      "Alevines{Enter}",
    );

    await waitFor(() => expect(rowNames()).toEqual(["Alevines"]));
  });

  it("vacía el campo tras crear, para que el siguiente grupo se escriba de cero", async () => {
    stubApi({ groups: [] });
    await renderScreen();

    await createGroup("Alevines");

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "New group name" }),
      ).toHaveValue(""),
    );
  });

  it("un nombre que ya existe, sin mirar mayúsculas ni tildes, se marca y desactiva Crear", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [{ ...SENIOR, name: "Señor Squad" }] });
    await renderScreen();

    const field = screen.getByRole("textbox", { name: "New group name" });
    await user.type(field, "senor SQUAD");

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "There is already a group with that name.",
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("un nombre repetido no manda nada al pulsar Enter", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await user.type(
      screen.getByRole("textbox", { name: "New group name" }),
      "Senior Squad{Enter}",
    );

    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("si el servidor dice que el nombre ya existe, manda el servidor", async () => {
    stubApi({
      groups: [SENIOR],
      createGroup: () => errorResponse(409, "conflict"),
    });
    await renderScreen();

    await createGroup("Alevines");

    expect(
      await screen.findByText("The club already has a group with that name."),
    ).toBeVisible();
    expect(rowNames()).toEqual(["Senior Squad"]);
  });

  it("un error de red al crear no da el grupo por creado", async () => {
    stubApi({
      groups: [SENIOR],
      createGroup: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderScreen();

    await createGroup("Alevines");

    expect(
      await screen.findByText(
        "We couldn't reach the server. Check your connection and try again.",
      ),
    ).toBeVisible();
    expect(rowNames()).toEqual(["Senior Squad"]);
  });

  it("desactiva el botón de crear hasta la respuesta, y un doble clic no manda dos", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          jsonResponse(201, {
            data: { id: CREATED_ID, name: "Alevines", memberCount: 0 },
          }),
        );
    });
    stubApi({ groups: [], createGroup: () => pending });
    await renderScreen();

    await user.type(
      screen.getByRole("textbox", { name: "New group name" }),
      "Alevines",
    );
    const submit = screen.getByRole("button", { name: "Create" });
    await user.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);
    release();

    await waitFor(() => expect(rowNames()).toEqual(["Alevines"]));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("traduce el error del servidor por su código, no por la frase que manda", async () => {
    stubApi({
      groups: [SENIOR],
      createGroup: () => errorResponse(409, "conflict"),
    });
    await renderScreen("es");

    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }),
      "Alevines",
    );
    await user.click(screen.getByRole("button", { name: "Crear" }));

    expect(
      await screen.findByText("El club ya tiene un grupo con ese nombre."),
    ).toBeVisible();
  });

  it("en español, el nombre repetido y el aviso de creado salen en español", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen("es");
    const field = screen.getByRole("textbox", {
      name: "Nombre del grupo nuevo",
    });

    await user.type(field, "senior squad");
    expect(field).toHaveAccessibleDescription(
      "Ya hay un grupo con ese nombre.",
    );

    await user.clear(field);
    await user.type(field, "Alevines{Enter}");
    await waitFor(() =>
      expect(statusNotice()).toHaveTextContent(
        "Alevines creado · ahora añade a sus miembros",
      ),
    );
  });
});

describe("la cabecera del panel", () => {
  it("lleva el nombre, el resumen y los botones de renombrar y borrar", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA, TOMAS] });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    expect(
      within(panel).getByText("2 members · 2 events · 1 post"),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Rename Senior Squad" }),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Delete Senior Squad" }),
    ).toBeVisible();
  });

  it("cuenta en el resumen a quienes no activaron su cuenta", async () => {
    stubApi({
      groups: [SENIOR],
      members: [NEREA, TOMAS, { ...ANA, isPendingActivation: true }],
    });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    expect(
      within(panel).getByText(
        "2 members · 1 not activated · 2 events · 1 post",
      ),
    ).toBeVisible();
  });

  it("en español, el resumen sale en español", async () => {
    stubApi({
      groups: [MASTERS],
      members: [{ ...ANA, isPendingActivation: true }],
    });
    await renderScreen("es");
    const user = userEvent.setup();

    await user.click(groupRow("Masters Squad"));

    expect(
      await screen.findByText("0 miembros · 1 sin activar · Sin usar todavía"),
    ).toBeVisible();
  });
});

describe("renombrar un grupo", () => {
  async function startRenaming(): Promise<HTMLElement> {
    const user = userEvent.setup();
    const panel = await openGroup("Senior Squad");
    await user.click(
      within(panel).getByRole("button", { name: "Rename Senior Squad" }),
    );
    return within(panel).getByRole("textbox", {
      name: "New name for Senior Squad",
    });
  }

  it("el título pasa a un campo con el nombre, y Enter guarda", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    const field = await startRenaming();
    expect(field).toHaveValue("Senior Squad");
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "Alevines{Enter}");

    await waitFor(() => expect(rowNames()).toEqual(["Alevines"]));
    expect(
      screen.getByRole("heading", { level: 2, name: "Alevines" }),
    ).toBeVisible();
    expect(statusNotice()).toHaveTextContent("Group renamed");
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        url: `${GROUPS_PATH}/${SENIOR.id}`,
        method: "PATCH",
        body: { name: "Alevines" },
      },
    ]);
  });

  it("al renombrar, la lista lo pone en su lugar alfabético sin perder su uso", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR, MASTERS] });
    await renderScreen();

    const field = await startRenaming();
    await user.clear(field);
    await user.type(field, "Alevines");
    await user.click(screen.getByRole("button", { name: "Save the new name" }));

    await waitFor(() =>
      expect(rowNames()).toEqual(["Alevines", "Masters Squad"]),
    );
    expect(groupRow("Alevines")).toHaveAccessibleDescription(
      "2 events · 1 post · 2 members",
    );
  });

  it("Esc cancela, no manda nada y devuelve el foco al botón", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    const field = await startRenaming();
    await user.type(field, " nuevo");
    await user.keyboard("{Escape}");

    const panel = groupPanel("Senior Squad");
    expect(
      within(panel).queryByRole("textbox", {
        name: "New name for Senior Squad",
      }),
    ).toBeNull();
    expect(
      within(panel).getByRole("button", { name: "Rename Senior Squad" }),
    ).toHaveFocus();
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
  });

  it("mientras se renombra no se puede borrar ni volver a renombrar", async () => {
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await startRenaming();

    const panel = groupPanel("Senior Squad");
    expect(
      within(panel).queryByRole("button", { name: "Delete Senior Squad" }),
    ).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: "Rename Senior Squad" }),
    ).toBeNull();
  });

  it("× cancela igual que Esc", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await startRenaming();
    await user.click(screen.getByRole("button", { name: "Cancel renaming" }));

    expect(
      screen.getByRole("heading", { level: 2, name: "Senior Squad" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Rename Senior Squad" }),
    ).toHaveFocus();
  });

  it("renombrar a un nombre que ya existe deja la fila como estaba y lo dice", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR],
      renameGroup: () => errorResponse(409, "conflict"),
    });
    await renderScreen();

    const field = await startRenaming();
    await user.clear(field);
    await user.type(field, "Masters Squad{Enter}");

    expect(
      await screen.findByText("The club already has a group with that name."),
    ).toBeVisible();
    expect(rowNames()).toEqual(["Senior Squad"]);
    expect(field).toHaveValue("Masters Squad");
  });

  it("un grupo que otro acaba de borrar sale de la lista y la pantalla lo dice", async () => {
    stubApi({
      groups: [SENIOR, MASTERS],
      renameGroup: () => errorResponse(404, "not_found"),
    });
    await renderScreen();
    const user = userEvent.setup();

    await startRenaming();
    await user.click(screen.getByRole("button", { name: "Save the new name" }));

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    await waitFor(() => expect(rowNames()).toEqual(["Masters Squad"]));
    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
  });
});

describe("borrar un grupo", () => {
  async function askToDelete(name: string): Promise<HTMLElement> {
    const user = userEvent.setup();
    const panel = await openGroup(name);
    await user.click(
      within(panel).getByRole("button", { name: `Delete ${name}` }),
    );
    return panel;
  }

  it("sin uso, avisa de que sus miembros siguen en el club y no es audiencia de nada", async () => {
    stubApi({ groups: [{ ...SENIOR, usage: { events: 0, posts: 0 } }] });
    await renderScreen();

    const panel = await askToDelete("Senior Squad");

    expect(within(panel).getByText("Delete “Senior Squad”?")).toBeVisible();
    expect(
      within(panel).getByText(
        "Its 2 members stay in the club. It isn't the audience of anything.",
      ),
    ).toBeVisible();
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("con uso, dice cuántos eventos y noticias pierden la audiencia y quién los sigue viendo", async () => {
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    const panel = await askToDelete("Senior Squad");

    expect(
      within(panel).getByText(
        "Members stay in the club, but 2 events and 1 news post will lose this audience. If this was their only group, events stay visible to Admins and the Committee, and posts only to whoever published them.",
      ),
    ).toBeVisible();
  });

  it("con sólo eventos, dice que el Admin y el Committee los siguen viendo", async () => {
    stubApi({ groups: [{ ...SENIOR, usage: { events: 1, posts: 0 } }] });
    await renderScreen("es");
    const user = userEvent.setup();
    await user.click(groupRow("Senior Squad"));

    await user.click(
      await screen.findByRole("button", { name: "Borrar Senior Squad" }),
    );

    expect(
      screen.getByText(
        "Los miembros siguen en el club, pero 1 evento perderá esta audiencia. Si era su único grupo, solo lo seguirán viendo el Admin y el Comité.",
      ),
    ).toBeVisible();
  });

  it("con sólo noticias, dice que sólo las ve quien las publicó", async () => {
    stubApi({ groups: [{ ...SENIOR, usage: { events: 0, posts: 3 } }] });
    await renderScreen();

    const panel = await askToDelete("Senior Squad");

    expect(
      within(panel).getByText(
        "Members stay in the club, but 3 news posts will lose this audience. If this was their only group, only whoever published them will still see them.",
      ),
    ).toBeVisible();
  });

  it("al confirmar, el grupo desaparece, el panel vuelve a elegir y lo avisa", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR, MASTERS] });
    await renderScreen();

    await askToDelete("Senior Squad");
    await user.click(screen.getByRole("button", { name: "Delete group" }));

    await waitFor(() => expect(rowNames()).toEqual(["Masters Squad"]));
    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
    expect(statusNotice()).toHaveTextContent("Senior Squad deleted");
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      { url: `${GROUPS_PATH}/${SENIOR.id}`, method: "DELETE", body: null },
    ]);
  });

  it("tras borrar, el foco pasa a la caja de elegir un grupo", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR, MASTERS] });
    await renderScreen();

    await askToDelete("Senior Squad");
    await user.click(screen.getByRole("button", { name: "Delete group" }));

    await waitFor(() =>
      expect(
        screen.getByText("Pick a group to see and manage its members."),
      ).toHaveFocus(),
    );
  });

  it("cancelar el aviso no borra nada", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    const panel = await askToDelete("Senior Squad");
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));

    expect(rowNames()).toEqual(["Senior Squad"]);
    expect(within(panel).queryByText("Delete “Senior Squad”?")).toBeNull();
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("borrar un grupo que otro ya borró lo quita igual y lo explica", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR, MASTERS],
      deleteGroup: () => errorResponse(404, "not_found"),
    });
    await renderScreen();

    await askToDelete("Senior Squad");
    await user.click(screen.getByRole("button", { name: "Delete group" }));

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    expect(rowNames()).toEqual(["Masters Squad"]);
  });
});

describe("los miembros del grupo", () => {
  it("al elegir un grupo, lista sus socios con su posición", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA, TOMAS] });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    expect(within(panel).getByText("Nerea Ruiz")).toBeVisible();
    expect(within(panel).getByText("Forward")).toBeVisible();
    expect(within(panel).getByText("Goalkeeper")).toBeVisible();
    expect(
      calls.filter((call) => call.method === "GET").map((c) => c.url),
    ).toContain(`${GROUPS_PATH}/${SENIOR.id}/members`);
  });

  it("marca a quien no activó su cuenta con su ficha", async () => {
    stubApi({
      groups: [SENIOR],
      members: [NEREA, { ...ANA, isPendingActivation: true }],
    });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    expect(within(panel).getAllByText("Not activated")).toHaveLength(1);
  });

  it("dice que el grupo no tiene socios en vez de una lista vacía", async () => {
    stubApi({ groups: [MASTERS], members: [], candidates: [NEREA] });
    await renderScreen();

    const panel = await openGroup("Masters Squad");

    expect(
      within(panel).getByText(
        "No members yet. Use “Add members” to pick several at once.",
      ),
    ).toBeVisible();
  });

  it("en español, el grupo vacío lo dice en español", async () => {
    stubApi({ groups: [MASTERS], members: [] });
    await renderScreen("es");
    const user = userEvent.setup();

    await user.click(groupRow("Masters Squad"));

    expect(
      await screen.findByText(
        "Todavía no tiene miembros. Usa «Añadir miembros» para elegir a varios a la vez.",
      ),
    ).toBeVisible();
  });

  it("la búsqueda filtra por nombre sin mirar mayúsculas ni tildes", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [NEREA, TOMAS] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await user.type(
      within(panel).getByRole("searchbox", { name: "Search in this group" }),
      "TOMAS",
    );

    expect(within(panel).getByText("Tomás Errekondo")).toBeVisible();
    expect(within(panel).queryByText("Nerea Ruiz")).toBeNull();
  });

  it("una búsqueda sin resultados lo dice", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [NEREA] });
    await renderScreen("es");
    await user.click(groupRow("Senior Squad"));

    await user.type(
      await screen.findByRole("searchbox", { name: "Buscar en este grupo" }),
      "zzz",
    );

    expect(screen.getByText("Nadie de este grupo se llama así.")).toBeVisible();
  });

  it("quitar un socio lo saca sin pedir confirmación, baja el conteo y lo avisa", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [ANA, NEREA], candidates: [TOMAS] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Nerea Ruiz from Senior Squad",
      }),
    );

    await waitFor(() =>
      expect(within(panel).queryByText("Nerea Ruiz")).toBeNull(),
    );
    expect(groupRow("Senior Squad")).toHaveAccessibleDescription(
      "2 events · 1 post · 1 member",
    );
    expect(statusNotice()).toHaveTextContent(
      "Nerea Ruiz removed from Senior Squad",
    );
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      {
        url: `${GROUPS_PATH}/${SENIOR.id}/members/${NEREA.id}`,
        method: "DELETE",
        body: null,
      },
    ]);
  });

  it("quitar un socio lo devuelve a los que se pueden añadir", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [ANA, NEREA], candidates: [TOMAS] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Nerea Ruiz from Senior Squad",
      }),
    );
    await waitFor(() =>
      expect(within(panel).queryByText("Nerea Ruiz")).toBeNull(),
    );
    await openPicker(panel);

    expect(
      within(panel).getByRole("combobox", { name: "Member to add" }),
    ).toHaveTextContent("Nerea Ruiz");
  });

  it("en español, quitar a un socio lo avisa en español", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [NEREA] });
    await renderScreen("es");
    await user.click(groupRow("Senior Squad"));

    await user.click(
      await screen.findByRole("button", {
        name: "Quitar a Nerea Ruiz de Senior Squad",
      }),
    );

    await waitFor(() =>
      expect(statusNotice()).toHaveTextContent(
        "Nerea Ruiz ya no está en Senior Squad",
      ),
    );
  });

  it("al quitar, los avatares de la fila se ponen al día", async () => {
    const user = userEvent.setup();
    const preview = [ANA, NEREA].map(({ id, fullName }) => ({
      id,
      fullName,
      photoUrl: null,
    }));
    stubApi({
      groups: [{ ...SENIOR, previewMembers: preview }],
      members: [ANA, NEREA],
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Nerea Ruiz from Senior Squad",
      }),
    );

    await waitFor(() =>
      expect(within(groupRow("Senior Squad")).queryByText("NR")).toBeNull(),
    );
    expect(within(groupRow("Senior Squad")).getByText("AA")).toBeVisible();
  });

  it("quitar a alguien de un grupo que otro borró vuelve a elegir y lo explica", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR, MASTERS],
      members: [NEREA],
      removeMember: () => errorResponse(404, "not_found"),
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Nerea Ruiz from Senior Squad",
      }),
    );

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    expect(rowNames()).toEqual(["Masters Squad"]);
    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
  });

  it("un error al cargar los socios deja volver a intentarlo", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      groups: [SENIOR],
      members: [NEREA],
      loadDetail: () => {
        attempts += 1;
        if (attempts <= 2) {
          throw new TypeError("Failed to fetch");
        }
        return null;
      },
    });
    await renderScreen();

    await user.click(groupRow("Senior Squad"));

    expect(
      await screen.findByText("We couldn't load this group's members."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nerea Ruiz")).toBeVisible();
  });

  it("un grupo que otro borró mientras se cargaba vuelve a elegir y lo explica", async () => {
    stubApi({
      groups: [SENIOR, MASTERS],
      loadDetail: () => errorResponse(404, "not_found"),
    });
    await renderScreen();
    const user = userEvent.setup();

    await user.click(groupRow("Senior Squad"));

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    await waitFor(() => expect(rowNames()).toEqual(["Masters Squad"]));
    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
  });
});

/** El selector de uno en uno de E4 sigue hasta que llegue el de varios a la
 * vez (#829): se abre con "Add members". */
describe("añadir socios", () => {
  it("agregar un socio lo mete en la lista, lo saca del selector, sube el conteo y lo avisa", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR],
      members: [NEREA, TOMAS],
      candidates: [ANA, BEA],
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await openPicker(panel);

    await user.click(
      within(panel).getByRole("button", { name: "Add to the group" }),
    );

    await waitFor(() =>
      expect(
        within(panel).getByRole("button", {
          name: "Remove Ana Admin from Senior Squad",
        }),
      ).toBeVisible(),
    );
    expect(
      within(panel).getByRole("combobox", { name: "Member to add" }),
    ).not.toHaveTextContent("Ana Admin");
    expect(groupRow("Senior Squad")).toHaveAccessibleDescription(
      "2 events · 1 post · 3 members",
    );
    expect(statusNotice()).toHaveTextContent("Ana Admin added to Senior Squad");
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      {
        url: `${GROUPS_PATH}/${SENIOR.id}/members/${ANA.id}`,
        method: "PUT",
        body: null,
      },
    ]);
  });

  it("el socio añadido conserva su posición, que la respuesta no trae", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [], candidates: [TOMAS] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await openPicker(panel);

    await user.click(
      within(panel).getByRole("button", { name: "Add to the group" }),
    );

    expect(await within(panel).findByText("Goalkeeper")).toBeVisible();
  });

  it("marca a quien no activó su cuenta y no lo suma al conteo", async () => {
    const user = userEvent.setup();
    const pendingAna = { ...ANA, isPendingActivation: true };
    stubApi({
      groups: [SENIOR],
      members: [NEREA, TOMAS],
      candidates: [pendingAna, BEA],
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await openPicker(panel);

    await user.click(
      within(panel).getByRole("button", { name: "Add to the group" }),
    );

    await waitFor(() =>
      expect(within(panel).getByText("Not activated")).toBeVisible(),
    );
    expect(groupRow("Senior Squad")).toHaveAccessibleDescription(
      "2 events · 1 post · 2 members",
    );
  });

  it("dice que ya están todos cuando no queda a quién agregar", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA], candidates: [] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await openPicker(panel);

    expect(
      within(panel).getByText(
        "Every member of the club is already in this group.",
      ),
    ).toBeVisible();
    expect(
      within(panel).queryByRole("button", { name: "Add to the group" }),
    ).toBeNull();
  });

  it("un grupo que otro borró mientras se agregaba vuelve a elegir y lo explica", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR, MASTERS],
      members: [NEREA],
      candidates: [TOMAS],
      assignMember: () => errorResponse(404, "not_found"),
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await openPicker(panel);

    await user.click(
      within(panel).getByRole("button", { name: "Add to the group" }),
    );

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    await waitFor(() => expect(rowNames()).toEqual(["Masters Squad"]));
    expect(screen.queryByRole("region", { name: "Senior Squad" })).toBeNull();
    expect(
      screen.getByText("Pick a group to see and manage its members."),
    ).toBeVisible();
  });

  it("un socio dado de baja no se agrega, y la pantalla dice por qué", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR],
      members: [NEREA],
      candidates: [TOMAS],
      assignMember: () => errorResponse(422, "business_rule"),
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await openPicker(panel);

    await user.click(
      within(panel).getByRole("button", { name: "Add to the group" }),
    );

    expect(
      await screen.findByText(
        "That member's account is deactivated, so they can't be added.",
      ),
    ).toBeVisible();
    expect(
      within(panel).queryByRole("button", {
        name: "Remove Tomás Errekondo from Senior Squad",
      }),
    ).toBeNull();
    expect(groupRow("Senior Squad")).toHaveAccessibleDescription(
      "2 events · 1 post · 2 members",
    );
  });
});

describe("una sola acción en vuelo", () => {
  it("desactiva el botón de agregar hasta la respuesta, y un doble clic no manda dos", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          jsonResponse(200, {
            data: {
              id: TOMAS.id,
              fullName: TOMAS.fullName,
              isPendingActivation: false,
            },
          }),
        );
    });
    stubApi({
      groups: [SENIOR],
      members: [NEREA],
      candidates: [TOMAS],
      assignMember: () => pending,
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await openPicker(panel);

    const add = within(panel).getByRole("button", { name: "Add to the group" });
    await user.click(add);
    await waitFor(() => expect(add).toBeDisabled());
    await user.click(add);
    release();

    await waitFor(() =>
      expect(within(panel).getByText("Tomás Errekondo")).toBeVisible(),
    );
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("mientras se quita un socio, ni crear ni borrar ni otra fila se pueden pulsar", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 204 }));
    });
    stubApi({
      groups: [SENIOR, MASTERS],
      members: [NEREA, TOMAS],
      removeMember: () => pending,
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await user.type(
      screen.getByRole("textbox", { name: "New group name" }),
      "Alevines",
    );

    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Nerea Ruiz from Senior Squad",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled(),
    );
    expect(
      within(panel).getByRole("button", { name: "Delete Senior Squad" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("button", {
        name: "Remove Tomás Errekondo from Senior Squad",
      }),
    ).toBeDisabled();
    expect(groupRow("Masters Squad")).toBeDisabled();
    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled(),
    );
  });

  it("mientras se borra, el aviso no deja mandar el borrado dos veces", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 204 }));
    });
    stubApi({ groups: [SENIOR], deleteGroup: () => pending });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    await user.click(
      within(panel).getByRole("button", { name: "Delete Senior Squad" }),
    );

    const confirm = within(panel).getByRole("button", { name: "Delete group" });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    await user.click(confirm);
    release();

    await waitFor(() => expect(rowNames()).toEqual([]));
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });
});

describe("los avisos de cada cambio", () => {
  it("se van a los 3 segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi({ groups: [] });
    await renderScreen();

    await user.type(
      screen.getByRole("textbox", { name: "New group name" }),
      "Alevines{Enter}",
    );
    await waitFor(() =>
      expect(statusNotice()).toHaveTextContent("Alevines created"),
    );

    act(() => {
      vi.advanceTimersByTime(2_900);
    });
    expect(statusNotice()).toHaveTextContent("Alevines created");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(statusNotice()).toBeEmptyDOMElement();
  });
});

const ISLAND_CUP: AudienceEvent = {
  kind: "event",
  id: "e0000000-0000-4000-8000-000000000001",
  title: "Island Cup",
  startsOn: "2026-10-24",
  startTime: "09:00",
};

const WEDNESDAY_NEXT_SESSION_ID = "e0000000-0000-4000-8000-000000000003";

const WEDNESDAY_TRAINING: AudienceEvent = {
  kind: "series",
  id: "e0000000-0000-4000-8000-000000000002",
  title: "Wednesday training",
  weekdays: [3],
  startTime: "18:00",
  nextSession: {
    id: WEDNESDAY_NEXT_SESSION_ID,
    startsOn: "2026-10-28",
  },
};

const TRAVEL_PLAN: AudiencePost = {
  id: "f0000000-0000-4000-8000-000000000001",
  title: "Island Cup travel plan",
  // El 12 de octubre en Melbourne, aunque en UTC sea aún el 11.
  publishedAt: "2026-10-11T22:00:00Z",
};

const USED_AUDIENCE: GroupAudience = {
  events: { items: [WEDNESDAY_TRAINING, ISLAND_CUP], total: 2 },
  posts: { items: [TRAVEL_PLAN], total: 1 },
};

/** El evento, sin la noticia que también empieza por "Island Cup". */
const ISLAND_CUP_LINK = /^Island Cup(?! travel)/;

function audienceSection(panel: HTMLElement): HTMLElement {
  return within(panel).getByRole("region", {
    name: /^(AUDIENCE OF|AUDIENCIA DE)$/,
  });
}

/** Abre el grupo y espera a que su audiencia haya llegado, en cualquier
 * idioma. */
async function openAudience(name: string): Promise<HTMLElement> {
  await selectGroup(name);
  const panel = groupPanel(name);
  const section = audienceSection(panel);
  await waitFor(() =>
    expect(within(section).queryByText(/Loading|Cargando/)).toBeNull(),
  );
  return section;
}

function manyEvents(count: number): AudienceEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    ...ISLAND_CUP,
    id: `e0000000-0000-4000-8000-00000000010${index}`,
    title: `Match ${index + 1}`,
  }));
}

function manyPosts(count: number): AudiencePost[] {
  return Array.from({ length: count }, (_, index) => ({
    ...TRAVEL_PLAN,
    id: `f0000000-0000-4000-8000-00000000010${index}`,
    title: `Post ${index + 1}`,
  }));
}

describe("la audiencia del grupo", () => {
  it("pide la audiencia del grupo elegido", async () => {
    stubApi({ groups: [SENIOR], audience: USED_AUDIENCE });
    await renderScreen();

    await openAudience("Senior Squad");

    expect(calls.map((call) => call.url)).toContain(
      `/api/v1/groups/${SENIOR.id}/audience`,
    );
  });

  it("cada evento y cada noticia es un enlace a su página, con su título y su fecha", async () => {
    stubApi({ groups: [SENIOR], audience: USED_AUDIENCE });
    await renderScreen();

    const section = await openAudience("Senior Squad");

    const series = within(section).getByRole("link", {
      name: /Wednesday training/,
    });
    const event = within(section).getByRole("link", { name: ISLAND_CUP_LINK });
    const post = within(section).getByRole("link", {
      name: /Island Cup travel plan/,
    });
    expect(series).toHaveAttribute(
      "href",
      `/calendario?evento=${WEDNESDAY_NEXT_SESSION_ID}`,
    );
    expect(series).toHaveTextContent("Weekly · Wed 6:00 pm");
    expect(event).toHaveAttribute(
      "href",
      `/calendario?evento=${ISLAND_CUP.id}`,
    );
    expect(event).toHaveTextContent("Sat 24 Oct");
    expect(post).toHaveAttribute("href", `/noticias/${TRAVEL_PLAN.id}`);
    expect(post).toHaveTextContent("Posted 12 Oct");
  });

  it("en español, las fechas salen como en el diseño", async () => {
    stubApi({ groups: [SENIOR], audience: USED_AUDIENCE });
    await renderScreen("es");

    const section = await openAudience("Senior Squad");

    expect(
      within(section).getByRole("link", { name: /Wednesday training/ }),
    ).toHaveTextContent("Semanal · mié 18:00");
    expect(
      within(section).getByRole("link", { name: ISLAND_CUP_LINK }),
    ).toHaveTextContent("sáb 24 oct");
    expect(
      within(section).getByRole("link", { name: /travel plan/ }),
    ).toHaveTextContent("Publicada el 12 oct");
  });

  it("los eventos van antes que las noticias, en el orden del servidor", async () => {
    stubApi({ groups: [SENIOR], audience: USED_AUDIENCE });
    await renderScreen();

    const section = await openAudience("Senior Squad");

    expect(
      within(section)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      expect.stringContaining("Wednesday training"),
      expect.stringContaining("Island Cup"),
      expect.stringContaining("Island Cup travel plan"),
    ]);
  });

  it("con más de 5 eventos o noticias enseña 5 de cada uno y cuántos más hay", async () => {
    stubApi({
      groups: [SENIOR],
      audience: {
        events: { items: manyEvents(5), total: 8 },
        posts: { items: manyPosts(5), total: 6 },
      },
    });
    await renderScreen();

    const section = await openAudience("Senior Squad");

    expect(within(section).getAllByRole("link")).toHaveLength(10);
    expect(within(section).getByText("+ 3 more")).toBeVisible();
    expect(within(section).getByText("+ 1 more")).toBeVisible();
  });

  it("con 5 justos no dice que haya más", async () => {
    stubApi({
      groups: [SENIOR],
      audience: {
        events: { items: manyEvents(5), total: 5 },
        posts: { items: [], total: 0 },
      },
    });
    await renderScreen();

    const section = await openAudience("Senior Squad");

    expect(within(section).queryByText(/more/)).toBeNull();
  });

  it("un grupo sin uso invita a elegirlo como audiencia", async () => {
    stubApi({ groups: [SENIOR], audience: NO_AUDIENCE });
    await renderScreen();

    const section = await openAudience("Senior Squad");

    expect(
      within(section).getByText(
        "Not used yet. Pick it as the audience when you create an event or a news post.",
      ),
    ).toBeVisible();
    expect(within(section).queryAllByRole("link")).toEqual([]);
  });

  it("en español, el grupo sin uso lo dice en español", async () => {
    stubApi({ groups: [SENIOR], audience: NO_AUDIENCE });
    await renderScreen("es");

    const section = await openAudience("Senior Squad");

    expect(
      within(section).getByText(
        "Sin usar todavía. Elígelo como audiencia al crear un evento o una noticia.",
      ),
    ).toBeVisible();
  });

  it("un error al cargar la audiencia deja volver a intentarlo", async () => {
    let attempts = 0;
    stubApi({
      groups: [SENIOR],
      loadAudience: () => {
        attempts += 1;
        return attempts === 1
          ? errorResponse(500, "internal_error")
          : jsonResponse(200, { data: USED_AUDIENCE });
      },
    });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    const section = audienceSection(panel);

    await within(section).findByText(
      "We couldn't load where this group is used.",
    );
    await userEvent
      .setup()
      .click(within(section).getByRole("button", { name: "Try again" }));

    await within(section).findByRole("link", { name: ISLAND_CUP_LINK });
  });

  it("un grupo que otro borró vuelve a elegir y lo explica", async () => {
    stubApi({
      groups: [SENIOR, MASTERS],
      loadAudience: () => errorResponse(404, "not_found"),
    });
    await renderScreen();

    await userEvent.setup().click(groupRow("Senior Squad"));

    await screen.findByText("That group is no longer in the club.");
    expect(rowNames()).toEqual(["Masters Squad"]);
  });
});

describe("escribir a todos y abrir en el directorio", () => {
  const PENDING_ANA: GroupCandidate = { ...ANA, isPendingActivation: true };

  it("un Admin o un Committee ve Escribir a todos", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA] });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    expect(
      within(panel).getByRole("button", {
        name: "Email everyone in Senior Squad",
      }),
    ).toBeEnabled();
  });

  it("un Coach no ve Escribir a todos", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA] });
    await renderScreen("en", { canWriteEmails: false });

    const panel = await openGroup("Senior Squad");

    expect(
      within(panel).queryByRole("button", { name: /Email everyone/ }),
    ).toBeNull();
    expect(
      within(panel).getByRole("link", {
        name: "Open Senior Squad in the directory",
      }),
    ).toBeVisible();
  });

  it("sin miembros activos, Escribir a todos está desactivado y dice por qué", async () => {
    stubApi({ groups: [SENIOR], members: [PENDING_ANA] });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    const button = within(panel).getByRole("button", {
      name: "Email everyone in Senior Squad",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Nobody to write to");
  });

  it("en español, el botón desactivado dice que no hay a quién escribir", async () => {
    stubApi({ groups: [SENIOR], members: [] });
    await renderScreen("es");
    await userEvent.setup().click(groupRow("Senior Squad"));

    const button = await screen.findByRole("button", {
      name: "Escribir a todos en Senior Squad",
    });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("title", "Nadie a quien escribir");
  });

  it("abre el redactor del Directorio con los miembros activos del grupo, sin los pendientes", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA, PENDING_ANA, TOMAS] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");

    await userEvent.setup().click(
      within(panel).getByRole("button", {
        name: "Email everyone in Senior Squad",
      }),
    );

    const composer = await screen.findByRole("region", {
      name: "Email members",
    });
    const recipients = within(composer).getByRole("list", {
      name: "2 recipients",
    });
    expect(within(recipients).getByText("Nerea Ruiz")).toBeVisible();
    expect(within(recipients).getByText("Tomás Errekondo")).toBeVisible();
    expect(within(recipients).queryByText("Ana Admin")).toBeNull();
  });

  it("al enviar, manda a los activos con una clave de petición por el endpoint del Directorio", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA, PENDING_ANA] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Email everyone in Senior Squad",
      }),
    );
    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Hola");
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Mar.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Send the email?",
    });

    await user.click(within(dialog).getByRole("button", { name: "Send now" }));

    await waitFor(() =>
      expect(
        calls.filter(
          (call) =>
            call.url === DIRECTORY_EMAILS_PATH && call.method === "POST",
        ),
      ).toEqual([
        {
          url: DIRECTORY_EMAILS_PATH,
          method: "POST",
          body: {
            requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            subject: "Hola",
            message: "Mar.",
            recipientIds: [NEREA.id],
          },
        },
      ]),
    );
  });

  it("con el redactor abierto, Escribir a todos en otro grupo le escribe a ese grupo", async () => {
    stubApi({
      groups: [SENIOR, MASTERS],
      loadDetail: (url) =>
        MEMBERS_PATH.test(url)
          ? jsonResponse(200, {
              data: { members: url.includes(SENIOR.id) ? [NEREA] : [TOMAS] },
            })
          : null,
    });
    await renderScreen();
    const user = userEvent.setup();
    const senior = await openGroup("Senior Squad");
    await user.click(
      within(senior).getByRole("button", {
        name: "Email everyone in Senior Squad",
      }),
    );

    const masters = await openGroup("Masters Squad");
    await user.click(
      within(masters).getByRole("button", {
        name: "Email everyone in Masters Squad",
      }),
    );

    const recipients = within(
      screen.getByRole("region", { name: "Email members" }),
    ).getByRole("list", { name: "1 recipient" });
    expect(within(recipients).getByText("Tomás Errekondo")).toBeVisible();
    expect(within(recipients).queryByText("Nerea Ruiz")).toBeNull();
  });

  it("cerrar el redactor lo quita", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA] });
    await renderScreen();
    const panel = await openGroup("Senior Squad");
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Email everyone in Senior Squad",
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Close" }));

    expect(screen.queryByRole("region", { name: "Email members" })).toBeNull();
  });

  it("Abrir en el directorio lleva al Directorio filtrado por el grupo", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA] });
    await renderScreen();

    const panel = await openGroup("Senior Squad");

    expect(
      within(panel).getByRole("link", {
        name: "Open Senior Squad in the directory",
      }),
    ).toHaveAttribute("href", `/directorio?group=${SENIOR.id}`);
  });
});
