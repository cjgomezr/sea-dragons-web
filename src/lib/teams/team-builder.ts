import type { AuditActor, AuditLogWriter } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import {
  type ClubPositionsGateway,
  type NamedPosition,
  findClubPosition,
} from "@/lib/club/club-positions";
import type { EventStatus } from "@/lib/events/event-agenda";
import type { EventAudience, EventType } from "@/lib/events/event-creation";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import { calculateOverallRating } from "@/lib/evaluations/overall-rating";
import type { NotificationBroadcastWriter } from "@/lib/notifications/notify-member";
import { compareNames } from "@/lib/text/name-order";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { autoBalanceTeams } from "./auto-balance";
import {
  type PositionCoverage,
  type SquadPlayer,
  type TeamSplit,
  UNRATED_PLAYER_RATING,
} from "./squad";
import { suggestSwap } from "./swap-suggestion";
import {
  BUILDABLE_EVENT_TYPES,
  TEAM_IDS,
  type TeamAssignment,
  type TeamId,
  type TeamLabels,
  type TeamSplitMode,
} from "./team-ids";
import { type SplitTotals, calculateSplitTotals } from "./team-totals";

/**
 * El team builder de Admin y Coach (#401, RF-3 a RF-5 del PRD de E10),
 * contado sin Supabase delante: la escuadra del evento, guardar el reparto a
 * mano y el auto-balance. Publicar vive en `team-publication.ts` y la vista
 * del jugador en `my-team.ts`.
 *
 * Sólo arman Admin y Coach (`buildTeamsAndTrackAttendance`). La frontera ya
 * lo decide por el camino; aquí se vuelve a comprobar. Quien arma no tiene
 * que estar en la audiencia: ve todos los eventos armables del club.
 *
 * La escuadra (D1) sale del RSVP vivo del evento, que la base ya recorta a la
 * audiencia activa (`live_event_rsvps`, `0039`): los "Sí" son la lista
 * disponible y los "Quizás" van aparte. Cada uno con su OVR de E9, o con el
 * 5,0 virtual y la marca de no evaluado (FR-086).
 */

export {
  BUILDABLE_EVENT_TYPES,
  TEAM_IDS,
  TEAM_SPLIT_MODES,
  type TeamAssignment,
  type TeamId,
  type TeamLabel,
  type TeamLabels,
  type TeamSplitMode,
} from "./team-ids";

/** D5: "Team Kelp" azul y "Team Tide" amarillo, los del mockup, con los
 * colores de acento y de aviso de `design-system.md`. */
export const DEFAULT_TEAM_LABELS: TeamLabels = {
  a: { name: "Team Kelp", color: "#1C6EA4" },
  b: { name: "Team Tide", color: "#C99A3E" },
};

/** Lo que hace falta de un evento para decidir si se arma y para avisar. */
export type TeamBuilderEvent = {
  readonly id: string;
  readonly clubId: string;
  readonly eventType: EventType;
  readonly title: string;
  readonly status: EventStatus;
  /** `YYYY-MM-DD` y `HH:MM` de Melbourne, como se guardaron. */
  readonly startsOn: string;
  readonly startTime: string;
  readonly audience: EventAudience;
};

/** Lo que hace falta de un evento para nombrarlo en el builder. */
export type TeamBuilderEventSummary = Pick<
  TeamBuilderEvent,
  "id" | "title" | "eventType" | "startsOn" | "startTime"
>;

/** Una respuesta que cuenta: de la audiencia activa y a un evento vivo. */
export type SquadResponse = {
  readonly userId: string;
  readonly response: "yes" | "maybe";
};

export type PlayerRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly positionId: string | null;
  /** La función de su posición (D4), o `null` sin posición o sin función. */
  readonly coverage: PositionCoverage | null;
  /** `null` sin evaluación; una lista vacía es una evaluación sin notas. */
  readonly ratings: readonly number[] | null;
};

export type StoredTeamSplit = {
  readonly teams: TeamLabels;
  readonly mode: TeamSplitMode;
  /** `null` mientras es borrador. */
  readonly publishedAt: Date | null;
  readonly assignments: readonly TeamAssignment[];
};

/** Lo que se manda a guardar: el reparto entero de un evento. */
export type NewTeamSplit = {
  readonly clubId: string;
  readonly eventId: string;
  readonly savedBy: string;
  readonly mode: TeamSplitMode;
  readonly teams: TeamLabels;
  readonly assignments: readonly TeamAssignment[];
};

/** Por qué la base no dejó escribir: vuelve a mirar el evento con la fila
 * bloqueada, porque pudo cambiar entre que el dominio lo leyó y lo escribe. */
export type TeamEventRejection =
  "not_found" | "not_buildable" | "cancelled" | "past";

export type TeamSplitSaveOutcome = "saved" | TeamEventRejection;

export type TeamSplitPublication =
  | {
      readonly kind: "published";
      readonly publishedAt: Date;
      readonly teams: TeamLabels;
      /** Lo avisado en la publicación anterior; vacío la primera vez. */
      readonly previous: readonly TeamAssignment[];
      readonly current: readonly TeamAssignment[];
    }
  | { readonly kind: "empty" }
  | { readonly kind: TeamEventRejection };

export type TeamSplitsGateway = {
  /** El evento, sea del tipo que sea, si es de ese club. */
  findEvent(query: {
    readonly clubId: string;
    readonly eventId: string;
  }): Promise<TeamBuilderEvent | null>;
  /** Los entrenamientos y competiciones no cancelados del club desde `today`
   * (`YYYY-MM-DD` de Melbourne), del más cercano al más lejano, hasta
   * `limit`. */
  findBuildableEvents(query: {
    readonly clubId: string;
    readonly today: string;
    readonly limit: number;
  }): Promise<readonly TeamBuilderEventSummary[]>;
  findLiveResponses(eventId: string): Promise<readonly SquadResponse[]>;
  /** Los miembros del club con esos ids, con su posición y sus notas, en
   * una consulta (NFR del PRD: nada de una por jugador). */
  findPlayers(query: {
    readonly clubId: string;
    readonly userIds: readonly string[];
  }): Promise<readonly PlayerRecord[]>;
  findSplit(eventId: string): Promise<StoredTeamSplit | null>;
  /** Sustituye el reparto entero y lo deja en borrador, todo o nada. */
  saveSplit(split: NewTeamSplit): Promise<TeamSplitSaveOutcome>;
  publishSplit(query: {
    readonly clubId: string;
    readonly eventId: string;
  }): Promise<TeamSplitPublication>;
};

export type TeamBuilderGateways = {
  readonly members: Pick<
    RoleRequestGateways["members"],
    "findRoleRequestMember"
  >;
  readonly teams: TeamSplitsGateway;
  readonly positions: ClubPositionsGateway;
  readonly notifications: NotificationBroadcastWriter;
  readonly audit: AuditLogWriter;
};

/** Un jugador tal como lo pinta el builder. `rating` es el OVR, o el 5,0
 * virtual con `isUnrated` (FR-086). */
export type SquadEntry = {
  readonly userId: string;
  readonly fullName: string;
  readonly position: NamedPosition | null;
  readonly coverage: PositionCoverage | null;
  readonly rating: number;
  readonly isUnrated: boolean;
};

/** Un asignado. Fuera de la escuadra si cambió su RSVP o salió de la
 * audiencia: sigue asignado hasta que el coach lo quite (RF-4). */
export type BuilderAssignment = SquadEntry & {
  readonly team: TeamId;
  readonly isOutsideSquad: boolean;
};

export type BuilderSplit = {
  readonly mode: TeamSplitMode;
  readonly publishedAt: string | null;
  readonly assignments: readonly BuilderAssignment[];
};

export type TeamBuilder = {
  readonly event: TeamBuilderEventSummary;
  /** Los del reparto guardado, o los de por defecto si no hay. */
  readonly teams: TeamLabels;
  readonly available: readonly SquadEntry[];
  readonly maybe: readonly SquadEntry[];
  readonly split: BuilderSplit | null;
};

export type SuggestedSwap = {
  readonly playerFromAId: string;
  readonly playerFromBId: string;
  readonly improvement: "coverage" | "rating-difference";
  readonly ratingDifferenceAfter: number;
};

export type AutoBalancedSplit = {
  readonly teams: TeamLabels;
  readonly mode: "auto";
  readonly a: readonly SquadEntry[];
  readonly b: readonly SquadEntry[];
  readonly totals: SplitTotals;
  readonly suggestion: SuggestedSwap | null;
  /** Se agotó el tiempo (NFR-002): es el mejor reparto alcanzado. */
  readonly isTimeBudgetExhausted: boolean;
};

export type SavedTeamSplit = {
  readonly eventId: string;
  readonly mode: TeamSplitMode;
  readonly assignedCount: number;
};

export class TeamBuilderForbiddenError extends Error {
  constructor() {
    super("Sólo Admin y Coach arman equipos.");
    this.name = "TeamBuilderForbiddenError";
  }
}

/** Van en `reason` del 422, para que la pantalla (#402) los traduzca (D2). */
export type TeamEventClosedCode =
  "team_event_not_buildable" | "team_event_cancelled" | "team_event_past";

const CLOSED_MESSAGES: Readonly<Record<TeamEventClosedCode, string>> = {
  team_event_not_buildable:
    "Sólo los entrenamientos y las competiciones llevan equipos.",
  team_event_cancelled:
    "El evento está cancelado: sus equipos ya no se editan.",
  team_event_past: "El evento ya pasó: sus equipos ya no se editan.",
};

export class TeamEventClosedError extends Error {
  readonly code: TeamEventClosedCode;

  constructor(code: TeamEventClosedCode) {
    super(CLOSED_MESSAGES[code]);
    this.name = "TeamEventClosedError";
    this.code = code;
  }
}

export const TEAM_PLAYER_OUTSIDE_SQUAD_REASON = "team_player_outside_squad";

export class TeamPlayerOutsideSquadError extends Error {
  constructor() {
    super(
      "El reparto trae a alguien que no respondió Sí o Quizás al evento o no es de su audiencia.",
    );
    this.name = "TeamPlayerOutsideSquadError";
  }
}

export const TEAM_SQUAD_EMPTY_REASON = "team_squad_empty";

export class TeamSquadEmptyError extends Error {
  constructor() {
    super("Nadie respondió Sí al evento: no hay a quién repartir.");
    this.name = "TeamSquadEmptyError";
  }
}

export const TEAM_SPLIT_EMPTY_REASON = "team_split_empty";

export class TeamSplitEmptyError extends Error {
  constructor() {
    super("El reparto no tiene a nadie asignado: no hay nada que publicar.");
    this.name = "TeamSplitEmptyError";
  }
}

/** El reparto no tiene la forma debida: un jugador repetido. */
export class TeamSplitInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamSplitInvalidError";
  }
}

export async function findTeamBuilderActor(
  gateways: Pick<TeamBuilderGateways, "members">,
  callerId: string,
): Promise<AuditActor> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "buildTeamsAndTrackAttendance")) {
    throw new TeamBuilderForbiddenError();
  }
  return { id: callerId, clubId: caller.clubId };
}

const REJECTION_CODES: Readonly<
  Record<Exclude<TeamEventRejection, "not_found">, TeamEventClosedCode>
> = {
  not_buildable: "team_event_not_buildable",
  cancelled: "team_event_cancelled",
  past: "team_event_past",
};

/** El 404 o el 422 que toca cuando la base no dejó escribir. */
export function rejectionError(rejection: TeamEventRejection): Error {
  return rejection === "not_found"
    ? new EventNotFoundError()
    : new TeamEventClosedError(REJECTION_CODES[rejection]);
}

function closedReason(
  event: TeamBuilderEvent,
  now: Date,
): TeamEventClosedCode | null {
  if (!BUILDABLE_EVENT_TYPES.includes(event.eventType)) {
    return "team_event_not_buildable";
  }
  if (event.status === "cancelled") {
    return "team_event_cancelled";
  }
  // Un evento de hoy se arma hasta que termina el día en Melbourne (D2).
  if (event.startsOn < clubCalendarDate(now)) {
    return "team_event_past";
  }
  return null;
}

/** El evento que se puede armar ahora, o por qué no. El club sale de la fila
 * de quien llama, nunca de la petición (NFR-009). */
export async function findBuildableEvent(
  gateways: Pick<TeamBuilderGateways, "teams">,
  request: {
    readonly clubId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<TeamBuilderEvent> {
  const event = await gateways.teams.findEvent(request);
  if (event === null) {
    throw new EventNotFoundError();
  }
  const reason = closedReason(event, request.now);
  if (reason !== null) {
    throw new TeamEventClosedError(reason);
  }
  return event;
}

export function positionOf(
  positions: Awaited<ReturnType<ClubPositionsGateway["findClubPositions"]>>,
  positionId: string | null,
): NamedPosition | null {
  if (positionId === null) {
    return null;
  }
  const { id, names } = findClubPosition(positions, positionId);
  return { id, names };
}

function distinctPositionIds(
  players: readonly PlayerRecord[],
): readonly string[] {
  return [
    ...new Set(
      players.flatMap((player) =>
        player.positionId === null ? [] : [player.positionId],
      ),
    ),
  ].sort();
}

/** Los jugadores con esos ids ya listos para pintar, por id. */
export async function readSquadEntries(
  gateways: {
    readonly teams: Pick<TeamSplitsGateway, "findPlayers">;
    readonly positions: ClubPositionsGateway;
  },
  query: { readonly clubId: string; readonly userIds: readonly string[] },
): Promise<ReadonlyMap<string, SquadEntry>> {
  if (query.userIds.length === 0) {
    return new Map();
  }
  const players = await gateways.teams.findPlayers(query);
  const positions = await gateways.positions.findClubPositions(
    query.clubId,
    distinctPositionIds(players),
  );
  return new Map(
    players.map((player) => {
      const overall =
        player.ratings === null ? null : calculateOverallRating(player.ratings);
      const entry: SquadEntry = {
        userId: player.userId,
        fullName: player.fullName,
        position: positionOf(positions, player.positionId),
        coverage: player.coverage,
        rating: overall ?? UNRATED_PLAYER_RATING,
        isUnrated: overall === null,
      };
      return [player.userId, entry];
    }),
  );
}

type Squad = {
  readonly available: readonly SquadEntry[];
  readonly maybe: readonly SquadEntry[];
  /** Todos los que se leyeron: la escuadra y los asignados que salieron. */
  readonly entries: ReadonlyMap<string, SquadEntry>;
};

function byName(first: SquadEntry, second: SquadEntry): number {
  return compareNames(first.fullName, second.fullName);
}

/** La escuadra del evento, más los asignados que ya no están en ella. */
async function readSquad(
  gateways: Pick<TeamBuilderGateways, "teams" | "positions">,
  event: TeamBuilderEvent,
  assignedIds: readonly string[] = [],
): Promise<Squad> {
  const responses = await gateways.teams.findLiveResponses(event.id);
  const entries = await readSquadEntries(gateways, {
    clubId: event.clubId,
    userIds: [
      ...new Set([...responses.map((row) => row.userId), ...assignedIds]),
    ],
  });
  const withResponse = (response: SquadResponse["response"]): SquadEntry[] =>
    responses
      .filter((row) => row.response === response)
      .flatMap((row) => entries.get(row.userId) ?? [])
      .sort(byName);
  return {
    available: withResponse("yes"),
    maybe: withResponse("maybe"),
    entries,
  };
}

function toBuilderSplit(split: StoredTeamSplit, squad: Squad): BuilderSplit {
  const squadIds = new Set(
    [...squad.available, ...squad.maybe].map((entry) => entry.userId),
  );
  return {
    mode: split.mode,
    publishedAt: split.publishedAt?.toISOString() ?? null,
    assignments: split.assignments
      .flatMap((assignment) => {
        const entry = squad.entries.get(assignment.userId);
        return entry === undefined
          ? []
          : [
              {
                ...entry,
                team: assignment.team,
                isOutsideSquad: !squadIds.has(assignment.userId),
              },
            ];
      })
      .sort(byName),
  };
}

/** El builder de un evento armable: la escuadra y el reparto actual (RF-3). */
export async function openTeamBuilder(
  gateways: TeamBuilderGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<TeamBuilder> {
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  const event = await findBuildableEvent(gateways, {
    ...request,
    clubId: actor.clubId,
  });
  const split = await gateways.teams.findSplit(event.id);
  const squad = await readSquad(
    gateways,
    event,
    split?.assignments.map((assignment) => assignment.userId),
  );
  return {
    event: {
      id: event.id,
      title: event.title,
      eventType: event.eventType,
      startsOn: event.startsOn,
      startTime: event.startTime,
    },
    teams: split?.teams ?? DEFAULT_TEAM_LABELS,
    available: squad.available,
    maybe: squad.maybe,
    split: split === null ? null : toBuilderSplit(split, squad),
  };
}

function assertWellFormedSplit(assignments: readonly TeamAssignment[]): void {
  const userIds = new Set(assignments.map((assignment) => assignment.userId));
  if (userIds.size !== assignments.length) {
    throw new TeamSplitInvalidError(
      "El reparto trae a un jugador más de una vez.",
    );
  }
}

/** Vale también para quien ya estaba asignado y salió de la escuadra: el
 * PRD (RF-4) quiere que guardar con él dentro responda 422, para que el coach
 * decida qué hacer con quien ya no viene antes de seguir.
 *
 * Se comprueba antes de bloquear el evento: quien cambia su RSVP justo
 * entretanto queda asignado y marcado fuera, como si lo hubiera cambiado
 * después. La clave compuesta de `0046` impide a cualquiera de otro club. */
function assertPlayersInSquad(
  squad: Squad,
  assignments: readonly TeamAssignment[],
): void {
  const squadIds = new Set(
    [...squad.available, ...squad.maybe].map((entry) => entry.userId),
  );
  if (assignments.some((assignment) => !squadIds.has(assignment.userId))) {
    throw new TeamPlayerOutsideSquadError();
  }
}

async function writeSplit(
  gateways: TeamBuilderGateways,
  split: NewTeamSplit,
): Promise<void> {
  const outcome = await gateways.teams.saveSplit(split);
  if (outcome !== "saved") {
    throw rejectionError(outcome);
  }
}

/** Guarda el reparto a mano (RF-4): en borrador, modo `manual`, sin avisar a
 * nadie (D6). Guardar otra vez lo reemplaza entero. */
export async function saveTeamSplit(
  gateways: TeamBuilderGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly teams: TeamLabels;
    readonly assignments: readonly TeamAssignment[];
    readonly now: Date;
  },
): Promise<SavedTeamSplit> {
  assertWellFormedSplit(request.assignments);
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  const event = await findBuildableEvent(gateways, {
    ...request,
    clubId: actor.clubId,
  });
  assertPlayersInSquad(await readSquad(gateways, event), request.assignments);
  await writeSplit(gateways, {
    clubId: actor.clubId,
    eventId: event.id,
    savedBy: actor.id,
    mode: "manual",
    teams: request.teams,
    assignments: request.assignments,
  });
  return {
    eventId: event.id,
    mode: "manual",
    assignedCount: request.assignments.length,
  };
}

function toSquadPlayer(entry: SquadEntry): SquadPlayer {
  return {
    userId: entry.userId,
    fullName: entry.fullName,
    rating: entry.isUnrated ? null : entry.rating,
    coverage: entry.coverage,
  };
}

function toSuggestedSwap(split: TeamSplit): SuggestedSwap | null {
  const swap = suggestSwap(split);
  return swap === null
    ? null
    : {
        playerFromAId: swap.playerFromA.userId,
        playerFromBId: swap.playerFromB.userId,
        improvement: swap.improvement,
        ratingDifferenceAfter: swap.ratingDifferenceAfter,
      };
}

function assignmentsOf(split: TeamSplit): readonly TeamAssignment[] {
  return TEAM_IDS.flatMap((team) =>
    split[team].map((player) => ({ userId: player.userId, team })),
  );
}

function entriesOf(
  squad: Squad,
  players: readonly SquadPlayer[],
): readonly SquadEntry[] {
  return players.flatMap((player) => squad.entries.get(player.userId) ?? []);
}

/** El auto-balance en el servidor (RF-5): reparte los "Sí" con el algoritmo
 * de C2 y guarda el resultado en borrador con modo `auto`. Conserva los
 * nombres y colores del reparto que hubiera. */
export async function autoBalanceEventTeams(
  gateways: TeamBuilderGateways,
  request: {
    readonly callerId: string;
    readonly eventId: string;
    readonly now: Date;
  },
): Promise<AutoBalancedSplit> {
  const actor = await findTeamBuilderActor(gateways, request.callerId);
  const event = await findBuildableEvent(gateways, {
    ...request,
    clubId: actor.clubId,
  });
  const [squad, stored] = await Promise.all([
    readSquad(gateways, event),
    gateways.teams.findSplit(event.id),
  ]);
  if (squad.available.length === 0) {
    throw new TeamSquadEmptyError();
  }
  const balanced = autoBalanceTeams(squad.available.map(toSquadPlayer));
  const teams = stored?.teams ?? DEFAULT_TEAM_LABELS;
  await writeSplit(gateways, {
    clubId: actor.clubId,
    eventId: event.id,
    savedBy: actor.id,
    mode: "auto",
    teams,
    assignments: assignmentsOf(balanced),
  });
  return {
    teams,
    mode: "auto",
    a: entriesOf(squad, balanced.a),
    b: entriesOf(squad, balanced.b),
    totals: calculateSplitTotals(balanced),
    suggestion: toSuggestedSwap(balanced),
    isTimeBudgetExhausted: balanced.isTimeBudgetExhausted,
  };
}
