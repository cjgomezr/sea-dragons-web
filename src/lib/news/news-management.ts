import {
  type AuditAction,
  type AuditActor,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  type NewsAudience,
  type NewsCategory,
  type NewsDraft,
  type NewsGateways,
  type NewsPost,
  type NewsPostDetail,
  type NewsPostStatus,
  NewsPostNotFoundError,
  canManageNewsPost,
  findNewsPublisher,
  normalizeNewsDraft,
  toNewsPostDetail,
} from "./news-posts";

/**
 * Editar, retirar y volver a publicar (#331, RF-6 del PRD de E11), contado
 * sin Supabase delante.
 *
 * Retirar oculta y no borra (decisión D1): cambia el estado, y la policy y el
 * feed dejan de servirla. Ni editar ni volver a publicar avisan a nadie
 * (decisión D2): aquí no hay ningún camino hacia la campana.
 *
 * Guardar una edición sigue el patrón de la ficha del miembro
 * (`member_status_changed`): la escritura lleva la marca de editada que se
 * tenía delante y sólo se aplica si la base sigue en ella. No hace falta una
 * columna de versión: cada edición cambia la marca, y retirar no edita.
 */

/** En la bitácora la entidad es la publicación: "sobre cuál". */
const AUDITED_ENTITY_TYPE = "news_post";

const STATUS_ACTIONS: Readonly<Record<NewsPostStatus, AuditAction>> = {
  withdrawn: "news_post.withdrawn",
  published: "news_post.republished",
};

/** Lo que carga el formulario de editar: la audiencia entera, que la
 * publicación abierta no enseña, y la marca de editada, que es la versión
 * contra la que se guarda. */
export type EditableNewsPost = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly audience: NewsAudience;
  readonly editedAt: string | null;
  readonly status: NewsPostStatus;
};

type PostRequest = { readonly callerId: string; readonly postId: string };

export class NewsPostNotYoursError extends Error {
  constructor() {
    super("Sólo un Admin o quien la publicó pueden editarla o retirarla.");
    this.name = "NewsPostNotYoursError";
  }
}

export class NewsPostChangedError extends Error {
  constructor() {
    super(
      "Alguien guardó esta publicación mientras la editabas: vuelve a abrirla.",
    );
    this.name = "NewsPostChangedError";
  }
}

type ManagedPost = { readonly actor: AuditActor; readonly post: NewsPost };

/** Quien llama y la publicación, si puede editarla. Una de otro club responde
 * como una que no existe. Una ajena del club sí dice que es ajena: quien la
 * pide es Admin o Committee, y para ellos el feed ya no guarda secretos. */
async function findManagedPost(
  gateways: NewsGateways,
  request: PostRequest,
): Promise<ManagedPost> {
  const caller = await findNewsPublisher(gateways, request.callerId);
  const post = await gateways.posts.findPost({
    clubId: caller.clubId,
    postId: request.postId,
  });
  if (post === null) {
    throw new NewsPostNotFoundError();
  }
  if (!canManageNewsPost({ id: request.callerId, role: caller.role }, post)) {
    throw new NewsPostNotYoursError();
  }
  return { actor: { id: request.callerId, clubId: caller.clubId }, post };
}

/** Sin metadata: ni el título ni el cuerpo (NFR-010). */
function recordNewsPostEvent(
  gateways: NewsGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly postId: string;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: AUDITED_ENTITY_TYPE,
    entityId: event.postId,
    result: "success",
  });
}

/** La publicación tal como quedó, para quien acaba de tocarla. */
async function readManagedDetail(
  gateways: NewsGateways,
  actor: AuditActor,
  postId: string,
): Promise<NewsPostDetail> {
  const post = await gateways.posts.findPost({ clubId: actor.clubId, postId });
  if (post === null) {
    throw new Error(
      `La publicación ${postId} no aparece justo después de guardarla.`,
    );
  }
  return toNewsPostDetail(post, true);
}

export async function readEditableNewsPost(
  gateways: NewsGateways,
  request: PostRequest,
): Promise<EditableNewsPost> {
  const { post } = await findManagedPost(gateways, request);
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    body: post.body,
    audience: post.audience,
    editedAt: post.editedAt,
    status: post.status,
  };
}

/** Valida después de saber quién pide y antes de escribir nada, con las
 * mismas reglas que publicar. La bitácora va después: antes dejaría rastro de
 * una edición que no se guardó. */
export async function editNewsPost(
  gateways: NewsGateways,
  request: PostRequest & {
    readonly draft: NewsDraft;
    readonly expectedEditedAt: string | null;
    readonly now: Date;
  },
): Promise<NewsPostDetail> {
  const { actor } = await findManagedPost(gateways, request);
  const draft = await normalizeNewsDraft(gateways, actor.clubId, request.draft);
  const update = await gateways.posts.updatePost({
    ...draft,
    postId: request.postId,
    clubId: actor.clubId,
    expectedEditedAt: request.expectedEditedAt,
    editedAt: request.now.toISOString(),
  });
  if (update.kind === "changed") {
    throw new NewsPostChangedError();
  }
  await recordNewsPostEvent(gateways, {
    actor,
    action: "news_post.edited",
    postId: request.postId,
  });
  return readManagedDetail(gateways, actor, request.postId);
}

/** Retirar o volver a publicar. Pedir el estado que ya tiene no escribe
 * nada, ni en la bitácora: no pasó nada que contar. */
export async function changeNewsPostStatus(
  gateways: NewsGateways,
  request: PostRequest & { readonly status: NewsPostStatus },
): Promise<NewsPostDetail> {
  const { actor, post } = await findManagedPost(gateways, request);
  if (post.status === request.status) {
    return toNewsPostDetail(post, true);
  }
  await gateways.posts.setPostStatus({
    clubId: actor.clubId,
    postId: request.postId,
    status: request.status,
  });
  await recordNewsPostEvent(gateways, {
    actor,
    action: STATUS_ACTIONS[request.status],
    postId: request.postId,
  });
  return readManagedDetail(gateways, actor, request.postId);
}
