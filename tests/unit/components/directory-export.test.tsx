import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryScreen } from "@/components/directory/DirectoryScreen";
import type {
  CommitteeDirectoryMember,
  DirectoryListing,
} from "@/lib/directory/directory";

/**
 * El botón "Exportar CSV" del directorio (#500, RF-5 del PRD de E19): sólo
 * para Admin y Committee, deshabilitado sin nadie en la lista, y descarga
 * lo que la pantalla está enseñando. El servidor es de mentira: el archivo de
 * verdad lo prueban el dominio y la ruta.
 */

const EXPORT_PATH = "/api/v1/directory/export";
const FILENAME = "victoria-seadragons-directorio-2026-10-08.csv";
const BLOB_URL = "blob:http://localhost/csv";

const NEREA: CommitteeDirectoryMember = {
  userId: "b1b1b1b1-0000-4000-8000-00000000000b",
  fullName: "Nerea Ruiz",
  country: "ES",
  experienceLevel: "Beginner",
  role: "Player",
  position: null,
  status: "active",
  photoUrl: null,
  attendance: { kind: "no_data" },
  email: "nerea@club.test",
  phone: null,
  emergencyContact: null,
};

const ADMIN_NEREA = {
  ...NEREA,
  isEvaluated: true,
  aufNumber: null,
  aufExpiry: null,
  isAufVerified: false,
  isAufExpired: false,
  membershipStatus: null,
};

const COACH_NEREA = {
  ...NEREA,
  isEvaluated: true,
};

type Kind = DirectoryListing["kind"];

const requestedUrls: string[] = [];
const clickedDownloads: { href: string; download: string }[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function csvResponse(): Response {
  return new Response("\uFEFFNombre\r\nNerea Ruiz\r\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${FILENAME}"`,
    },
  });
}

function stubApi(
  kind: Kind,
  members: readonly unknown[],
  exportResponse: () => Response = csvResponse,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.startsWith(EXPORT_PATH)) {
        return exportResponse();
      }
      if (url.startsWith("/api/v1/directory")) {
        return jsonResponse(200, {
          data: { kind, members, availableFilters: ["position"] },
        });
      }
      if (url === "/api/v1/club/positions") {
        return jsonResponse(200, { data: { positions: [] } });
      }
      if (url.startsWith("/api/v1/role-requests")) {
        return jsonResponse(200, { data: { requests: [] } });
      }
      throw new Error(`Petición inesperada: ${url}`);
    }),
  );
}

beforeEach(() => {
  requestedUrls.length = 0;
  clickedDownloads.length = 0;
  // jsdom no implementa las direcciones de un Blob.
  URL.createObjectURL = vi.fn(() => BLOB_URL);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedDownloads.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el botón de exportar", () => {
  it.each([
    ["committee", NEREA],
    ["admin", ADMIN_NEREA],
  ] as const)(
    "se ofrece a quien recibe la lista de %s",
    async (kind, member) => {
      stubApi(kind, [member]);
      render(<DirectoryScreen locale="es" />);

      expect(
        await screen.findByRole("button", { name: "Exportar CSV" }),
      ).toBeTruthy();
    },
  );

  it.each([
    ["coach", COACH_NEREA],
    ["member", NEREA],
  ] as const)(
    "no se ofrece a quien recibe la lista de %s",
    async (kind, member) => {
      stubApi(kind, [member]);
      render(<DirectoryScreen locale="es" />);

      await screen.findByText("Nerea Ruiz");

      expect(screen.queryByRole("button", { name: "Exportar CSV" })).toBeNull();
    },
  );

  it("con la lista vacía está deshabilitado y dice por qué", async () => {
    stubApi("committee", []);
    render(<DirectoryScreen locale="es" />);

    const button = (await screen.findByRole("button", {
      name: "Exportar CSV",
    })) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button).toHaveAccessibleDescription(
      "No hay miembros en la lista que exportar.",
    );
  });

  it("pide la exportación con la misma consulta que la lista", async () => {
    stubApi("committee", [NEREA]);
    render(<DirectoryScreen locale="es" />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Exportar CSV" }));

    await waitFor(() => expect(clickedDownloads).toHaveLength(1));
    const listUrl = requestedUrls.find((url) =>
      url.startsWith("/api/v1/directory?"),
    );
    const exportUrl = requestedUrls.find((url) => url.startsWith(EXPORT_PATH));
    expect(exportUrl?.slice(EXPORT_PATH.length)).toBe(
      listUrl?.slice("/api/v1/directory".length),
    );
  });

  it("descarga el archivo con el nombre que da el servidor", async () => {
    stubApi("committee", [NEREA]);
    render(<DirectoryScreen locale="es" />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Exportar CSV" }));

    await waitFor(() =>
      expect(clickedDownloads).toEqual([
        { href: BLOB_URL, download: FILENAME },
      ]),
    );
  });

  it("avisa si el servidor no la deja exportar", async () => {
    stubApi("committee", [NEREA], () =>
      jsonResponse(403, {
        error: {
          code: "forbidden",
          message: "x",
          reason: "directory_export_forbidden",
        },
      }),
    );
    render(<DirectoryScreen locale="es" />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Exportar CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo exportar la lista. Inténtalo de nuevo.",
    );
    expect(clickedDownloads).toEqual([]);
  });
});
