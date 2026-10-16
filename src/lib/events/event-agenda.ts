import { z } from "zod";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { type Role, hasCapability } from "@/lib/auth/roles";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { type EventType, isEventType } from "./event-creation";
import {
  type EventCoverRef,
  type EventCoverUrls,
  type EventCoversGateway,
  NO_EVENT_COVER_URLS,
  signEventCover,
  signEventCoverThumbnails,
} from "./event-covers";
import type { EventPlace } from "./event-place";
import {
  EventNotFoundError,
  type RsvpResponse,
  isInAudience,
} from "./event-rsvp";

/**
 * La agenda y el detalle de un evento (#309, RF-4, RF-6 y RF-7 del PRD de
 * E7), contados sin Supabase delante.
 *
 * Admin y Committee ven todos los eventos del club, porque son quienes los
 * gestionan (ASS-006); cada uno les llega con si está en su audiencia, que es
 * lo que decide si pueden responder (B7). Un Coach o un Player sólo ve los de
 * su audiencia, y el que no le corresponde no existe para él (AC-052).
 *
 * Quién cuenta como "va" o "quizás" lo decide la base con la audiencia viva
 * del evento (`0039_event_rsvp_tallies.sql`): aquí sólo se pide una vez por
 * página y se reparte.
 */

export const AGENDA_PAGE_SIZE = 50;

export const AGENDA_PERIODS = ["upcoming", "past"] as const;

export type AgendaPeriod = (typeof AGENDA_PERIODS)[number];

export type EventStatus = "scheduled" | "cancelled";

export type AudienceGroup = { readonly id: string; readonly name: string };

/** La audiencia con el nombre de cada grupo, como la ve quien organiza. */
export type NamedEventAudience =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groups: readonly AudienceGroup[] };

/** Un evento tal como lo lee el adaptador. `startsAt` es el instante en ISO,
 * sólo para ordenar y paginar; la fecha y la hora de Melbourne son las que
 * se enseñan. */
export type EventRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly startTime: string;
  /** Nula en lo creado antes de E24 (D5). */
  readonly endTime: string | null;
  /** Nula si termina el mismo día que empieza. */
  readonly endsOn: string | null;
  readonly startsAt: string;
  readonly title: string;
  readonly eventType: EventType;
  readonly location: string;
  /** Nulo con texto libre y en lo anterior a E24 (#645). */
  readonly place: EventPlace | null;
  readonly placeDetail: string | null;
  readonly notes: string | null;
  readonly status: EventStatus;
  readonly seriesId: string | null;
  readonly audience: NamedEventAudience;
  /** La respuesta guardada de quien consulta, si la hay. */
  readonly myResponse: RsvpResponse | null;
  /** La imagen (#644). Una sesión de una serie trae la que heredó. */
  readonly coverUploadId: string | null;
};

/** El punto de la agenda desde el que sigue la página siguiente. */
export type AgendaPosition = { readonly startsAt: string; readonly id: string };

/** Todos los eventos del club, o sólo los que van a todo el club o a alguno
 * de estos grupos. */
export type EventVisibility =
  | { readonly kind: "club" }
  | { readonly kind: "audience"; readonly groupIds: readonly string[] };

export type AgendaQuery = {
  readonly clubId: string;
  readonly callerId: string;
  readonly visibility: EventVisibility;
  readonly period: AgendaPeriod;
  /** `YYYY-MM-DD` de Melbourne: los próximos empiezan este día, los pasados
   * terminan el anterior. */
  readonly today: string;
  /** Sólo los eventos de estos tipos, o nulo para todos (D8 de E24). */
  readonly eventTypes: readonly EventType[] | null;
  readonly after: AgendaPosition | null;
  readonly limit: number;
};

export type RsvpTally = {
  readonly eventId: string;
  readonly goingCount: number;
  readonly maybeCount: number;
};

export type Responder = {
  readonly fullName: string;
  readonly response: "yes" | "maybe";
};

export type EventAgendaGateway = {
  /** Los próximos por inicio ascendente, o los pasados por inicio
   * descendente, con el id como desempate en el mismo sentido. */
  findAgendaPage(query: AgendaQuery): Promise<readonly EventRow[]>;
  /** El evento, si es de ese club, con la respuesta de quien consulta. */
  findEvent(query: {
    readonly clubId: string;
    readonly callerId: string;
    readonly eventId: string;
  }): Promise<EventRow | null>;
  /** Una sola consulta para todos los eventos. Los que no tienen respuestas
   * que cuenten no vienen. */
  countResponses(eventIds: readonly string[]): Promise<readonly RsvpTally[]>;
  /** Quienes van o quizás y cuentan, con su nombre y nada más. */
  listResponders(eventId: string): Promise<readonly Responder[]>;
};

export type EventAgendaGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly memberGroups: MemberGroupsGateway;
  readonly agenda: EventAgendaGateway;
  readonly eventCovers: Pick<EventCoversGateway, "signUrls">;
};

export type AgendaEvent = {
  readonly id: string;
  readonly startsOn: string;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly endsOn: string | null;
  readonly title: string;
  readonly eventType: EventType;
  readonly location: string;
  readonly place: EventPlace | null;
  readonly placeDetail: string | null;
  readonly status: EventStatus;
  readonly seriesId: string | null;
  readonly goingCount: number;
  readonly maybeCount: number;
  readonly myResponse: RsvpResponse | null;
  /** Si quien consulta puede responder. Sólo es falso para quien organiza. */
  readonly inAudience: boolean;
  /** La miniatura firmada (#644); null sin imagen o fuera de la audiencia. */
  readonly coverThumbUrl: string | null;
};

/** `nextCursor` es nulo en la última página. Quien quiera la siguiente lo
 * devuelve tal cual: su contenido no es contrato. */
export type AgendaPage = {
  readonly events: readonly AgendaEvent[];
  readonly nextCursor: string | null;
};

export type MemberEventDetail = AgendaEvent & {
  /** La grande firmada (#644), con la misma regla que la miniatura. */
  readonly coverUrl: string | null;
  readonly notes: string | null;
  readonly going: readonly string[];
  readonly maybe: readonly string[];
};

/** Lo que ve quien organiza: además, a quién va dirigido (RF-8). */
export type OrganizerEventDetail = MemberEventDetail & {
  readonly audience: NamedEventAudience;
};

export type EventDetail = MemberEventDetail | OrganizerEventDetail;

export class InvalidAgendaCursorError extends Error {
  constructor() {
    super("El cursor no corresponde a ninguna página de la agenda.");
    this.name = "InvalidAgendaCursorError";
  }
}

const positionSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

function encodeCursor(position: AgendaPosition): string {
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

function decodeCursor(cursor: string): AgendaPosition {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return positionSchema.parse(json);
  } catch {
    // Un cursor inventado o recortado es una petición mal hecha, no un fallo
    // del servidor: el porqué exacto no le sirve a quien lo mandó.
    throw new InvalidAgendaCursorError();
  }
}

const AGENDA_TYPES_SEPARATOR = ",";

/** Los tipos de `?types=training,social`, sin repetir. Lo desconocido se
 * ignora en vez de rechazarse, para que un cliente viejo frente a un tipo
 * retirado siga viendo su agenda; si no queda ninguno, son todos (nulo). */
export function readAgendaTypes(
  value: string | null,
): readonly EventType[] | null {
  const types = new Set(
    (value ?? "").split(AGENDA_TYPES_SEPARATOR).filter(isEventType),
  );
  return types.size === 0 ? null : [...types];
}

/** Admin y Committee, los que crean y gestionan eventos. */
function seesWholeCalendar(role: Role): boolean {
  return hasCapability(role, "createEvents");
}

/** Qué parte del calendario alcanza a quien consulta. La búsqueda (#425)
 * la comparte con la agenda para que las dos vean lo mismo (D3 de E14). */
export function eventVisibilityFor(
  role: Role,
  groupIds: readonly string[],
): EventVisibility {
  return seesWholeCalendar(role)
    ? { kind: "club" }
    : { kind: "audience", groupIds };
}

type Viewer = {
  readonly clubId: string;
  readonly role: Role;
  readonly groupIds: readonly string[];
};

async function findViewer(
  gateways: EventAgendaGateways,
  callerId: string,
): Promise<Viewer> {
  const [caller, groups] = await Promise.all([
    gateways.members.findRoleRequestMember(callerId),
    gateways.memberGroups.listGroupsOf(callerId),
  ]);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  return {
    clubId: caller.clubId,
    role: caller.role,
    groupIds: groups.map((group) => group.id),
  };
}

function reachesViewer(row: EventRow, viewer: Viewer): boolean {
  const audience =
    row.audience.kind === "club"
      ? row.audience
      : {
          kind: "groups" as const,
          groupIds: row.audience.groups.map((group) => group.id),
        };
  return isInAudience(audience, viewer.groupIds);
}

/** Lo que la agenda añade a la fila: los conteos, si quien consulta es la
 * audiencia y su miniatura. */
type AgendaView = {
  readonly goingCount: number;
  readonly maybeCount: number;
  readonly inAudience: boolean;
  readonly coverThumbUrl: string | null;
};

function toAgendaEvent(row: EventRow, view: AgendaView): AgendaEvent {
  return {
    id: row.id,
    startsOn: row.startsOn,
    startTime: row.startTime,
    endTime: row.endTime,
    endsOn: row.endsOn,
    title: row.title,
    eventType: row.eventType,
    location: row.location,
    place: row.place,
    placeDetail: row.placeDetail,
    status: row.status,
    seriesId: row.seriesId,
    goingCount: view.goingCount,
    maybeCount: view.maybeCount,
    myResponse: row.myResponse,
    inAudience: view.inAudience,
    coverThumbUrl: view.coverThumbUrl,
  };
}

/** La imagen que se le puede firmar a quien consulta: sólo si el evento la
 * tiene y quien consulta es su audiencia (D7). Quien organiza ve el evento
 * aunque no sea para él, pero no su imagen. */
function signableCoverOf(row: EventRow, viewer: Viewer): EventCoverRef | null {
  if (row.coverUploadId === null || !reachesViewer(row, viewer)) {
    return null;
  }
  return { id: row.coverUploadId, clubId: viewer.clubId };
}

/** Las miniaturas de la página, por id de imagen, en una sola llamada. */
function signPageCovers(
  gateways: EventAgendaGateways,
  viewer: Viewer,
  rows: readonly EventRow[],
): Promise<ReadonlyMap<string, string>> {
  return signEventCoverThumbnails(
    gateways.eventCovers,
    rows.flatMap((row) => signableCoverOf(row, viewer) ?? []),
  );
}

function thumbnailOf(
  row: EventRow,
  viewer: Viewer,
  thumbnails: ReadonlyMap<string, string>,
): string | null {
  const cover = signableCoverOf(row, viewer);
  return cover === null ? null : (thumbnails.get(cover.id) ?? null);
}

const NO_RESPONSES = { goingCount: 0, maybeCount: 0 } as const;

async function countPage(
  gateways: EventAgendaGateways,
  rows: readonly EventRow[],
): Promise<ReadonlyMap<string, RsvpTally>> {
  if (rows.length === 0) {
    return new Map();
  }
  const tallies = await gateways.agenda.countResponses(
    rows.map((row) => row.id),
  );
  return new Map(tallies.map((tally) => [tally.eventId, tally]));
}

/** Una página de la agenda de quien llama. Se pide una fila de más para
 * saber, sin contar, si hay página siguiente. */
export async function listAgenda(
  gateways: EventAgendaGateways,
  request: {
    readonly callerId: string;
    readonly period: AgendaPeriod;
    readonly now: Date;
    readonly cursor?: string;
    /** Sin tipos, o con la lista vacía, son todos. La página siguiente se
     * pide con los mismos: el cursor no los recuerda. */
    readonly eventTypes?: readonly EventType[];
  },
): Promise<AgendaPage> {
  const after =
    request.cursor === undefined ? null : decodeCursor(request.cursor);
  const viewer = await findViewer(gateways, request.callerId);
  const eventTypes = request.eventTypes ?? [];
  const rows = await gateways.agenda.findAgendaPage({
    clubId: viewer.clubId,
    callerId: request.callerId,
    visibility: eventVisibilityFor(viewer.role, viewer.groupIds),
    period: request.period,
    today: clubCalendarDate(request.now),
    eventTypes: eventTypes.length === 0 ? null : eventTypes,
    after,
    limit: AGENDA_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, AGENDA_PAGE_SIZE);
  const [tallies, thumbnails] = await Promise.all([
    countPage(gateways, page),
    signPageCovers(gateways, viewer, page),
  ]);
  const last = page.at(-1);
  const hasMore = rows.length > AGENDA_PAGE_SIZE && last !== undefined;
  return {
    events: page.map((row) =>
      toAgendaEvent(row, {
        ...(tallies.get(row.id) ?? NO_RESPONSES),
        inAudience: reachesViewer(row, viewer),
        coverThumbUrl: thumbnailOf(row, viewer, thumbnails),
      }),
    ),
    nextCursor: hasMore
      ? encodeCursor({ startsAt: last.startsAt, id: last.id })
      : null,
  };
}

function namesWith(
  responders: readonly Responder[],
  response: Responder["response"],
): readonly string[] {
  return responders
    .filter((responder) => responder.response === response)
    .map((responder) => responder.fullName)
    .sort((first, second) => first.localeCompare(second));
}

async function signDetailCover(
  gateways: EventAgendaGateways,
  row: EventRow,
  viewer: Viewer,
): Promise<EventCoverUrls> {
  const cover = signableCoverOf(row, viewer);
  return cover === null
    ? NO_EVENT_COVER_URLS
    : signEventCover(gateways.eventCovers, cover);
}

/** Un evento abierto: lo de la agenda más las notas y quién va. Quien no lo
 * puede ver recibe lo mismo que con uno que no existe. */
export async function openEvent(
  gateways: EventAgendaGateways,
  request: { readonly callerId: string; readonly eventId: string },
): Promise<EventDetail> {
  const viewer = await findViewer(gateways, request.callerId);
  const row = await gateways.agenda.findEvent({
    clubId: viewer.clubId,
    callerId: request.callerId,
    eventId: request.eventId,
  });
  if (row === null) {
    throw new EventNotFoundError();
  }
  const inAudience = reachesViewer(row, viewer);
  const isOrganizer = seesWholeCalendar(viewer.role);
  if (!inAudience && !isOrganizer) {
    throw new EventNotFoundError();
  }
  const [responders, cover] = await Promise.all([
    gateways.agenda.listResponders(row.id),
    signDetailCover(gateways, row, viewer),
  ]);
  const going = namesWith(responders, "yes");
  const maybe = namesWith(responders, "maybe");
  const detail: MemberEventDetail = {
    ...toAgendaEvent(row, {
      goingCount: going.length,
      maybeCount: maybe.length,
      inAudience,
      coverThumbUrl: cover.coverThumbUrl,
    }),
    coverUrl: cover.coverUrl,
    notes: row.notes,
    going,
    maybe,
  };
  return isOrganizer ? { ...detail, audience: row.audience } : detail;
}
