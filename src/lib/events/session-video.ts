import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";
import type { EventAudience } from "./event-creation";
import {
  type EventNoticeGateways,
  notifyEventAudience,
} from "./event-creation-notice";
import { EventNotFoundError, isInAudience } from "./event-rsvp";
import {
  type SessionVideoUrlIssue,
  parseSessionVideoUrl,
} from "./session-video-url";

/**
 * El vídeo de YouTube de una sesión (#965, RF-4 y D8 del PRD de E37),
 * contado sin Supabase delante.
 *
 * Lo ponen y lo quitan Admin, Committee y Coach (`postSessionVideos`). Admin
 * y Committee ven todos los eventos del club; un Coach, sólo los de su
 * audiencia, y uno que no le corresponde no existe para él, igual que en la
 * agenda (AC-052). Un evento cancelado no recibe vídeo nuevo, pero el que ya
 * tenía se puede quitar.
 *
 * Cuando una sesión pasa de no tener vídeo a tenerlo, su audiencia recibe un
 * aviso (#966, RF-6, D9 y D10). Cambiar el enlace no avisa: casi siempre es
 * corregirlo. Si estaba vacío lo dice la misma escritura, no una lectura
 * previa: dos personas que ponen vídeo a la vez dan un solo aviso.
 */

export type SessionVideoEvent = {
  readonly id: string;
  readonly status: "scheduled" | "cancelled";
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly startsOn: string;
  /** `HH:MM`. */
  readonly startTime: string;
  readonly audience: EventAudience;
};

/** `added` si la sesión no tenía vídeo al escribir, `replaced` si ya tenía. */
export type SessionVideoSave = "added" | "replaced";

type EventQuery = { readonly clubId: string; readonly eventId: string };

export type SessionVideosGateway = {
  /** El evento, si es de ese club. */
  findEvent(query: EventQuery): Promise<SessionVideoEvent | null>;
  /** Decide si estaba vacío en la misma sentencia que escribe. */
  saveVideo(
    video: EventQuery & { readonly url: string },
  ): Promise<SessionVideoSave>;
  /** No falla si no tenía. */
  removeVideo(query: EventQuery): Promise<void>;
};

export type SessionVideoGateways = EventNoticeGateways & {
  readonly members: RoleRequestGateways["members"];
  readonly memberGroups: MemberGroupsGateway;
  readonly sessionVideos: SessionVideosGateway;
};

export type SessionVideo = {
  readonly eventId: string;
  readonly url: string;
};

export class SessionVideoForbiddenError extends Error {
  constructor() {
    super("Sólo Admin, Committee y Coach ponen el vídeo de una sesión.");
    this.name = "SessionVideoForbiddenError";
  }
}

export class InvalidSessionVideoUrlError extends Error {
  readonly issue: SessionVideoUrlIssue;

  constructor(issue: SessionVideoUrlIssue) {
    super(
      issue === "too_long"
        ? "El enlace del vídeo es demasiado largo."
        : "El enlace no es el de un vídeo de YouTube.",
    );
    this.name = "InvalidSessionVideoUrlError";
    this.issue = issue;
  }
}

export class SessionVideoEventCancelledError extends Error {
  readonly code = "video_event_cancelled";

  constructor() {
    super("El evento está cancelado: no se le puede poner vídeo.");
    this.name = "SessionVideoEventCancelledError";
  }
}

type VideoRequest = {
  readonly callerId: string;
  readonly eventId: string;
};

async function findPoster(
  gateways: SessionVideoGateways,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  if (!hasCapability(caller.role, "postSessionVideos")) {
    throw new SessionVideoForbiddenError();
  }
  return caller;
}

/** El evento, si quien llama lo ve: todos para quien organiza, los de su
 * audiencia para un Coach. El club sale de su ficha, nunca de la petición
 * (NFR-009). */
async function findVisibleEvent(
  gateways: SessionVideoGateways,
  caller: RoleRequestMember,
  request: VideoRequest,
): Promise<SessionVideoEvent> {
  const [event, groups] = await Promise.all([
    gateways.sessionVideos.findEvent({
      clubId: caller.clubId,
      eventId: request.eventId,
    }),
    gateways.memberGroups.listGroupsOf(request.callerId),
  ]);
  const groupIds = groups.map((group) => group.id);
  const seesWholeCalendar = hasCapability(caller.role, "createEvents");
  if (
    event === null ||
    (!seesWholeCalendar && !isInAudience(event.audience, groupIds))
  ) {
    throw new EventNotFoundError();
  }
  return event;
}

/** No lanza: el vídeo ya está guardado (`notifyEventAudience`). */
function announceVideo(
  gateways: SessionVideoGateways,
  announcement: {
    readonly caller: RoleRequestMember;
    readonly callerId: string;
    readonly event: SessionVideoEvent;
  },
): Promise<void> {
  const { caller, callerId, event } = announcement;
  return notifyEventAudience(gateways, {
    clubId: caller.clubId,
    authorId: callerId,
    audience: event.audience,
    content: {
      type: "event_video_added",
      data: {
        eventId: event.id,
        title: event.title,
        startsOn: event.startsOn,
        startTime: event.startTime,
      },
    },
  });
}

/** Pone o cambia el vídeo de una sola sesión, o dice por qué no. */
export async function setSessionVideo(
  gateways: SessionVideoGateways,
  request: VideoRequest & { readonly url: string },
): Promise<SessionVideo> {
  const caller = await findPoster(gateways, request.callerId);
  const parsed = parseSessionVideoUrl(request.url);
  if (parsed.kind === "invalid") {
    throw new InvalidSessionVideoUrlError(parsed.issue);
  }
  const event = await findVisibleEvent(gateways, caller, request);
  if (event.status === "cancelled") {
    throw new SessionVideoEventCancelledError();
  }
  const saved = await gateways.sessionVideos.saveVideo({
    clubId: caller.clubId,
    eventId: event.id,
    url: parsed.url,
  });
  if (saved === "added") {
    await announceVideo(gateways, {
      caller,
      callerId: request.callerId,
      event,
    });
  }
  return { eventId: event.id, url: parsed.url };
}

/** Quita el vídeo de una sesión, aunque no tuviera o esté cancelada. */
export async function removeSessionVideo(
  gateways: SessionVideoGateways,
  request: VideoRequest,
): Promise<void> {
  const caller = await findPoster(gateways, request.callerId);
  const event = await findVisibleEvent(gateways, caller, request);
  await gateways.sessionVideos.removeVideo({
    clubId: caller.clubId,
    eventId: event.id,
  });
}
