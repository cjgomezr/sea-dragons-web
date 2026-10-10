import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type {
  AdminDirectoryMember,
  DirectoryListing,
} from "@/lib/directory/directory";

/**
 * La selección múltiple del directorio (#552, RF-6 del PRD de E21): casillas
 * para quien puede escribir o exportar, la barra con lo que se hace con los
 * marcados y el cambio de rol en bloque del Admin, que no guarda nada sin
 * confirmar. El servidor es de mentira: qué le pasa a cada socio lo prueban
 * el dominio y la ruta.
 */

const NEREA_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const TOM_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
const ANA_ID = "a0a0a0a0-0000-4000-8000-00000000000a";

const NEREA: AdminDirectoryMember = {
  userId: NEREA_ID,
  fullName: "Nerea Ruiz",
  country: "ES",
  experienceLevel: "Beginner",
  role: "Player",
  position: null,
  status: "active",
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
  email: "nerea@club.test",
  phone: null,
  emergencyContact: null,
};

const TOM: AdminDirectoryMember = {
  ...NEREA,
  userId: TOM_ID,
  fullName: "Tom Baker",
  email: "tom@club.test",
};

const ANA: AdminDirectoryMember = {
  ...NEREA,
  userId: ANA_ID,
  fullName: "Ana Admin",
  role: "Admin",
  email: "ana@club.test",
};

const MEMBERS = [ANA, NEREA, TOM] as const;

const DIRECTORY_PATH = "/api/v1/directory";
const EXPORT_PATH = "/api/v1/directory/export";
const EMAILS_PATH = "/api/v1/directory/emails";
const ROLES_PATH = "/api/v1/members/roles";

type ApiCall = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Lo que el servidor de verdad contesta a un cambio en bloque: todos
 * cambian salvo los que se le digan. */
function rolesResponse(
  body: { readonly userIds: readonly string[]; readonly role: string },
  stub: ApiStub,
): Response {
  const failures = stub.failures ?? {};
  const unchanged = stub.unchanged ?? [];
  return jsonResponse(200, {
    data: {
      role: body.role,
      results: body.userIds.map((userId) => {
        const reason = failures[userId];
        if (reason !== undefined) {
          return { kind: "failed", userId, reason };
        }
        return unchanged.includes(userId)
          ? { kind: "unchanged", userId, role: body.role }
          : {
              kind: "changed",
              userId,
              previousRole: "Player",
              role: body.role,
            };
      }),
    },
  });
}

type ApiStub = {
  readonly kind?: DirectoryListing["kind"];
  readonly failures?: Readonly<Record<string, string>>;
  readonly unchanged?: readonly string[];
  readonly rolesStatus?: number;
};

function committeeView(member: AdminDirectoryMember): Record<string, unknown> {
  return {
    userId: member.userId,
    fullName: member.fullName,
    country: member.country,
    experienceLevel: member.experienceLevel,
    role: member.role,
    position: member.position,
    status: member.status,
    invitedOn: member.invitedOn,
    photoUrl: member.photoUrl,
    attendance: member.attendance,
    email: member.email,
    phone: member.phone,
    emergencyContact: member.emergencyContact,
  };
}

function viewOf(kind: DirectoryListing["kind"]): readonly unknown[] {
  switch (kind) {
    case "admin":
      return MEMBERS;
    case "committee":
      return MEMBERS.map(committeeView);
    case "coach":
      return MEMBERS.map((member) => ({
        ...committeeView(member),
        email: undefined,
        phone: undefined,
        isEvaluated: true,
      }));
    case "member":
      return MEMBERS.map((member) => {
        const { email, phone, emergencyContact, ...base } =
          committeeView(member);
        void email;
        void phone;
        void emergencyContact;
        return base;
      });
  }
}

function respond(stub: ApiStub, call: ApiCall): Response {
  if (call.url === ROLES_PATH) {
    return stub.rolesStatus === undefined
      ? rolesResponse(call.body as { userIds: string[]; role: string }, stub)
      : jsonResponse(stub.rolesStatus, {
          error: { code: "forbidden", message: "No." },
        });
  }
  if (call.url.startsWith(EXPORT_PATH)) {
    return new Response("Nombre\r\n", {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="directorio.csv"',
      },
    });
  }
  if (call.url.startsWith(EMAILS_PATH)) {
    return jsonResponse(200, { data: { limit: 50, remaining: 50 } });
  }
  if (call.url.startsWith(DIRECTORY_PATH)) {
    const kind = stub.kind ?? "admin";
    return jsonResponse(200, {
      data: {
        kind,
        members: viewOf(kind),
        total: MEMBERS.length,
        availableFilters: [],
      },
    });
  }
  if (call.url === "/api/v1/club/positions") {
    return jsonResponse(200, { data: { positions: [] } });
  }
  if (call.url.startsWith("/api/v1/role-requests")) {
    return jsonResponse(200, { data: { requests: [] } });
  }
  throw new Error(`Petición inesperada: ${call.url}`);
}

function stubApi(stub: ApiStub = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: ApiCall = {
        url,
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return respond(stub, call);
    }),
  );
}

function rolesCalls(): readonly ApiCall[] {
  return calls.filter((call) => call.url === ROLES_PATH);
}

async function renderDirectory(): Promise<ReturnType<typeof userEvent.setup>> {
  render(<DirectoryScreen locale="es" />);
  await screen.findByRole("table");
  return userEvent.setup();
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole("row", { name });
}

function checkboxOf(name: string): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: `Marcar a ${name}`,
  }) as HTMLInputElement;
}

function selectAll(): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: "Marcar a todos",
  }) as HTMLInputElement;
}

function bulkBar(): HTMLElement {
  return screen.getByRole("group", { name: /^[0-9]+ seleccionados?$/ });
}

async function markMembers(
  user: ReturnType<typeof userEvent.setup>,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    await user.click(checkboxOf(name));
  }
}

async function chooseBulkRole(
  user: ReturnType<typeof userEvent.setup>,
  role: string,
): Promise<void> {
  await user.click(
    within(bulkBar()).getByRole("button", { name: "Cambiar rol" }),
  );
  await user.click(within(bulkBar()).getByRole("button", { name: role }));
}

beforeEach(() => {
  calls.length = 0;
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/csv");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("las casillas de la lista", () => {
  it.each(["admin", "committee"] as const)(
    "la lista de %s tiene una casilla por fila y la de marcar a todos",
    async (kind) => {
      stubApi({ kind });
      await renderDirectory();

      for (const member of MEMBERS) {
        expect(checkboxOf(member.fullName)).toBeTruthy();
      }
      expect(selectAll()).toBeTruthy();
    },
  );

  it.each(["coach", "member"] as const)(
    "la lista de %s no tiene casillas",
    async (kind) => {
      stubApi({ kind });
      await renderDirectory();

      expect(screen.queryAllByRole("checkbox", { name: /^Marcar a/ })).toEqual(
        [],
      );
    },
  );

  it("marcar una fila no abre el panel", async () => {
    stubApi();
    const user = await renderDirectory();

    await user.click(checkboxOf("Nerea Ruiz"));

    expect(checkboxOf("Nerea Ruiz").checked).toBe(true);
    expect(rowOf("Nerea Ruiz").getAttribute("aria-current")).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: /Nerea Ruiz/ }),
    ).toBeNull();
  });

  it("marcar a todos marca a los de la vista", async () => {
    stubApi();
    const user = await renderDirectory();

    await user.click(selectAll());

    expect(MEMBERS.every((member) => checkboxOf(member.fullName).checked)).toBe(
      true,
    );
    expect(within(bulkBar()).getByText("3 seleccionados")).toBeTruthy();
  });

  it("con algunos marcados, la de marcar a todos queda a medias", async () => {
    stubApi();
    const user = await renderDirectory();

    await user.click(checkboxOf("Tom Baker"));

    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);
  });

  it("con todos marcados, la de marcar a todos los desmarca", async () => {
    stubApi();
    const user = await renderDirectory();
    await user.click(selectAll());

    await user.click(selectAll());

    expect(MEMBERS.some((member) => checkboxOf(member.fullName).checked)).toBe(
      false,
    );
    expect(
      screen.queryByRole("group", { name: /^[0-9]+ seleccionados?$/ }),
    ).toBeNull();
  });
});

describe("la barra de los marcados", () => {
  it("no sale sin nadie marcado", async () => {
    stubApi();
    await renderDirectory();

    expect(
      screen.queryByRole("group", { name: /^[0-9]+ seleccionados?$/ }),
    ).toBeNull();
  });

  it("al Admin le ofrece correo, exportar, cambiar rol y desmarcar", async () => {
    stubApi();
    const user = await renderDirectory();

    await markMembers(user, ["Nerea Ruiz", "Tom Baker"]);

    const bar = bulkBar();
    expect(within(bar).getByText("2 seleccionados")).toBeTruthy();
    for (const name of [
      "Escribir a los seleccionados",
      "Exportar los seleccionados",
      "Cambiar rol",
      "Quitar la selección",
    ]) {
      expect(within(bar).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("al Committee no le ofrece cambiar rol", async () => {
    stubApi({ kind: "committee" });
    const user = await renderDirectory();

    await markMembers(user, ["Nerea Ruiz"]);

    expect(
      within(bulkBar()).queryByRole("button", { name: "Cambiar rol" }),
    ).toBeNull();
    expect(
      within(bulkBar()).getByRole("button", {
        name: "Escribir a los seleccionados",
      }),
    ).toBeTruthy();
  });

  it("la ✕ desmarca a todos y la barra se va", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz", "Tom Baker"]);

    await user.click(
      within(bulkBar()).getByRole("button", { name: "Quitar la selección" }),
    );

    expect(checkboxOf("Nerea Ruiz").checked).toBe(false);
    expect(
      screen.queryByRole("group", { name: /^[0-9]+ seleccionados?$/ }),
    ).toBeNull();
  });
});

describe("correo y exportar con y sin marcados", () => {
  it("el correo de la barra va sólo a los marcados", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Tom Baker"]);

    await user.click(
      within(bulkBar()).getByRole("button", {
        name: "Escribir a los seleccionados",
      }),
    );

    const recipients = await screen.findByRole("list", {
      name: /destinatario/i,
    });
    expect(
      within(recipients)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Tom Baker")]);
  });

  it("sin marcados, el correo de la cabecera va a toda la lista, como hoy", async () => {
    stubApi();
    const user = await renderDirectory();

    await user.click(screen.getByRole("button", { name: "Escribir correo" }));

    const recipients = await screen.findByRole("list", {
      name: /destinatario/i,
    });
    expect(within(recipients).getAllByRole("listitem")).toHaveLength(3);
  });

  it("con marcados, el correo de la cabecera también va sólo a ellos", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz"]);

    await user.click(screen.getByRole("button", { name: "Escribir correo" }));

    const recipients = await screen.findByRole("list", {
      name: /destinatario/i,
    });
    expect(within(recipients).getAllByRole("listitem")).toHaveLength(1);
  });

  it("exportar desde la barra pide sólo a los marcados", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz", "Tom Baker"]);

    await user.click(
      within(bulkBar()).getByRole("button", {
        name: "Exportar los seleccionados",
      }),
    );

    await waitFor(() =>
      expect(calls.some((call) => call.url.startsWith(EXPORT_PATH))).toBe(true),
    );
    const exportUrl = calls.find((call) => call.url.startsWith(EXPORT_PATH));
    const params = new URL(exportUrl?.url ?? "", "http://localhost")
      .searchParams;
    expect(params.getAll("member")).toEqual([NEREA_ID, TOM_ID]);
  });

  it("sin marcados, exportar desde la cabecera no acota a nadie", async () => {
    stubApi();
    const user = await renderDirectory();

    await user.click(screen.getByRole("button", { name: "Exportar CSV" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.startsWith(EXPORT_PATH))).toBe(true),
    );
    const exportUrl = calls.find((call) => call.url.startsWith(EXPORT_PATH));
    expect(exportUrl?.url).not.toContain("member=");
  });
});

describe("cambiar el rol de los marcados", () => {
  it("elegir un rol sólo pide confirmación, sin guardar nada", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz", "Tom Baker"]);

    await chooseBulkRole(user, "Coach");

    expect(screen.getByText("¿Cambiar 2 miembros a Coach?")).toBeTruthy();
    expect(rolesCalls()).toEqual([]);
  });

  it("Cancelar quita la franja sin guardar", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz"]);
    await chooseBulkRole(user, "Coach");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText(/¿Cambiar 1 miembro/)).toBeNull();
    expect(rolesCalls()).toEqual([]);
    expect(checkboxOf("Nerea Ruiz").checked).toBe(true);
  });

  it("confirmar cambia a los marcados, actualiza sus filas y los desmarca", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz", "Tom Baker"]);
    await chooseBulkRole(user, "Coach");

    await user.click(screen.getByRole("button", { name: "Cambiar roles" }));

    expect(await screen.findByText("2 miembros ahora son Coach.")).toBeTruthy();
    expect(rolesCalls().map((call) => call.body)).toEqual([
      { userIds: [NEREA_ID, TOM_ID], role: "Coach" },
    ]);
    expect(within(rowOf("Nerea Ruiz")).getByText("Coach")).toBeTruthy();
    expect(within(rowOf("Tom Baker")).getByText("Coach")).toBeTruthy();
    expect(checkboxOf("Nerea Ruiz").checked).toBe(false);
    expect(
      screen.queryByRole("group", { name: /^[0-9]+ seleccionados?$/ }),
    ).toBeNull();
  });

  it("un resultado parcial dice cuáles fallaron y por qué", async () => {
    stubApi({ failures: { [ANA_ID]: "last_admin" } });
    const user = await renderDirectory();
    await markMembers(user, ["Ana Admin", "Nerea Ruiz"]);
    await chooseBulkRole(user, "Jugador");

    await user.click(screen.getByRole("button", { name: "Cambiar roles" }));

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("1 miembro ahora es Jugador.");
    expect(notice.textContent).toContain("Ana Admin");
    expect(notice.textContent).toContain("último Admin");
    expect(within(rowOf("Ana Admin")).getByText("Admin")).toBeTruthy();
  });

  it("quien ya tenía el rol no cuenta como cambiado", async () => {
    stubApi({ unchanged: [NEREA_ID] });
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz", "Tom Baker"]);
    await chooseBulkRole(user, "Coach");

    await user.click(screen.getByRole("button", { name: "Cambiar roles" }));

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("1 miembro ahora es Coach.");
    expect(notice.textContent).toContain("1 ya tenía ese rol.");
  });

  it("un doble clic en Cambiar roles manda una sola petición", async () => {
    stubApi();
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz"]);
    await chooseBulkRole(user, "Coach");

    await user.dblClick(screen.getByRole("button", { name: "Cambiar roles" }));

    await screen.findByText("1 miembro ahora es Coach.");
    expect(rolesCalls()).toHaveLength(1);
  });

  it("si el servidor lo rechaza entero, lo dice y conserva los marcados", async () => {
    stubApi({ rolesStatus: 403 });
    const user = await renderDirectory();
    await markMembers(user, ["Nerea Ruiz"]);
    await chooseBulkRole(user, "Coach");

    await user.click(screen.getByRole("button", { name: "Cambiar roles" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(checkboxOf("Nerea Ruiz").checked).toBe(true);
    expect(within(rowOf("Nerea Ruiz")).getByText("Jugador")).toBeTruthy();
  });
});
