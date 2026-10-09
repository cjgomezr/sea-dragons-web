import { describe, expect, it } from "vitest";
import type {
  AdminDirectoryMember,
  CommitteeDirectoryMember,
} from "@/lib/directory/directory";
import {
  CSV_BYTE_ORDER_MARK,
  directoryCsv,
  directoryCsvFilename,
  encodeCsv,
} from "@/lib/directory/directory-csv";
import { createTranslator } from "@/lib/i18n/translator";
import { DEFENDER, asDirectoryPosition } from "../helpers/seeded-positions";

/**
 * El CSV del directorio (#500, RF-5 del PRD de E19): una función pura que
 * convierte la lista que ve Admin o Committee en el archivo que abre Excel.
 */

const CRLF = "\r\n";

const COMMITTEE_MARIA: CommitteeDirectoryMember = {
  userId: "cccccccc-0000-4000-8000-00000000000c",
  fullName: "María Ñíguez",
  country: "AU",
  experienceLevel: "Intermediate",
  role: "Player",
  position: asDirectoryPosition(DEFENDER),
  status: "active",
  invitedOn: null,
  photoUrl: null,
  attendance: { kind: "rate", percent: 75, sessions: 3 },
  email: "maria@club.test",
  phone: "0412 345 678",
  emergencyContact: {
    name: "Rosa Ñíguez",
    phone: "0499 111 222",
    relationship: "Madre",
  },
};

const ADMIN_MARIA: AdminDirectoryMember = {
  ...COMMITTEE_MARIA,
  isEvaluated: false,
  aufNumber: "AUF-7",
  aufExpiry: "2027-01-31",
  isAufVerified: true,
  isAufExpired: false,
  isAufExpiring: false,
  membershipStatus: "past_due",
};

const BARE_MEMBER: CommitteeDirectoryMember = {
  ...COMMITTEE_MARIA,
  userId: "dddddddd-0000-4000-8000-00000000000d",
  fullName: "Zoe Zapata",
  country: null,
  experienceLevel: null,
  position: null,
  status: "incomplete",
  attendance: { kind: "no_data" },
  phone: null,
  emergencyContact: null,
};

function linesOf(csv: string): readonly string[] {
  return csv.slice(CSV_BYTE_ORDER_MARK.length).split(CRLF);
}

describe("encodeCsv", () => {
  it("empieza por la marca de orden de bytes para que Excel lea UTF-8", () => {
    const csv = encodeCsv([["Ñandú"]]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("separa las celdas con comas y las filas con CRLF", () => {
    const csv = encodeCsv([
      ["a", "b"],
      ["c", "d"],
    ]);

    expect(csv).toBe(`\uFEFFa,b${CRLF}c,d${CRLF}`);
  });

  it("entrecomilla una celda con una coma", () => {
    expect(linesOf(encodeCsv([["Gil, Tomás"]]))[0]).toBe('"Gil, Tomás"');
  });

  it("dobla las comillas de dentro y entrecomilla la celda", () => {
    expect(linesOf(encodeCsv([['Ana "La Foca"']]))[0]).toBe(
      '"Ana ""La Foca"""',
    );
  });

  it("entrecomilla una celda con un salto de línea sin partir la fila", () => {
    const csv = encodeCsv([["Primera\nSegunda", "x"]]);

    expect(csv).toBe(`\uFEFF"Primera\nSegunda",x${CRLF}`);
  });

  it.each(["=SUMA(A1)", "+61 412", "-1", "@cmd", "\tx", "\rx"])(
    "escapa %j para que Excel no lo ejecute como fórmula",
    (value) => {
      const [cell] = linesOf(encodeCsv([[value]]));

      expect(cell?.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("escapa la fórmula y además la entrecomilla si lleva comas", () => {
    expect(linesOf(encodeCsv([["=1,2"]]))[0]).toBe(`"'=1,2"`);
  });

  it("escribe un número tal cual, sin escaparlo", () => {
    expect(linesOf(encodeCsv([[75, -3]]))[0]).toBe("75,-3");
  });

  it("deja vacía la celda de un dato que falta", () => {
    expect(linesOf(encodeCsv([["a", null, "b"]]))[0]).toBe("a,,b");
  });
});

describe("directoryCsv", () => {
  it("escribe una fila por socio, en el orden de la lista, tras la cabecera", () => {
    const csv = directoryCsv(
      { kind: "committee", members: [COMMITTEE_MARIA, BARE_MEMBER] },
      createTranslator("es"),
    );

    const lines = linesOf(csv);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("María Ñíguez");
    expect(lines[2]).toContain("Zoe Zapata");
    expect(lines[3]).toBe("");
  });

  it("da al Committee las columnas de su pantalla, sin AUF ni membresía", () => {
    const [header] = linesOf(
      directoryCsv({ kind: "committee", members: [] }, createTranslator("es")),
    );

    expect(header).toBe(
      [
        "Nombre",
        "País",
        "Nivel",
        "Estado de la cuenta",
        "Rol",
        "Posición",
        "Asistencia (%)",
        "Correo",
        "Teléfono",
        "Contacto de emergencia",
        "Teléfono de emergencia",
        "Relación del contacto",
      ].join(","),
    );
  });

  it("da al Admin además el AUF, la membresía y si está evaluado", () => {
    const [header] = linesOf(
      directoryCsv({ kind: "admin", members: [] }, createTranslator("es")),
    );

    expect(header).toBe(
      [
        "Nombre",
        "País",
        "Nivel",
        "Número de AUF",
        "Vencimiento del AUF",
        "AUF verificado",
        "Estado de la cuenta",
        "Membresía",
        "Evaluado",
        "Rol",
        "Posición",
        "Asistencia (%)",
        "Correo",
        "Teléfono",
        "Contacto de emergencia",
        "Teléfono de emergencia",
        "Relación del contacto",
      ].join(","),
    );
  });

  it("escribe las cabeceras en inglés a quien exporta en inglés", () => {
    const [header] = linesOf(
      directoryCsv({ kind: "committee", members: [] }, createTranslator("en")),
    );

    expect(header?.split(",")[0]).toBe("Name");
    expect(header).not.toContain("Nombre");
  });

  it("escribe la fila del Committee con los valores en su idioma", () => {
    const [, row] = linesOf(
      directoryCsv(
        { kind: "committee", members: [COMMITTEE_MARIA] },
        createTranslator("es"),
      ),
    );

    expect(row).toBe(
      [
        "María Ñíguez",
        "Australia",
        "Intermedio",
        "Activa",
        "Jugador",
        DEFENDER.names.es,
        "75",
        "maria@club.test",
        "0412 345 678",
        "Rosa Ñíguez",
        "0499 111 222",
        "Madre",
      ].join(","),
    );
  });

  it("escribe la fecha del AUF como AAAA-MM-DD y la asistencia como número", () => {
    const [, row] = linesOf(
      directoryCsv(
        { kind: "admin", members: [ADMIN_MARIA] },
        createTranslator("es"),
      ),
    );

    const cells = row?.split(",");
    expect(cells?.slice(3, 9)).toEqual([
      "AUF-7",
      "2027-01-31",
      "Sí",
      "Activa",
      "Pago atrasado",
      "No",
    ]);
    expect(cells?.[11]).toBe("75");
  });

  it("deja vacías las celdas de lo que el socio no tiene", () => {
    const [, row] = linesOf(
      directoryCsv(
        { kind: "committee", members: [BARE_MEMBER] },
        createTranslator("es"),
      ),
    );

    expect(row).toBe(
      [
        "Zoe Zapata",
        "",
        "",
        "Pendiente de activar",
        "Jugador",
        "",
        "",
        "maria@club.test",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  });

  it("escapa un teléfono que empieza por + para que no sea una fórmula", () => {
    const [, row] = linesOf(
      directoryCsv(
        {
          kind: "committee",
          members: [{ ...COMMITTEE_MARIA, phone: "+61 412 345 678" }],
        },
        createTranslator("es"),
      ),
    );

    expect(row?.split(",")[8]).toBe("'+61 412 345 678");
  });

  it("escribe 500 socios en mucho menos de 2 segundos", () => {
    const members = Array.from({ length: 500 }, (_, index) => ({
      ...ADMIN_MARIA,
      fullName: `Socio ${index}, "apodo"`,
    }));

    const startedAt = performance.now();
    const csv = directoryCsv(
      { kind: "admin", members },
      createTranslator("es"),
    );
    const elapsed = performance.now() - startedAt;

    expect(linesOf(csv)).toHaveLength(502);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("directoryCsvFilename", () => {
  it("lleva el club y la fecha del día en Melbourne", () => {
    expect(
      directoryCsvFilename({
        clubName: "Victoria Seadragons",
        todayInClub: "2026-10-08",
        translate: createTranslator("es"),
      }),
    ).toBe("victoria-seadragons-directorio-2026-10-08.csv");
  });

  it("quita acentos y signos para que el nombre sirva en cualquier sistema", () => {
    expect(
      directoryCsvFilename({
        clubName: "Club Ñandú / Sub-acuático",
        todayInClub: "2026-10-08",
        translate: createTranslator("en"),
      }),
    ).toBe("club-nandu-sub-acuatico-directory-2026-10-08.csv");
  });

  it("no empieza por un guion si el nombre del club no deja letras", () => {
    expect(
      directoryCsvFilename({
        clubName: "海龍",
        todayInClub: "2026-10-08",
        translate: createTranslator("es"),
      }),
    ).toBe("directorio-2026-10-08.csv");
  });
});
