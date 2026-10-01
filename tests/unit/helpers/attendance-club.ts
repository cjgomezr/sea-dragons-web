import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import type {
  AttendanceEvent,
  AttendanceGateways,
  AttendanceStatus,
  NewAttendanceSheet,
} from "@/lib/attendance/attendance-sheet";
import type { ClubPosition } from "@/lib/club/club-positions";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { ClubAudience } from "@/lib/notifications/audience-members";
import { GOALKEEPER } from "./seeded-positions";

export { GOALKEEPER };

/**
 * Un club en memoria para los tests de la hoja de asistencia (#393). El doble
 * cumple el contrato del adaptador y de `save_attendance_sheet`: sólo
 * encuentra eventos del club que se le pide, y guardar sustituye la hoja
 * entera de esa sesión, nunca la mezcla con la anterior.
 */

export const ATTENDANCE_CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
export const ATTENDANCE_CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const OTHER_CLUB_ID = "5c1ab000-0000-4000-8000-000000000002";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const TRAINING_ID = "e1e1e1e1-0000-4000-8000-00000000000e";

/** 2027-06-15 20:00 en Melbourne (hora estándar, UTC+10). */
export const ATTENDANCE_NOW = new Date("2027-06-15T10:00:00Z");

/** El entrenamiento de ese día a las 19:00, para todo el club: ya empezó. */
export const STARTED_TRAINING: AttendanceEvent = {
  id: TRAINING_ID,
  clubId: ATTENDANCE_CLUB_ID,
  eventType: "training",
  title: "Entrenamiento del martes",
  status: "scheduled",
  startsAt: new Date("2027-06-15T09:00:00Z"),
  audience: { kind: "club" },
};

export type FakeMember = {
  readonly userId: string;
  readonly fullName: string;
  readonly status?: AccountStatus;
  readonly groupIds?: readonly string[];
  readonly positionId?: string;
  readonly photoPath?: string;
  /** Si su membresía está al día (#453); sin decirlo, lo está. */
  readonly membershipCurrent?: boolean;
};

export type FakeAttendanceClubOptions = {
  readonly callerRole?: Role;
  readonly events?: readonly AttendanceEvent[];
  readonly members?: readonly FakeMember[];
  readonly rsvps?: Readonly<Record<string, RsvpResponse>>;
  readonly records?: Readonly<Record<string, AttendanceStatus>>;
  readonly positions?: readonly ClubPosition[];
  /** El almacenamiento no firma ninguna foto. */
  readonly unsignablePhotos?: boolean;
};

/** La dirección firmada que el doble da a una ruta de foto. */
export function signedPhotoUrl(photoPath: string): string {
  return `https://storage.test/signed/${photoPath}`;
}

export type FakeAttendanceClub = {
  readonly gateways: AttendanceGateways;
  /** La hoja de `TRAINING_ID` tal como está en la base. */
  readonly sheet: () => ReadonlyMap<string, AttendanceStatus>;
  readonly saves: NewAttendanceSheet[];
  /** El orden en que se escribió: la hoja y la bitácora. */
  readonly writes: string[];
  readonly auditActions: string[];
};

export function memberId(index: number): string {
  return `4e4e4e4e-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function reaches(audience: ClubAudience, member: FakeMember): boolean {
  if (audience.kind === "club") {
    return true;
  }
  return (member.groupIds ?? []).some((id) => audience.groupIds.includes(id));
}

export function fakeAttendanceClub(
  options: FakeAttendanceClubOptions = {},
): FakeAttendanceClub {
  const events = options.events ?? [STARTED_TRAINING];
  const members = options.members ?? [];
  let records = new Map<string, AttendanceStatus>(
    Object.entries(options.records ?? {}),
  );
  const saves: NewAttendanceSheet[] = [];
  const writes: string[] = [];
  const auditActions: string[] = [];
  const gateways: AttendanceGateways = {
    members: {
      findRoleRequestMember: async () => ({
        clubId: ATTENDANCE_CLUB_ID,
        fullName: "Carla Coach",
        role: options.callerRole ?? "Coach",
      }),
    },
    audience: {
      findAudienceMemberIds: async ({ audience }) =>
        members
          .filter((member) => reaches(audience, member))
          .map((member) => member.userId),
    },
    sheets: {
      findEvent: async ({ clubId, eventId }) =>
        events.find(
          (event) => event.id === eventId && event.clubId === clubId,
        ) ?? null,
      findMembers: async ({ userIds }) =>
        members
          .filter((member) => userIds.includes(member.userId))
          .map((member) => ({
            userId: member.userId,
            fullName: member.fullName,
            status: member.status ?? "active",
            positionId: member.positionId ?? null,
            photoPath: member.photoPath ?? null,
            membershipCurrent: member.membershipCurrent ?? true,
          })),
      findRsvps: async () =>
        Object.entries(options.rsvps ?? {}).map(([userId, response]) => ({
          userId,
          response,
        })),
      findRecords: async () =>
        [...records].map(([userId, status]) => ({ userId, status })),
      saveSheet: async (sheet) => {
        saves.push(sheet);
        writes.push("sheet");
        records = new Map(
          sheet.records.map((record) => [record.userId, record.status]),
        );
        return "saved";
      },
    },
    positions: {
      findClubPositions: async () => options.positions ?? [],
    },
    photos: {
      signPhotoUrls: async (photoPaths) =>
        new Map(
          options.unsignablePhotos
            ? []
            : photoPaths.map((path) => [path, signedPhotoUrl(path)]),
        ),
    },
    audit: {
      insertAuditLogRow: async (row) => {
        writes.push("audit");
        auditActions.push(`${row.action}|${row.entity_id}|${row.actor_id}`);
        expectNoMetadata(row.metadata);
        return { error: null };
      },
    },
  };
  return { gateways, sheet: () => records, saves, writes, auditActions };
}

function expectNoMetadata(metadata: unknown): void {
  if (metadata !== null) {
    throw new Error("La bitácora de asistencia no lleva metadata.");
  }
}
