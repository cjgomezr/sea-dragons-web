import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupsScreen } from "@/components/groups/GroupsScreen";
import type { GroupMember } from "@/lib/groups/group-members";
import type { Group } from "@/lib/groups/groups";

/**
 * La pantalla Grupos (#228, RF-2 a RF-7 del PRD de E4). Las escrituras ya
 * existían (#226 y #227); lo que se prueba aquí es que la pantalla enseña lo
 * que el servidor confirmó y nada más: un nombre repetido no entra en la
 * lista, un grupo que otro borró sale de ella, y una acción en vuelo no se
 * puede mandar dos veces.
 */

const SENIOR: Group = {
  id: "11111111-0000-4000-8000-000000000001",
  name: "Senior Squad",
  memberCount: 2,
};

const MASTERS: Group = {
  id: "22222222-0000-4000-8000-000000000002",
  name: "Masters Squad",
  memberCount: 0,
};

const NEREA: GroupMember = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  fullName: "Nerea Ruiz",
  isPendingActivation: false,
};

const TOMAS: GroupMember = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  fullName: "Tomás Errekondo",
  isPendingActivation: false,
};

const ANA: GroupMember = {
  id: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "Ana Admin",
  isPendingActivation: false,
};

const BEA: GroupMember = {
  id: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Bea Nadal",
  isPendingActivation: false,
};

type ApiCall = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

type Respond = () => Response | Promise<Response>;

type ApiStub = {
  readonly groups?: readonly Group[];
  readonly members?: readonly GroupMember[];
  readonly candidates?: readonly GroupMember[];
  readonly loadGroups?: Respond;
  readonly createGroup?: Respond;
  readonly renameGroup?: Respond;
  readonly deleteGroup?: Respond;
  /** Devuelve `null` para dejar que responda la lista de arriba. */
  readonly loadDetail?: (url: string) => Response | Promise<Response> | null;
  readonly assignMember?: Respond;
  readonly removeMember?: Respond;
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

/** El nombre que el cuerpo de la petición lleva, para que la respuesta de
 * crear o renombrar devuelva lo que se pidió y no un valor fijo. */
function nameIn(body: unknown): string {
  return (body as { name?: string }).name ?? "";
}

function groupResponses(stub: ApiStub, url: string, body: unknown): Response {
  const renamed = GROUP_PATH.exec(url)?.[1] ?? "";
  return url === GROUPS_PATH
    ? jsonResponse(201, {
        data: {
          id: "99999999-0000-4000-8000-000000000009",
          name: nameIn(body),
          memberCount: 0,
        },
      })
    : jsonResponse(200, {
        data: { id: renamed, name: nameIn(body), memberCount: 0 },
      });
}

function detailResponse(stub: ApiStub, url: string): Response {
  return MEMBERS_PATH.test(url)
    ? jsonResponse(200, { data: { members: stub.members ?? [NEREA] } })
    : jsonResponse(200, { data: { candidates: stub.candidates ?? [TOMAS] } });
}

function membershipResponse(stub: ApiStub, url: string): Response {
  const userId = MEMBERSHIP_PATH.exec(url)?.[2] ?? "";
  const member = (stub.candidates ?? [TOMAS]).find(
    (candidate) => candidate.id === userId,
  );
  return jsonResponse(200, { data: member ?? TOMAS });
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
        return stub.createGroup?.() ?? groupResponses(stub, url, body);
      }
      if (GROUP_PATH.test(url) && method === "PATCH") {
        return stub.renameGroup?.() ?? groupResponses(stub, url, body);
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
      throw new Error(`Petición inesperada: ${method} ${url}`);
    }),
  );
}

async function renderScreen(locale: "en" | "es" = "en"): Promise<void> {
  render(<GroupsScreen locale={locale} />);
  await screen.findByRole("heading", {
    level: 2,
    name: locale === "en" ? "Club groups" : "Grupos del club",
  });
}

function groupRow(name: string): HTMLElement {
  return screen.getByRole("listitem", { name });
}

/** Los nombres de la lista de grupos, sin las filas de socios del panel de un
 * grupo abierto, que también son entradas de lista. */
function groupsSection(): HTMLElement {
  return screen.getByRole("region", { name: /Club groups|Grupos del club/ });
}

function listedGroupNames(): string[] {
  return within(groupsSection())
    .queryAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label") ?? "");
}

async function createGroup(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name of the new group"), name);
  await user.click(screen.getByRole("button", { name: "Create group" }));
}

async function openGroup(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  await screen.findByRole("heading", { level: 2, name: `Members of ${name}` });
}

function membersPanel(name: string): HTMLElement {
  return screen.getByRole("region", { name: `Members of ${name}` });
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla de grupos", () => {
  it("lista los grupos del club con su conteo, en orden alfabético", async () => {
    stubApi({ groups: [SENIOR, MASTERS] });

    await renderScreen();

    expect(listedGroupNames()).toEqual(["Masters Squad", "Senior Squad"]);
    expect(
      within(groupRow("Senior Squad")).getByText("2 members"),
    ).toBeVisible();
    expect(
      within(groupRow("Masters Squad")).getByText("0 members"),
    ).toBeVisible();
  });

  it("dice con una frase que el club no tiene grupos e invita a crear el primero", async () => {
    stubApi({ groups: [] });

    await renderScreen();

    expect(
      screen.getByText(
        "This club has no groups yet. Create the first one to start gathering members.",
      ),
    ).toBeVisible();
    expect(within(groupsSection()).queryAllByRole("listitem")).toEqual([]);
  });

  it("al crear un grupo, aparece en la lista con 0 miembros y en su lugar alfabético", async () => {
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await createGroup("Alevines");

    await waitFor(() =>
      expect(listedGroupNames()).toEqual(["Alevines", "Senior Squad"]),
    );
    expect(within(groupRow("Alevines")).getByText("0 members")).toBeVisible();
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      { url: GROUPS_PATH, method: "POST", body: { name: "Alevines" } },
    ]);
  });

  it("vacía el campo tras crear, para que el siguiente grupo se escriba de cero", async () => {
    stubApi({ groups: [] });
    await renderScreen();

    await createGroup("Alevines");

    await waitFor(() =>
      expect(screen.getByLabelText("Name of the new group")).toHaveValue(""),
    );
  });

  it("un nombre que ya existe no entra en la lista y la pantalla dice por qué", async () => {
    stubApi({
      groups: [SENIOR],
      createGroup: () => errorResponse(409, "conflict"),
    });
    await renderScreen();

    await createGroup("Senior Squad");

    expect(
      await screen.findByText("The club already has a group with that name."),
    ).toBeVisible();
    expect(listedGroupNames()).toEqual(["Senior Squad"]);
  });

  it("al renombrar, la lista muestra el nombre nuevo en su lugar alfabético", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Rename Senior Squad" }),
    );
    const field = screen.getByLabelText("New name for Senior Squad");
    await user.clear(field);
    await user.type(field, "Alevines");
    await user.click(screen.getByRole("button", { name: "Save the new name" }));

    await waitFor(() => expect(listedGroupNames()).toEqual(["Alevines"]));
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        url: `${GROUPS_PATH}/${SENIOR.id}`,
        method: "PATCH",
        body: { name: "Alevines" },
      },
    ]);
  });

  it("renombrar a un nombre que ya existe deja la fila como estaba y lo dice", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR],
      renameGroup: () => errorResponse(409, "conflict"),
    });
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Rename Senior Squad" }),
    );
    const field = screen.getByLabelText("New name for Senior Squad");
    await user.clear(field);
    await user.type(field, "Masters Squad");
    await user.click(screen.getByRole("button", { name: "Save the new name" }));

    expect(
      await screen.findByText("The club already has a group with that name."),
    ).toBeVisible();
    expect(listedGroupNames()).toEqual(["Senior Squad"]);
  });

  it("borrar pide confirmación diciendo cuántos socios tiene el grupo", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Delete Senior Squad" }),
    );

    expect(
      screen.getByText(
        /Delete .Senior Squad.\? It has 2 members\. They stay in the club\./,
      ),
    ).toBeVisible();
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("al confirmar, el grupo desaparece de la lista", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR, MASTERS] });
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Delete Senior Squad" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete group" }));

    await waitFor(() => expect(listedGroupNames()).toEqual(["Masters Squad"]));
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      { url: `${GROUPS_PATH}/${SENIOR.id}`, method: "DELETE", body: null },
    ]);
  });

  it("cancelar la confirmación no borra nada", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR] });
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Delete Senior Squad" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(listedGroupNames()).toEqual(["Senior Squad"]);
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("un grupo que otro acaba de borrar sale de la lista y la pantalla lo dice", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR, MASTERS],
      renameGroup: () => errorResponse(404, "not_found"),
    });
    await renderScreen();

    await user.click(
      screen.getByRole("button", { name: "Rename Senior Squad" }),
    );
    await user.click(screen.getByRole("button", { name: "Save the new name" }));

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    await waitFor(() => expect(listedGroupNames()).toEqual(["Masters Squad"]));
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
    render(<GroupsScreen locale="en" />);

    expect(
      await screen.findByText("We couldn't load the club's groups."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("listitem", { name: "Senior Squad" }),
    ).toBeVisible();
  });

  it("dice la causa cuando quien mira puede arreglarla de otra forma", async () => {
    stubApi({
      loadGroups: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    render(<GroupsScreen locale="en" />);

    expect(
      await screen.findByText(
        "We couldn't reach the server. Check your connection and try again.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
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
    expect(listedGroupNames()).toEqual(["Senior Squad"]);
  });

  it("desactiva el botón de crear hasta la respuesta, y un doble clic no manda dos", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          jsonResponse(201, {
            data: {
              id: "99999999-0000-4000-8000-000000000009",
              name: "Alevines",
              memberCount: 0,
            },
          }),
        );
    });
    stubApi({ groups: [], createGroup: () => pending });
    await renderScreen();

    await user.type(screen.getByLabelText("Name of the new group"), "Alevines");
    const submit = screen.getByRole("button", { name: "Create group" });
    await user.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);
    release();

    await waitFor(() => expect(listedGroupNames()).toEqual(["Alevines"]));
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
      screen.getByLabelText("Nombre del grupo nuevo"),
      "Senior Squad",
    );
    await user.click(screen.getByRole("button", { name: "Crear grupo" }));

    expect(
      await screen.findByText("El club ya tiene un grupo con ese nombre."),
    ).toBeVisible();
  });

  it("en español, la pantalla sale en español", async () => {
    stubApi({ groups: [SENIOR] });

    await renderScreen("es");

    expect(
      screen.getByRole("heading", { level: 1, name: "Grupos" }),
    ).toBeVisible();
    expect(
      within(groupRow("Senior Squad")).getByText("2 miembros"),
    ).toBeVisible();
  });
});

describe("socios de un grupo en pantalla", () => {
  it("al abrir un grupo, lista sus socios y ofrece a los demás en el selector", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA], candidates: [ANA, TOMAS] });
    await renderScreen();

    await openGroup("Senior Squad");

    const panel = membersPanel("Senior Squad");
    expect(within(panel).getByText("Nerea Ruiz")).toBeVisible();
    expect(
      within(panel).getByRole("combobox", { name: "Member to add" }),
    ).toHaveTextContent("Ana Admin");
    expect(
      calls.filter((call) => call.method === "GET").map((c) => c.url),
    ).toContain(`${GROUPS_PATH}/${SENIOR.id}/candidates`);
  });

  it("dice que el grupo no tiene socios en vez de una lista vacía", async () => {
    stubApi({ groups: [MASTERS], members: [], candidates: [NEREA] });
    await renderScreen();

    await openGroup("Masters Squad");

    expect(
      within(membersPanel("Masters Squad")).getByText(
        "This group has no members yet. Add the first one from the list.",
      ),
    ).toBeVisible();
  });

  it("agregar un socio lo mete en la lista, lo saca del selector y sube el conteo", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR],
      members: [NEREA, TOMAS],
      candidates: [ANA, BEA],
    });
    await renderScreen();
    await openGroup("Senior Squad");

    await user.click(screen.getByRole("button", { name: "Add to the group" }));

    const panel = membersPanel("Senior Squad");
    await waitFor(() =>
      expect(
        within(panel).getByRole("button", {
          name: "Remove Ana Admin from the group",
        }),
      ).toBeVisible(),
    );
    expect(
      within(panel).getByRole("combobox", { name: "Member to add" }),
    ).not.toHaveTextContent("Ana Admin");
    expect(
      within(groupRow("Senior Squad")).getByText("3 members"),
    ).toBeVisible();
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      {
        url: `${GROUPS_PATH}/${SENIOR.id}/members/${ANA.id}`,
        method: "PUT",
        body: null,
      },
    ]);
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
    await openGroup("Senior Squad");

    await user.click(screen.getByRole("button", { name: "Add to the group" }));

    const panel = membersPanel("Senior Squad");
    await waitFor(() =>
      expect(within(panel).getByText("Pending activation")).toBeVisible(),
    );
    expect(
      within(groupRow("Senior Squad")).getByText("2 members"),
    ).toBeVisible();
  });

  it("quitar un socio lo saca de la lista, lo devuelve al selector y baja el conteo", async () => {
    const user = userEvent.setup();
    stubApi({ groups: [SENIOR], members: [ANA, NEREA], candidates: [TOMAS] });
    await renderScreen();
    await openGroup("Senior Squad");

    await user.click(
      screen.getByRole("button", { name: "Remove Nerea Ruiz from the group" }),
    );

    const panel = membersPanel("Senior Squad");
    await waitFor(() =>
      expect(
        within(panel).queryByRole("button", {
          name: "Remove Nerea Ruiz from the group",
        }),
      ).toBeNull(),
    );
    expect(
      within(panel).getByRole("combobox", { name: "Member to add" }),
    ).toHaveTextContent("Nerea Ruiz");
    expect(
      within(groupRow("Senior Squad")).getByText("1 member"),
    ).toBeVisible();
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      {
        url: `${GROUPS_PATH}/${SENIOR.id}/members/${NEREA.id}`,
        method: "DELETE",
        body: null,
      },
    ]);
  });

  it("dice que ya están todos cuando no queda a quién agregar", async () => {
    stubApi({ groups: [SENIOR], members: [NEREA], candidates: [] });
    await renderScreen();

    await openGroup("Senior Squad");

    expect(
      within(membersPanel("Senior Squad")).getByText(
        "Every member of the club is already in this group.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add to the group" }),
    ).toBeNull();
  });

  it("un grupo que otro borró mientras se agregaba devuelve a la lista", async () => {
    const user = userEvent.setup();
    stubApi({
      groups: [SENIOR, MASTERS],
      members: [NEREA],
      candidates: [TOMAS],
      assignMember: () => errorResponse(404, "not_found"),
    });
    await renderScreen();
    await openGroup("Senior Squad");

    await user.click(screen.getByRole("button", { name: "Add to the group" }));

    expect(
      await screen.findByText("That group is no longer in the club."),
    ).toBeVisible();
    await waitFor(() => expect(listedGroupNames()).toEqual(["Masters Squad"]));
    expect(
      screen.queryByRole("region", { name: "Members of Senior Squad" }),
    ).toBeNull();
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
    await openGroup("Senior Squad");

    await user.click(screen.getByRole("button", { name: "Add to the group" }));

    expect(
      await screen.findByText(
        "That member already left the club, so they can't be added.",
      ),
    ).toBeVisible();
    expect(
      within(membersPanel("Senior Squad")).queryByRole("button", {
        name: "Remove Tomás Errekondo from the group",
      }),
    ).toBeNull();
    expect(
      within(groupRow("Senior Squad")).getByText("2 members"),
    ).toBeVisible();
  });

  it("desactiva el botón de agregar hasta la respuesta, y un doble clic no manda dos", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(jsonResponse(200, { data: TOMAS }));
    });
    stubApi({
      groups: [SENIOR],
      members: [NEREA],
      candidates: [TOMAS],
      assignMember: () => pending,
    });
    await renderScreen();
    await openGroup("Senior Squad");

    const add = screen.getByRole("button", { name: "Add to the group" });
    await user.click(add);
    await waitFor(() => expect(add).toBeDisabled());
    await user.click(add);
    release();

    await waitFor(() =>
      expect(
        within(membersPanel("Senior Squad")).getByText("Tomás Errekondo"),
      ).toBeVisible(),
    );
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
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

    await user.click(screen.getByRole("button", { name: "Senior Squad" }));

    expect(
      await screen.findByText("We couldn't load this group's members."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nerea Ruiz")).toBeVisible();
  });
});
