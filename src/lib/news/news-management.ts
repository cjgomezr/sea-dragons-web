import {
  type AuditAction,
  type AuditActor,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  type NewsPinChange,
  applyNewsPinChange,
  authorizeNewsPinChange,
} from "./news-pins";
import {
  type NewsAudience,
  type NewsCategory,
  type NewsCoverChange,
  type NewsDraft,
  type NewsGateways,
  type NewsPost,
  type NewsPostDetail,
  type NewsPostStatus,
  type NewsPostView,
  NewsPostNotFoundError,
  canManageNewsPost,
  canPinNewsPosts,
  describeNewsPost,
  findNewsPublisher,
  normalizeNewsDraft,
} from "./news-posts";
import { resolveNewsCoverUpload } from "./news-cover-uploads";
import { discardNewsCover, sweepStaleNewsCovers } from "./news-covers";

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
 * publicación abierta no enseña, la marca de editada, que es la versión
 * contra la que se guarda, y la portada que tiene (#591). */
export type EditableNewsPost = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly audience: NewsAudience;
  readonly editedAt: string | null;
  readonly status: NewsPostStatus;
  readonly coverUploadId: string | null;
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

type ManagedPost = {
  readonly actor: AuditActor;
  readonly role: Role;
  readonly post: NewsPost;
};

/** Quien llama y la publicación, si puede editarla. Una de otro club responde
 * como una que no existe. Una ajena del club responde 403, como pide el
 * ticket: quien la pide ya es Admin o Committee, y los ids son uuid, así que
 * saber que existe no le sirve para recorrerlas. */
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
  return {
    actor: { id: request.callerId, clubId: caller.clubId },
    role: caller.role,
    post,
  };
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

/** Cómo ve la publicación quien la gestiona: puede editarla y retirarla, y
 * fijarla sólo si es Admin. */
function managerView(managed: ManagedPost, now: Date): NewsPostView {
  return {
    access: { canManage: true, canPin: canPinNewsPosts(managed.role) },
    now,
  };
}

/** La publicación tal como quedó, para quien acaba de tocarla. */
async function readManagedDetail(
  gateways: NewsGateways,
  managed: ManagedPost,
  now: Date,
): Promise<NewsPostDetail> {
  const { actor, post } = managed;
  const stored = await gateways.posts.findPost({
    clubId: actor.clubId,
    postId: post.id,
  });
  if (stored === null) {
    throw new Error(
      `La publicación ${post.id} no aparece justo después de guardarla.`,
    );
  }
  return describeNewsPost(gateways, stored, managerView(managed, now));
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
    coverUploadId: post.coverUploadId,
  };
}

/** El cambio de portada tal como se guarda. Pedir la que ya tiene, o quitar
 * la que no tiene, no cambia nada. Una nueva tiene que ser de quien edita,
 * comprobada antes de escribir. */
async function resolveCoverChange(
  gateways: NewsGateways,
  request: {
    readonly actor: AuditActor;
    readonly post: NewsPost;
    readonly cover: NewsCoverChange;
  },
): Promise<NewsCoverChange> {
  const { actor, post, cover } = request;
  if (cover.kind === "keep" || cover.coverUploadId === post.coverUploadId) {
    return { kind: "keep" };
  }
  if (cover.coverUploadId !== null) {
    await resolveNewsCoverUpload(gateways, {
      callerId: actor.id,
      clubId: actor.clubId,
      coverUploadId: cover.coverUploadId,
    });
  }
  return cover;
}

/** La portada que se quitó o se cambió deja de servirse en cuanto la
 * publicación deja de apuntarla; luego se borran su fila y sus ficheros. */
async function discardReplacedCover(
  gateways: NewsGateways,
  post: NewsPost,
  cover: NewsCoverChange,
): Promise<void> {
  if (cover.kind === "keep" || post.coverUploadId === null) {
    return;
  }
  await discardNewsCover(gateways.covers, {
    id: post.coverUploadId,
    clubId: post.clubId,
  });
}

/** Valida después de saber quién pide y antes de escribir nada, con las
 * mismas reglas que publicar. La bitácora va después: antes dejaría rastro de
 * una edición que no se guardó. El fijado (#592) va después de la edición:
 * sin `pin`, la fijada sigue fijada aunque la edite un Committee. */
export async function editNewsPost(
  gateways: NewsGateways,
  request: PostRequest & {
    readonly draft: NewsDraft;
    readonly expectedEditedAt: string | null;
    readonly cover: NewsCoverChange;
    readonly pin: NewsPinChange;
    readonly now: Date;
  },
): Promise<NewsPostDetail> {
  const managed = await findManagedPost(gateways, request);
  const { actor, post } = managed;
  const draft = await normalizeNewsDraft(gateways, actor.clubId, request.draft);
  const pin = authorizeNewsPinChange(request.pin, {
    role: managed.role,
    now: request.now,
  });
  const cover = await resolveCoverChange(gateways, {
    actor,
    post,
    cover: request.cover,
  });
  const update = await gateways.posts.updatePost({
    ...draft,
    postId: request.postId,
    clubId: actor.clubId,
    expectedEditedAt: request.expectedEditedAt,
    editedAt: request.now.toISOString(),
    cover,
  });
  if (update.kind === "changed") {
    throw new NewsPostChangedError();
  }
  await recordNewsPostEvent(gateways, {
    actor,
    action: "news_post.edited",
    postId: request.postId,
  });
  await applyNewsPinChange(gateways, {
    actor,
    postId: request.postId,
    change: pin,
  });
  await discardReplacedCover(gateways, post, cover);
  await sweepStaleNewsCovers(gateways.covers, {
    uploadedBy: actor.id,
    now: request.now,
  });
  return readManagedDetail(gateways, managed, request.now);
}

/** Retirar o volver a publicar. Pedir el estado que ya tiene no escribe
 * nada, ni en la bitácora: no pasó nada que contar. Retirar desfija (D8), y
 * eso lo hace la base. */
export async function changeNewsPostStatus(
  gateways: NewsGateways,
  request: PostRequest & {
    readonly status: NewsPostStatus;
    /** Contra la que caduca el fijado (D7). El endpoint la pasa siempre. */
    readonly now?: Date;
  },
): Promise<NewsPostDetail> {
  const managed = await findManagedPost(gateways, request);
  const { actor, post } = managed;
  const now = request.now ?? new Date();
  if (post.status === request.status) {
    return describeNewsPost(gateways, post, managerView(managed, now));
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
  return readManagedDetail(gateways, managed, now);
}
