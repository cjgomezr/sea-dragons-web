import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DirectoryTable } from "@/components/directory/DirectoryTable";
import type {
  AdminDirectoryMember,
  DirectoryListing,
} from "@/lib/directory/directory";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * La lista con los 500 socios de NFR-008 (#549, RF-3). El club no pagina el
 * directorio, así que la fila compacta tiene que pintarse entera sin que se
 * note. jsdom no mide el desplazamiento: lo que sí mide es cuánto cuesta
 * construir las 500 filas de Admin, que son las más cargadas (puntos,
 * píldoras y enlaces). El presupuesto es holgado a propósito: está para
 * pillar una fila que se vuelva cara (un efecto por fila, un cálculo
 * cuadrático), no para medir milisegundos de una máquina concreta.
 *
 * Como referencia, en un portátil con Windows estas filas tardan unos 3 s en
 * jsdom, y las de antes de #549, con un selector de rol por fila, unos 10 s.
 */

const CLUB_SIZE = 500;

/** El doble de lo que tarda hoy en la máquina más lenta en que se probó. */
const RENDER_BUDGET_MS = 6000;

/** jsdom y React tardan en arrancar la primera vez; eso no es la lista. */
const WARM_UP_SIZE = 10;

/** Construir 500 filas en jsdom no cabe en los 5 s por defecto de Vitest. */
const TEST_TIMEOUT_MS = 30_000;

function adminMember(index: number): AdminDirectoryMember {
  const id = String(index).padStart(12, "0");
  return {
    userId: `aaaaaaaa-0000-4000-8000-${id}`,
    fullName: `Socio ${index}`,
    country: "AU",
    experienceLevel: "Intermediate",
    role: "Player",
    position: null,
    status: index % 10 === 0 ? "incomplete" : "active",
    invitedOn: index % 10 === 0 ? "2026-10-05" : null,
    photoUrl: null,
    attendance: { kind: "rate", percent: index % 100, sessions: 10 },
    aufNumber: index % 3 === 0 ? null : `AUF-${index}`,
    aufExpiry: "2026-10-20",
    isAufVerified: true,
    isAufExpired: index % 7 === 0,
    isAufExpiring: index % 5 === 0,
    isEvaluated: index % 2 === 0,
    membershipStatus: index % 4 === 0 ? "past_due" : "active",
    email: `socio${index}@club.test`,
    phone: null,
    emergencyContact: null,
  };
}

function adminListing(size: number): DirectoryListing {
  return {
    kind: "admin",
    members: Array.from({ length: size }, (_unused, index) =>
      adminMember(index),
    ),
    availableFilters: [],
    total: size,
  };
}

function renderTable(listing: DirectoryListing): void {
  render(
    <DirectoryTable
      translate={createTranslator("en")}
      locale="en"
      listing={listing}
      order={{ sort: "name", direction: "asc" }}
      requestedRoles={new Map()}
      selection={{ selectedUserId: null, onToggle: () => undefined }}
      onSort={() => undefined}
    />,
  );
}

describe("la lista con 500 socios (#549)", () => {
  it(
    "pinta las 500 filas de Admin dentro del presupuesto",
    () => {
      renderTable(adminListing(WARM_UP_SIZE));
      cleanup();
      const listing = adminListing(CLUB_SIZE);
      const startedAt = performance.now();

      renderTable(listing);

      const elapsed = performance.now() - startedAt;
      // Las filas se cuentan por la tabla y no con `getAllByRole("row")`,
      // que en jsdom tarda más con 500 filas que pintarlas.
      const table = screen.getByRole("table");
      expect(
        table instanceof HTMLTableElement && table.tBodies[0]?.rows.length,
      ).toBe(CLUB_SIZE);
      expect(elapsed).toBeLessThan(RENDER_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );
});
