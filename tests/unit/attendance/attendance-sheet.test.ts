import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  AttendanceClosedError,
  AttendanceForbiddenError,
  AttendanceListInvalidError,
  AttendanceMemberOutsideSheetError,
  type AttendanceRecord,
  openAttendanceSheet,
  saveAttendanceSheet,
} from "@/lib/attendance/attendance-sheet";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import {
  ATTENDANCE_CALLER_ID,
  ATTENDANCE_NOW,
  type FakeAttendanceClubOptions,
  type FakeMember,
  GOALKEEPER,
  OTHER_CLUB_ID,
  SENIOR_SQUAD_ID,
  STARTED_TRAINING,
  TRAINING_ID,
  fakeAttendanceClub,
  memberId,
  signedPhotoUrl,
} from "../helpers/attendance-club";

/**
 * La hoja de asistencia de un entrenamiento (#393, RF-2 y RF-3 del PRD de
 * E8), contada sin Supabase delante. La hora que decide si ya empezó es la
 * que recibe el dominio, que el endpoint toma del servidor.
 */

const ANA: FakeMember = { userId: memberId(1), fullName: "Ana Zamora" };
const BRUNO: FakeMember = { userId: memberId(2), fullName: "Bruno Yáñez" };
const CARLA: FakeMember = { userId: memberId(3), fullName: "Carla Xu" };
const DIEGO: FakeMember = { userId: memberId(4), fullName: "Diego Wu" };

function open(options: FakeAttendanceClubOptions, eventId = TRAINING_ID) {
  return openAttendanceSheet(fakeAttendanceClub(options).gateways, {
    callerId: ATTENDANCE_CALLER_ID,
    eventId,
    now: ATTENDANCE_NOW,
  });
}

function everyonePresent(
  members: readonly FakeMember[],
): readonly AttendanceRecord[] {
  return members.map(({ userId }) => ({ userId, status: "present" }));
}

describe("la hoja de asistencia", () => {
  it.each<Role>(["Coach", "Admin"])(
    "da a un %s una hoja nueva con quien no respondió en absent",
    async (callerRole) => {
      const sheet = await open({ callerRole, members: [ANA, BRUNO] });

      expect(sheet).toEqual({
        eventId: TRAINING_ID,
        title: STARTED_TRAINING.title,
        startsAt: STARTED_TRAINING.startsAt.toISOString(),
        isSaved: false,
        viewer: callerRole === "Admin" ? "admin" : "coach",
        members: [
          {
            userId: ANA.userId,
            fullName: ANA.fullName,
            photoUrl: null,
            position: null,
            status: "absent",
            rsvpResponse: null,
            isInactive: false,
          },
          {
            userId: BRUNO.userId,
            fullName: BRUNO.fullName,
            photoUrl: null,
            position: null,
            status: "absent",
            rsvpResponse: null,
            isInactive: false,
          },
        ],
      });
    },
  );

  it.each([
    ["Admin", "admin"],
    ["Coach", "coach"],
  ] as const)(
    "le dice a un %s que la mira como %s, para decidir si el nombre abre la ficha (#414)",
    async (callerRole, viewer) => {
      const sheet = await open({ callerRole, members: [ANA] });

      expect(sheet.viewer).toBe(viewer);
    },
  );

  it("da a cada miembro su foto firmada y su posición, para pintar la fila (#395)", async () => {
    const sheet = await open({
      members: [
        {
          ...ANA,
          photoPath: `${ANA.userId}/thumb.webp`,
          positionId: GOALKEEPER.id,
        },
        BRUNO,
      ],
      positions: [GOALKEEPER],
    });

    expect(
      sheet.members.map(({ photoUrl, position }) => ({ photoUrl, position })),
    ).toEqual([
      {
        photoUrl: signedPhotoUrl(`${ANA.userId}/thumb.webp`),
        position: { id: GOALKEEPER.id, names: GOALKEEPER.names },
      },
      { photoUrl: null, position: null },
    ]);
  });

  it("deja las iniciales a quien tiene foto que no se pudo firmar", async () => {
    const sheet = await open({
      members: [{ ...ANA, photoPath: `${ANA.userId}/thumb.webp` }],
      unsignablePhotos: true,
    });

    expect(sheet.members.map((entry) => entry.photoUrl)).toEqual([null]);
  });

  it("empieza una hoja nueva en present a quien dijo Sí o Quizás y en absent a quien dijo No o no respondió (D6)", async () => {
    const sheet = await open({
      members: [ANA, BRUNO, CARLA, DIEGO],
      rsvps: {
        [ANA.userId]: "yes",
        [BRUNO.userId]: "maybe",
        [CARLA.userId]: "no",
      },
    });

    expect(
      sheet.members.map((entry) => [entry.fullName, entry.status]),
    ).toEqual([
      [ANA.fullName, "present"],
      [BRUNO.fullName, "present"],
      [DIEGO.fullName, "absent"],
      [CARLA.fullName, "absent"],
    ]);
  });

  it("pone primero los Sí, luego los Quizás, luego quien no respondió y al final los No, por nombre", async () => {
    const sheet = await open({
      members: [ANA, BRUNO, CARLA, DIEGO],
      rsvps: {
        [ANA.userId]: "no",
        [BRUNO.userId]: "maybe",
        [CARLA.userId]: "yes",
      },
    });

    expect(
      sheet.members.map((entry) => [entry.fullName, entry.rsvpResponse]),
    ).toEqual([
      [CARLA.fullName, "yes"],
      [BRUNO.fullName, "maybe"],
      [DIEGO.fullName, null],
      [ANA.fullName, "no"],
    ]);
  });

  it("en una hoja guardada conserva lo guardado sea cual sea la respuesta, y quien entró después sigue su respuesta", async () => {
    const sheet = await open({
      members: [ANA, BRUNO, CARLA, DIEGO],
      rsvps: {
        [ANA.userId]: "no",
        [BRUNO.userId]: "yes",
        [CARLA.userId]: "yes",
      },
      records: {
        [ANA.userId]: "present",
        [BRUNO.userId]: "absent",
      },
    });

    expect(
      sheet.members.map((entry) => [entry.fullName, entry.status]),
    ).toEqual([
      [BRUNO.fullName, "absent"],
      [CARLA.fullName, "present"],
      [DIEGO.fullName, "absent"],
      [ANA.fullName, "present"],
    ]);
  });

  it("deja fuera de una hoja nueva a quien está de baja", async () => {
    const sheet = await open({
      members: [ANA, { ...BRUNO, status: "inactive" }],
    });

    expect(sheet.members.map((entry) => entry.userId)).toEqual([ANA.userId]);
  });

  it("deja fuera de una hoja nueva a quien no tiene la membresía al día (#453)", async () => {
    const sheet = await open({
      members: [ANA, { ...BRUNO, membershipCurrent: false }],
    });

    expect(sheet.members.map((entry) => entry.userId)).toEqual([ANA.userId]);
  });

  it("conserva en una hoja guardada a quien ya tenía fila aunque deje de estar al día (#453, D1 de E8)", async () => {
    const sheet = await open({
      members: [ANA, { ...BRUNO, membershipCurrent: false }],
      records: { [ANA.userId]: "present", [BRUNO.userId]: "late" },
    });

    expect(
      sheet.members.map((entry) => [entry.fullName, entry.status]),
    ).toEqual([
      [ANA.fullName, "present"],
      [BRUNO.fullName, "late"],
    ]);
  });

  it("sirve solo a la audiencia de un entrenamiento para grupos", async () => {
    const sheet = await open({
      events: [
        {
          ...STARTED_TRAINING,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      ],
      members: [{ ...ANA, groupIds: [SENIOR_SQUAD_ID] }, BRUNO],
    });

    expect(sheet.members.map((entry) => entry.userId)).toEqual([ANA.userId]);
  });

  it("devuelve una hoja guardada con sus estados, quien salió de la audiencia y quien entró después", async () => {
    const sheet = await open({
      events: [
        {
          ...STARTED_TRAINING,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      ],
      members: [
        { ...ANA, groupIds: [SENIOR_SQUAD_ID] },
        BRUNO,
        { ...CARLA, groupIds: [SENIOR_SQUAD_ID], status: "inactive" },
        { ...DIEGO, groupIds: [SENIOR_SQUAD_ID] },
      ],
      records: {
        [ANA.userId]: "late",
        [BRUNO.userId]: "absent",
        [CARLA.userId]: "present",
      },
    });

    expect(sheet.isSaved).toBe(true);
    expect(
      sheet.members.map((entry) => [
        entry.fullName,
        entry.status,
        entry.isInactive,
      ]),
    ).toEqual([
      [ANA.fullName, "late", false],
      [BRUNO.fullName, "absent", false],
      [CARLA.fullName, "present", true],
      [DIEGO.fullName, "absent", false],
    ]);
  });

  it("se la da a un Coach que no está en la audiencia del entrenamiento", async () => {
    const sheet = await open({
      events: [
        {
          ...STARTED_TRAINING,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      ],
      members: [{ ...ANA, groupIds: [SENIOR_SQUAD_ID] }],
    });

    expect(sheet.members).toHaveLength(1);
  });

  it.each<Role>(["Committee", "Player"])(
    "niega la hoja a un %s",
    async (callerRole) => {
      await expect(open({ callerRole })).rejects.toBeInstanceOf(
        AttendanceForbiddenError,
      );
    },
  );

  it.each([
    ["no es de entrenamiento", { eventType: "social" }],
    ["es de otro club", { clubId: OTHER_CLUB_ID }],
  ] as const)("responde que no existe si el evento %s", async (_, change) => {
    await expect(
      open({ events: [{ ...STARTED_TRAINING, ...change }] }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("responde que no existe si no hay tal evento", async () => {
    await expect(
      open({}, "e9e9e9e9-0000-4000-8000-00000000000e"),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it.each([
    [
      "attendance_session_not_started",
      { startsAt: new Date(ATTENDANCE_NOW.getTime() + 60_000) },
    ],
    ["attendance_session_cancelled", { status: "cancelled" }],
  ] as const)("cierra la hoja con %s", async (code, change) => {
    await expect(
      open({ events: [{ ...STARTED_TRAINING, ...change }] }),
    ).rejects.toMatchObject(new AttendanceClosedError(code));
  });

  it("abre la hoja justo a la hora de inicio", async () => {
    const sheet = await open({
      events: [{ ...STARTED_TRAINING, startsAt: ATTENDANCE_NOW }],
    });

    expect(sheet.eventId).toBe(TRAINING_ID);
  });
});

describe("guardar la hoja", () => {
  it("guarda quince filas con sus estados y devuelve los totales", async () => {
    const members = Array.from({ length: 15 }, (_, index) => ({
      userId: memberId(index + 1),
      fullName: `Miembro ${index + 1}`,
    }));
    const club = fakeAttendanceClub({ members });
    const records: readonly AttendanceRecord[] = members.map(
      ({ userId }, index) => ({
        userId,
        status: index < 2 ? "late" : index === 2 ? "absent" : "present",
      }),
    );

    const saved = await saveAttendanceSheet(club.gateways, {
      callerId: ATTENDANCE_CALLER_ID,
      eventId: TRAINING_ID,
      records,
      now: ATTENDANCE_NOW,
    });

    expect(saved).toEqual({
      eventId: TRAINING_ID,
      totals: { present: 12, late: 2, absent: 1 },
    });
    expect(club.saves).toEqual([
      {
        clubId: STARTED_TRAINING.clubId,
        eventId: TRAINING_ID,
        recordedBy: ATTENDANCE_CALLER_ID,
        records,
      },
    ]);
  });

  it("escribe la bitácora después de guardar, con quién y qué sesión", async () => {
    const club = fakeAttendanceClub({ members: [ANA] });

    await saveAttendanceSheet(club.gateways, {
      callerId: ATTENDANCE_CALLER_ID,
      eventId: TRAINING_ID,
      records: everyonePresent([ANA]),
      now: ATTENDANCE_NOW,
    });

    expect(club.writes).toEqual(["sheet", "audit"]);
    expect(club.auditActions).toEqual([
      `attendance.saved|${TRAINING_ID}|${ATTENDANCE_CALLER_ID}`,
    ]);
  });

  it("dos guardados seguidos dejan la hoja del último, entera", async () => {
    const club = fakeAttendanceClub({ members: [ANA, BRUNO] });
    const save = (records: readonly AttendanceRecord[]) =>
      saveAttendanceSheet(club.gateways, {
        callerId: ATTENDANCE_CALLER_ID,
        eventId: TRAINING_ID,
        records,
        now: ATTENDANCE_NOW,
      });

    await save([
      { userId: ANA.userId, status: "late" },
      { userId: BRUNO.userId, status: "absent" },
    ]);
    await save([{ userId: ANA.userId, status: "present" }]);

    expect([...club.sheet()]).toEqual([[ANA.userId, "present"]]);
    expect(club.auditActions).toHaveLength(2);
  });

  it("reescribe una hoja guardada días después", async () => {
    const club = fakeAttendanceClub({
      members: [ANA],
      records: { [ANA.userId]: "absent" },
    });
    const daysLater = new Date(ATTENDANCE_NOW.getTime() + 5 * 86_400_000);

    await saveAttendanceSheet(club.gateways, {
      callerId: ATTENDANCE_CALLER_ID,
      eventId: TRAINING_ID,
      records: [{ userId: ANA.userId, status: "late" }],
      now: daysLater,
    });

    expect(club.sheet().get(ANA.userId)).toBe("late");
  });

  it("deja guardar a quien salió de la audiencia pero tiene fila", async () => {
    const club = fakeAttendanceClub({
      events: [
        {
          ...STARTED_TRAINING,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      ],
      members: [{ ...ANA, status: "inactive" }],
      records: { [ANA.userId]: "present" },
    });

    await saveAttendanceSheet(club.gateways, {
      callerId: ATTENDANCE_CALLER_ID,
      eventId: TRAINING_ID,
      records: [{ userId: ANA.userId, status: "absent" }],
      now: ATTENDANCE_NOW,
    });

    expect(club.sheet().get(ANA.userId)).toBe("absent");
  });

  it.each([
    ["no es de la audiencia", BRUNO],
    ["está de baja y no tiene fila", { ...ANA, status: "inactive" as const }],
    [
      "no está al día y no tiene fila (#453)",
      { ...ANA, groupIds: [SENIOR_SQUAD_ID], membershipCurrent: false },
    ],
  ])("no escribe nada si un miembro %s", async (_, outsider: FakeMember) => {
    const club = fakeAttendanceClub({
      events: [
        {
          ...STARTED_TRAINING,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      ],
      members: [{ ...CARLA, groupIds: [SENIOR_SQUAD_ID] }, outsider],
    });

    await expect(
      saveAttendanceSheet(club.gateways, {
        callerId: ATTENDANCE_CALLER_ID,
        eventId: TRAINING_ID,
        records: everyonePresent([CARLA, outsider]),
        now: ATTENDANCE_NOW,
      }),
    ).rejects.toBeInstanceOf(AttendanceMemberOutsideSheetError);
    expect(club.writes).toEqual([]);
  });

  it.each([
    ["una lista vacía", []],
    [
      "un miembro repetido",
      [
        { userId: memberId(1), status: "present" },
        { userId: memberId(1), status: "late" },
      ],
    ],
  ] as const)("no escribe nada con %s", async (_, records) => {
    const club = fakeAttendanceClub({ members: [ANA] });

    await expect(
      saveAttendanceSheet(club.gateways, {
        callerId: ATTENDANCE_CALLER_ID,
        eventId: TRAINING_ID,
        records,
        now: ATTENDANCE_NOW,
      }),
    ).rejects.toBeInstanceOf(AttendanceListInvalidError);
    expect(club.writes).toEqual([]);
  });

  it.each<Role>(["Committee", "Player"])(
    "no deja guardar a un %s",
    async (callerRole) => {
      const club = fakeAttendanceClub({ callerRole, members: [ANA] });

      await expect(
        saveAttendanceSheet(club.gateways, {
          callerId: ATTENDANCE_CALLER_ID,
          eventId: TRAINING_ID,
          records: everyonePresent([ANA]),
          now: ATTENDANCE_NOW,
        }),
      ).rejects.toBeInstanceOf(AttendanceForbiddenError);
      expect(club.writes).toEqual([]);
    },
  );

  it.each([
    ["attendance_session_not_started", "not_started"],
    ["attendance_session_cancelled", "cancelled"],
  ] as const)(
    "responde %s si la base se niega por lo que pasó entretanto",
    async (code, outcome) => {
      const club = fakeAttendanceClub({ members: [ANA] });
      const gateways = {
        ...club.gateways,
        sheets: {
          ...club.gateways.sheets,
          saveSheet: async () => outcome,
        },
      };

      await expect(
        saveAttendanceSheet(gateways, {
          callerId: ATTENDANCE_CALLER_ID,
          eventId: TRAINING_ID,
          records: everyonePresent([ANA]),
          now: ATTENDANCE_NOW,
        }),
      ).rejects.toMatchObject(new AttendanceClosedError(code));
      expect(club.auditActions).toEqual([]);
    },
  );

  it("responde que no existe si la base ya no encuentra el entrenamiento", async () => {
    const club = fakeAttendanceClub({ members: [ANA] });
    const gateways = {
      ...club.gateways,
      sheets: {
        ...club.gateways.sheets,
        saveSheet: async () => "not_found" as const,
      },
    };

    await expect(
      saveAttendanceSheet(gateways, {
        callerId: ATTENDANCE_CALLER_ID,
        eventId: TRAINING_ID,
        records: everyonePresent([ANA]),
        now: ATTENDANCE_NOW,
      }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("no guarda un entrenamiento cancelado", async () => {
    const club = fakeAttendanceClub({
      events: [{ ...STARTED_TRAINING, status: "cancelled" }],
      members: [ANA],
    });

    await expect(
      saveAttendanceSheet(club.gateways, {
        callerId: ATTENDANCE_CALLER_ID,
        eventId: TRAINING_ID,
        records: everyonePresent([ANA]),
        now: ATTENDANCE_NOW,
      }),
    ).rejects.toMatchObject(
      new AttendanceClosedError("attendance_session_cancelled"),
    );
    expect(club.writes).toEqual([]);
  });
});
