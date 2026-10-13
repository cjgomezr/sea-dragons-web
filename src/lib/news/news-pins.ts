import {
  type AuditAction,
  type AuditActor,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import { readNewsPinUntil } from "./news-pin-rule";
import {
  type NewsGateways,
  type NewsPostDetail,
  type NewsPostStatus,
  type NewsUnpinned,
  NewsPostNotFoundError,
  canPinNewsPosts,
  describeNewsPost,
  findNewsReader,
} from "./news-posts";

/**
 * Fijar y desfijar una publicación (#592, RF-3 del PRD de E22), contado sin
 * Supabase delante.
 *
 * Solo el Admin fija (D1) y solo cabe una por club: fijar otra quita la
 * anterior en la misma transacción, dentro de la base, que además vuelve a
 * comprobar que quien llama es Admin. Aquí se comprueba antes para responder
 * 403 sin tocar nada, y la fecha de fin se valida antes de escribir.
 */

/** En la bitácora la entidad es la publicación: "sobre cuál". */
const AUDITED_ENTITY_TYPE = "news_post";

/** Lo que publicar o editar hace con el fijado: dejarlo como está, fijar
 * hasta `until` (nula: sin fecha de fin) o desfijar. Tres casos y no un
 * campo opcional, para que "no lo toques" y "desfíjala" no se confundan. */
export type NewsPinChange =
  | { readonly kind: "keep" }
  | { readonly kind: "pin"; readonly until: string | null }
  | { readonly kind: "unpin" };

export class NewsPinForbiddenError extends Error {
  constructor() {
    super("Solo un Admin puede fijar o desfijar publicaciones.");
    this.name = "NewsPinForbiddenError";
  }
}

export class NewsPinWithdrawnPostError extends Error {
  constructor() {
    super("Una publicación retirada no se puede fijar.");
    this.name = "NewsPinWithdrawnPostError";
  }
}

type PinRequest = {
  readonly callerId: string;
  readonly postId: string;
  readonly now: Date;
};

/**
 * El cambio de fijado listo para guardar, o el motivo por el que no vale.
 * No escribe nada: publicar y editar lo comprueban antes de guardar la
 * publicación, para que un Committee que manda `pin` no deje nada a medias.
 */
export function authorizeNewsPinChange(
  change: NewsPinChange,
  context: {
    readonly role: Role;
    readonly now: Date;
    /** El de la publicación antes de guardar: una retirada no se fija. */
    readonly postStatus: NewsPostStatus;
  },
): NewsPinChange {
  if (change.kind === "keep") {
    return change;
  }
  if (!canPinNewsPosts(context.role)) {
    throw new NewsPinForbiddenError();
  }
  if (change.kind === "unpin") {
    return change;
  }
  if (context.postStatus === "withdrawn") {
    throw new NewsPinWithdrawnPostError();
  }
  return { kind: "pin", until: readNewsPinUntil(change.until, context.now) };
}

/** Quien llama, si es Admin. */
async function findPinner(
  gateways: NewsGateways,
  callerId: string,
): Promise<AuditActor> {
  const caller = await findNewsReader(gateways, callerId);
  if (!canPinNewsPosts(caller.role)) {
    throw new NewsPinForbiddenError();
  }
  return { id: callerId, clubId: caller.clubId };
}

function recordPinEvent(
  gateways: NewsGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly pin: NewsUnpinned;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: AUDITED_ENTITY_TYPE,
    entityId: event.pin.postId,
    result: "success",
    metadata: { until: event.pin.pinnedUntil },
  });
}

/** Fija y deja en la bitácora la que quitó, si había, y la nueva. */
async function savePin(
  gateways: NewsGateways,
  actor: AuditActor,
  pin: NewsUnpinned,
): Promise<void> {
  const outcome = await gateways.posts.pinPost({
    clubId: actor.clubId,
    actingUserId: actor.id,
    postId: pin.postId,
    until: pin.pinnedUntil,
  });
  if (outcome.kind === "forbidden") {
    throw new NewsPinForbiddenError();
  }
  if (outcome.kind === "not_found") {
    throw new NewsPostNotFoundError();
  }
  if (outcome.kind === "withdrawn") {
    throw new NewsPinWithdrawnPostError();
  }
  if (outcome.replaced !== null) {
    await recordPinEvent(gateways, {
      actor,
      action: "news_post.unpinned",
      pin: outcome.replaced,
    });
  }
  await recordPinEvent(gateways, { actor, action: "news_post.pinned", pin });
}

/** Desfijar la que no está fijada no es un error ni deja rastro. */
async function saveUnpin(
  gateways: NewsGateways,
  actor: AuditActor,
  postId: string,
): Promise<void> {
  const outcome = await gateways.posts.unpinPost({
    clubId: actor.clubId,
    actingUserId: actor.id,
    postId,
  });
  if (outcome.kind === "forbidden") {
    throw new NewsPinForbiddenError();
  }
  if (outcome.kind === "not_found") {
    throw new NewsPostNotFoundError();
  }
  if (outcome.kind === "not_pinned") {
    return;
  }
  await recordPinEvent(gateways, {
    actor,
    action: "news_post.unpinned",
    pin: { postId, pinnedUntil: outcome.pinnedUntil },
  });
}

/** Guarda un cambio que `authorizeNewsPinChange` ya dio por bueno. */
export async function applyNewsPinChange(
  gateways: NewsGateways,
  request: {
    readonly actor: AuditActor;
    readonly postId: string;
    readonly change: NewsPinChange;
  },
): Promise<void> {
  const { actor, postId, change } = request;
  if (change.kind === "pin") {
    await savePin(gateways, actor, { postId, pinnedUntil: change.until });
  }
  if (change.kind === "unpin") {
    await saveUnpin(gateways, actor, postId);
  }
}

/** La publicación fijada como la vería el Admin que la fijó: puede
 * gestionarla y fijarla. */
async function readPinnedDetail(
  gateways: NewsGateways,
  actor: AuditActor,
  request: PinRequest,
): Promise<NewsPostDetail> {
  const post = await gateways.posts.findPost({
    clubId: actor.clubId,
    postId: request.postId,
  });
  if (post === null) {
    throw new Error(
      `La publicación ${request.postId} no aparece justo después de fijarla.`,
    );
  }
  return describeNewsPost(gateways, post, {
    access: { canManage: true, canPin: true },
    now: request.now,
    readerGroupIds: [],
  });
}

/** Fija hasta `until` (nula: hasta que la desfije) y responde la publicación
 * con su estado. */
export async function pinNewsPost(
  gateways: NewsGateways,
  request: PinRequest & { readonly until: string | null },
): Promise<NewsPostDetail> {
  const actor = await findPinner(gateways, request.callerId);
  const until = readNewsPinUntil(request.until, request.now);
  await savePin(gateways, actor, {
    postId: request.postId,
    pinnedUntil: until,
  });
  return readPinnedDetail(gateways, actor, request);
}

export async function unpinNewsPost(
  gateways: NewsGateways,
  request: Omit<PinRequest, "now">,
): Promise<void> {
  const actor = await findPinner(gateways, request.callerId);
  await saveUnpin(gateways, actor, request.postId);
}
