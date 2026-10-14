import type { ClubAudience } from "@/lib/notifications/audience-members";
import type { AuditLogWriter } from "@/lib/audit/audit-log";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { type Role, hasCapability } from "@/lib/auth/roles";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";
import { type NewsCoversGateway, signNewsCoverUrl } from "./news-covers";
import type { NewsInlineImagesGateway } from "./news-inline-images";
import { type NewsPin, isNewsPinActive } from "./news-pin-rule";

/**
 * Publicar y abrir una publicación del club (#327, RF-2 y RF-5 del PRD de
 * E11), contado sin Supabase delante.
 *
 * El club sale siempre de la fila de quien llama, nunca de un parámetro
 * (NFR-009). Los grupos de quien lee salen de la consulta de E4
 * (`MemberGroupsGateway`): la audiencia se resuelve al leer, así que quien
 * entra en un grupo ve lo que ya se había publicado para él (PRD, sección 7).
 */

/** Las mismas que acepta el `check` de `news_posts.category` en
 * `0029_news_posts.sql`, en inglés como en el SRD. */
export const NEWS_CATEGORIES = ["announcement", "news", "document"] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** El mismo tope que el `check` de `news_posts.title`. La pantalla lo usará
 * para su formulario. */
export const NEWS_TITLE_MAX_LENGTH = 120;

const CONTROL_CHARACTER = /\p{Cc}/u;
const NON_BLANK = /\S/;

/** "Todo el club" y "estos grupos" son dos casos, no una lista que puede venir
 * vacía: así una audiencia de cero grupos es un valor que se nombra y se
 * rechaza al publicar, y no un club entero por descuido. */
export type NewsAudience = ClubAudience;

export type NewsPostStatus = "published" | "withdrawn";

export type NewsAuthor = { readonly id: string; readonly fullName: string };

/** Sólo sus datos: subirlos y servirlos es el ticket hermano (T3). */
export type NewsAttachmentSummary = {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
};

/** Una publicación como la guarda la base, con su club y su audiencia. */
export type NewsPost = {
  readonly id: string;
  readonly clubId: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly author: NewsAuthor;
  /** La miniatura de la foto del autor en `member-photos` (#596). */
  readonly authorPhotoPath: string | null;
  readonly publishedAt: string;
  readonly editedAt: string | null;
  readonly status: NewsPostStatus;
  readonly audience: NewsAudience;
  readonly attachments: readonly NewsAttachmentSummary[];
  /** La subida de `news_cover_uploads` que hace de portada (#591). */
  readonly coverUploadId: string | null;
  /** El fijado tal como está guardado, caducado o no (#592). */
  readonly pin: NewsPin | null;
};

/** El autor de una publicación abierta, con su foto firmada (#596). */
export type NewsPostAuthor = NewsAuthor & { readonly photoUrl: string | null };

/** A quién va, dicho para quien la abre (#596): todo el club, o los grupos
 * por su nombre. */
export type NewsPostAudienceLabel =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groupNames: readonly string[] };

/** Lo que recibe quien abre una publicación. Ni el club ni los ids de la
 * audiencia. De los grupos, quien la lee sólo ve los suyos: a qué otros
 * grupos iba no es asunto suyo. Quien la publicó o la gestiona los ve todos.
 * `canManage` dice si quien la abre puede editarla y retirarla (#331), para
 * que la pantalla no tenga que repetir la regla. `coverUrl` es la versión
 * grande de la portada, firmada (#591). */
export type NewsPostDetail = Omit<
  NewsPost,
  "clubId" | "author" | "authorPhotoPath" | "audience" | "coverUploadId" | "pin"
> & {
  readonly author: NewsPostAuthor;
  readonly audience: NewsPostAudienceLabel;
  readonly canManage: boolean;
  readonly coverUrl: string | null;
  /** Si está fijada ahora (#592). Una caducada no lo está (D7), y entonces
   * `pinnedUntil` es nulo, como en una fijada sin fecha de fin. */
  readonly isPinned: boolean;
  readonly pinnedUntil: string | null;
  /** Solo el Admin fija y desfija (D1). */
  readonly canPin: boolean;
};

/** Lo que quien abre la publicación puede hacer con ella. */
export type NewsPostAccess = {
  readonly canManage: boolean;
  readonly canPin: boolean;
};

/** Lo que manda quien publica, tal como llega. */
export type NewsDraft = {
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly audience: NewsAudience;
};

export type NewNewsPost = NewsDraft & {
  readonly clubId: string;
  readonly authorId: string;
  readonly coverUploadId: string | null;
};

/** Una fila del feed antes de recortar el cuerpo en extracto. */
export type NewsFeedRow = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly author: NewsAuthor;
  readonly publishedAt: string;
  /** Retirada sólo le llega a quien la publicó (#331). */
  readonly status: NewsPostStatus;
  readonly attachmentCount: number;
  readonly coverUploadId: string | null;
};

/** La fila de la fijada vigente, con su fecha de fin (#592). */
export type NewsPinnedFeedRow = NewsFeedRow & {
  readonly pinnedUntil: string | null;
};

/** Dónde terminó la página anterior. Va con el id porque dos publicaciones
 * pueden compartir instante, y sin desempate una se repetiría o se perdería
 * entre páginas. */
export type NewsFeedPosition = {
  readonly publishedAt: string;
  readonly id: string;
};

export type NewsFeedQuery = {
  readonly clubId: string;
  /** Quien lee: lo suyo le llega siempre, retirado incluido (#331). */
  readonly readerId: string;
  readonly audienceGroupIds: readonly string[];
  readonly after: NewsFeedPosition | null;
  readonly limit: number;
  /** La hora contra la que caduca el fijado (D7). La fijada vigente no va en
   * ninguna página: el feed la trae aparte (#592). */
  readonly now: string;
};

/** Quién lee y cuándo, para buscar la fijada vigente que le alcanza. */
export type NewsPinnedQuery = Omit<NewsFeedQuery, "after" | "limit">;

/** Quién fija y cuál. La base vuelve a comprobar que es Admin. */
export type NewsPinCommand = {
  readonly clubId: string;
  readonly actingUserId: string;
  readonly postId: string;
};

/** Una fijada que se quitó, con la fecha de fin que tenía. */
export type NewsUnpinned = {
  readonly postId: string;
  readonly pinnedUntil: string | null;
};

/** Lo que responde la base al fijar. `replaced` es la fijada vigente que
 * quitó, o nula si no había. */
export type NewsPinOutcome =
  | { readonly kind: "pinned"; readonly replaced: NewsUnpinned | null }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "withdrawn" };

/** Lo que responde la base al desfijar. Una caducada responde `not_pinned`:
 * ya no contaba como fijada. */
export type NewsUnpinOutcome =
  | { readonly kind: "unpinned"; readonly pinnedUntil: string | null }
  | { readonly kind: "not_pinned" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" };

/** Lo que una edición hace con la portada (#591): dejarla como está, o
 * ponerle otra (`null` la quita). Dos casos y no un campo opcional, para que
 * "no la toques" y "quítala" no se confundan. */
export type NewsCoverChange =
  | { readonly kind: "keep" }
  | { readonly kind: "replace"; readonly coverUploadId: string | null };

/** Una edición (#331). Sólo se escribe si la publicación sigue en
 * `expectedEditedAt`, la edición que tenía delante quien guarda (`null` si
 * nunca se editó): si alguien guardó entretanto, no se pisa nada. */
export type NewsPostEdit = NewsDraft & {
  readonly postId: string;
  readonly clubId: string;
  readonly expectedEditedAt: string | null;
  readonly editedAt: string;
  readonly cover: NewsCoverChange;
};

export type NewsPostUpdate =
  { readonly kind: "updated" } | { readonly kind: "changed" };

export type NewsPostsGateway = {
  /** Cuáles de estos grupos son del club. */
  findClubGroupIds(query: {
    readonly clubId: string;
    readonly groupIds: readonly string[];
  }): Promise<ReadonlySet<string>>;
  /** El nombre de cada uno de estos grupos que sea del club, por su id. */
  findGroupNames(query: {
    readonly clubId: string;
    readonly groupIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
  insertPost(post: NewNewsPost): Promise<NewsPost>;
  /** Las publicadas del club que van a todo el club o a alguno de esos
   * grupos, de la más reciente a la más antigua y desde `after`. */
  findFeedPage(query: NewsFeedQuery): Promise<readonly NewsFeedRow[]>;
  /** La publicación, si es del club, esté como esté. */
  findPost(query: {
    readonly clubId: string;
    readonly postId: string;
  }): Promise<NewsPost | null>;
  /** Borra la publicación con su audiencia y sus adjuntos. Sólo lo usa
   * publicar para deshacerse cuando un adjunto no entra: retirar no borra
   * (decisión D1). */
  deletePost(postId: string): Promise<void>;
  /** Categoría, título, cuerpo, audiencia y la marca de editada. */
  updatePost(edit: NewsPostEdit): Promise<NewsPostUpdate>;
  /** Retirar o volver a publicar: cambia el estado y nada más. Retirar
   * desfija (D8). */
  setPostStatus(change: {
    readonly clubId: string;
    readonly postId: string;
    readonly status: NewsPostStatus;
  }): Promise<void>;
  /** La fijada vigente del club, si le alcanza a quien lee con la misma
   * audiencia que el feed. */
  findPinnedFeedRow(query: NewsPinnedQuery): Promise<NewsPinnedFeedRow | null>;
  /** Fija hasta `until` (nula: sin fecha de fin) y desfija la anterior, en
   * una sola transacción. */
  pinPost(
    command: NewsPinCommand & { readonly until: string | null },
  ): Promise<NewsPinOutcome>;
  unpinPost(command: NewsPinCommand): Promise<NewsUnpinOutcome>;
};

export type NewsGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly memberGroups: MemberGroupsGateway;
  readonly posts: NewsPostsGateway;
  readonly covers: NewsCoversGateway;
  /** Las imágenes del cuerpo (#603). */
  readonly inlineImages: NewsInlineImagesGateway;
  /** Firma la miniatura de la foto de un socio, o nula si no se pudo. */
  readonly authorPhotos: {
    signPhotoUrl(photoPath: string): Promise<string | null>;
  };
  readonly audit: AuditLogWriter;
};

export class NewsForbiddenError extends Error {
  constructor() {
    super("Tu rol no te permite publicar noticias ni documentos.");
    this.name = "NewsForbiddenError";
  }
}

export class InvalidNewsTitleError extends Error {
  constructor() {
    super(
      `El título tiene que tener entre 1 y ${NEWS_TITLE_MAX_LENGTH} caracteres, sin caracteres de control.`,
    );
    this.name = "InvalidNewsTitleError";
  }
}

export class InvalidNewsBodyError extends Error {
  constructor() {
    super("El cuerpo de la publicación no puede estar vacío.");
    this.name = "InvalidNewsBodyError";
  }
}

export class EmptyNewsAudienceError extends Error {
  constructor() {
    super("La audiencia es todo el club o al menos un grupo.");
    this.name = "EmptyNewsAudienceError";
  }
}

export class ForeignNewsGroupError extends Error {
  constructor() {
    super("Uno de los grupos de la audiencia no existe en tu club.");
    this.name = "ForeignNewsGroupError";
  }
}

export class NewsPostNotFoundError extends Error {
  constructor() {
    super("No existe esa publicación.");
    this.name = "NewsPostNotFoundError";
  }
}

/** Quien llama, con su club y su rol. */
export async function findNewsReader(
  gateways: Pick<NewsGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await gateways.members.findRoleRequestMember(callerId);
  if (caller === null) {
    throw new MemberNotFoundError(callerId);
  }
  return caller;
}

/** Quien llama, si puede publicar. */
export async function findNewsPublisher(
  gateways: Pick<NewsGateways, "members">,
  callerId: string,
): Promise<RoleRequestMember> {
  const caller = await findNewsReader(gateways, callerId);
  if (!hasCapability(caller.role, "publishNewsAndDocuments")) {
    throw new NewsForbiddenError();
  }
  return caller;
}

/** Los ids de los grupos de quien llama, con la consulta de E4. */
export async function findReaderGroupIds(
  gateways: Pick<NewsGateways, "memberGroups">,
  callerId: string,
): Promise<readonly string[]> {
  const groups = await gateways.memberGroups.listGroupsOf(callerId);
  return groups.map((group) => group.id);
}

/** El título tal como se guarda: recortado, contado en caracteres como
 * `char_length`, y sin caracteres de control, igual que el nombre de un
 * grupo. */
function normalizeNewsTitle(rawTitle: string): string {
  const title = rawTitle.trim();
  const length = [...title].length;
  if (
    length === 0 ||
    length > NEWS_TITLE_MAX_LENGTH ||
    CONTROL_CHARACTER.test(title)
  ) {
    throw new InvalidNewsTitleError();
  }
  return title;
}

/** El cuerpo se guarda tal cual, saltos de línea incluidos (texto plano,
 * PRD sección 4); sólo se exige que diga algo. */
function requireNewsBody(body: string): string {
  if (!NON_BLANK.test(body)) {
    throw new InvalidNewsBodyError();
  }
  return body;
}

/** Una audiencia de grupos vacía se rechaza aquí y no en la base: borrar un
 * grupo puede dejar una publicación así, y la base no debe impedirlo. Un
 * grupo de otro club se rechaza antes de escribir nada. */
async function resolveAudience(
  gateways: Pick<NewsGateways, "posts">,
  clubId: string,
  audience: NewsAudience,
): Promise<NewsAudience> {
  if (audience.kind === "club") {
    return audience;
  }
  const groupIds = [...new Set(audience.groupIds)];
  if (groupIds.length === 0) {
    throw new EmptyNewsAudienceError();
  }
  const clubGroupIds = await gateways.posts.findClubGroupIds({
    clubId,
    groupIds,
  });
  if (groupIds.some((id) => !clubGroupIds.has(id))) {
    throw new ForeignNewsGroupError();
  }
  return { kind: "groups", groupIds };
}

/** El Admin, sobre cualquiera del club. */
const MANAGES_EVERY_POST: Role = "Admin";

/** Solo el Admin fija (D1): fijar otra quita la anterior aunque sea de otra
 * persona, y con el Committee fijando, dos personas se pisarían el
 * destacado. */
const PINS_POSTS: Role = "Admin";

export function canPinNewsPosts(role: Role): boolean {
  return role === PINS_POSTS;
}

/** Quien puede editar y retirar la publicación (#331, RF-6): el Admin
 * cualquiera, y quien puede publicar sólo la suya. Coach y Player, ninguna,
 * aunque alguna vez la hubieran publicado. */
export function canManageNewsPost(
  caller: { readonly id: string; readonly role: Role },
  post: NewsPost,
): boolean {
  if (!hasCapability(caller.role, "publishNewsAndDocuments")) {
    return false;
  }
  return caller.role === MANAGES_EVERY_POST || post.author.id === caller.id;
}

/** El borrador tal como se guarda, o el motivo por el que no vale. Lo
 * comparten publicar y editar (#331): una edición cumple las mismas reglas. */
export async function normalizeNewsDraft(
  gateways: Pick<NewsGateways, "posts">,
  clubId: string,
  draft: NewsDraft,
): Promise<NewsDraft> {
  const title = normalizeNewsTitle(draft.title);
  const body = requireNewsBody(draft.body);
  const audience = await resolveAudience(gateways, clubId, draft.audience);
  return { category: draft.category, title, body, audience };
}

/** Qué grupos de la audiencia se le nombran a quien la abre (#596): todos a
 * quien la publicó o la gestiona, y a quien sólo la lee, los suyos. */
export type NamedAudienceGroups =
  | { readonly kind: "all" }
  | { readonly kind: "readerGroups"; readonly groupIds: readonly string[] };

export const ALL_AUDIENCE_GROUPS: NamedAudienceGroups = { kind: "all" };

/** Cómo la ve quien la abre: qué puede hacer con ella, qué grupos de su
 * audiencia se le nombran y a qué hora, contra la que caduca el fijado
 * (D7). */
export type NewsPostView = {
  readonly access: NewsPostAccess;
  readonly now: Date;
  readonly namedGroups: NamedAudienceGroups;
};

/** Lo que se firma o se busca aparte de la fila de la publicación. */
type NewsPostExtras = {
  readonly coverUrl: string | null;
  readonly author: NewsPostAuthor;
  readonly audience: NewsPostAudienceLabel;
};

function toNewsPostDetail(
  post: NewsPost,
  view: NewsPostView,
  extras: NewsPostExtras,
): NewsPostDetail {
  const isPinned = isNewsPinActive(post.pin, view.now);
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    body: post.body,
    author: extras.author,
    audience: extras.audience,
    publishedAt: post.publishedAt,
    editedAt: post.editedAt,
    status: post.status,
    attachments: post.attachments,
    canManage: view.access.canManage,
    coverUrl: extras.coverUrl,
    isPinned,
    pinnedUntil: isPinned && post.pin !== null ? post.pin.pinnedUntil : null,
    canPin: view.access.canPin,
  };
}

async function describeAudience(
  gateways: Pick<NewsGateways, "posts">,
  post: NewsPost,
  view: NewsPostView,
): Promise<NewsPostAudienceLabel> {
  if (post.audience.kind === "club") {
    return { kind: "club" };
  }
  const { namedGroups } = view;
  const groupIds =
    namedGroups.kind === "all"
      ? post.audience.groupIds
      : post.audience.groupIds.filter((id) =>
          namedGroups.groupIds.includes(id),
        );
  const names = await gateways.posts.findGroupNames({
    clubId: post.clubId,
    groupIds,
  });
  return {
    kind: "groups",
    groupNames: [...names.values()].sort((first, second) =>
      first.localeCompare(second),
    ),
  };
}

async function describeAuthor(
  gateways: Pick<NewsGateways, "authorPhotos">,
  post: NewsPost,
): Promise<NewsPostAuthor> {
  const photoUrl =
    post.authorPhotoPath === null
      ? null
      : await gateways.authorPhotos.signPhotoUrl(post.authorPhotoPath);
  return { ...post.author, photoUrl };
}

/** El detalle con la grande de su portada y la foto del autor firmadas.
 * Firmar no comprueba la audiencia: quien llama ya decidió que la
 * publicación se le enseña. */
export async function describeNewsPost(
  gateways: Pick<NewsGateways, "covers" | "posts" | "authorPhotos">,
  post: NewsPost,
  view: NewsPostView,
): Promise<NewsPostDetail> {
  const [coverUrl, author, audience] = await Promise.all([
    signNewsCoverUrl(
      gateways.covers,
      post.coverUploadId === null
        ? null
        : { id: post.coverUploadId, clubId: post.clubId },
    ),
    describeAuthor(gateways, post),
    describeAudience(gateways, post, view),
  ]);
  return toNewsPostDetail(post, view, { coverUrl, author, audience });
}

/** Una publicación lista para guardar, con el rol de quien la publica, que
 * decide además si puede fijarla (#592). */
export type PreparedNewsPost = {
  readonly post: Omit<NewNewsPost, "coverUploadId">;
  readonly publisherRole: Role;
};

/** La publicación lista para guardar, o el motivo por el que no vale. No
 * escribe nada: publicar con adjuntos (#330) comprueba además sus subidas
 * antes de guardarla.
 *
 * La frontera ya niega publicar a quien no puede; esto es el cerrojo del
 * dominio, para que no dependa de que nadie olvide la línea de
 * `RESTRICTED_ROUTES`. */
export async function prepareNewsPost(
  gateways: Pick<NewsGateways, "members" | "posts">,
  request: { readonly callerId: string; readonly draft: NewsDraft },
): Promise<PreparedNewsPost> {
  const caller = await findNewsPublisher(gateways, request.callerId);
  return {
    post: {
      ...(await normalizeNewsDraft(gateways, caller.clubId, request.draft)),
      clubId: caller.clubId,
      authorId: request.callerId,
    },
    publisherRole: caller.role,
  };
}

/** Quien publicó ve siempre lo suyo, retirado incluido (RF-5). Los demás,
 * sólo lo publicado que va a todo el club o a alguno de sus grupos. */
function isVisibleTo(
  post: NewsPost,
  reader: { readonly id: string; readonly groupIds: readonly string[] },
): boolean {
  if (post.author.id === reader.id) {
    return true;
  }
  if (post.status === "withdrawn") {
    return false;
  }
  return (
    post.audience.kind === "club" ||
    post.audience.groupIds.some((id) => reader.groupIds.includes(id))
  );
}

/**
 * La publicación entera, para quien es su audiencia.
 *
 * Todo lo que no le corresponde responde igual que lo que no existe: la de
 * otro club, la de un grupo ajeno y la retirada. Es deliberado. Con un
 * "prohibido" distinto de un "no existe", cualquiera podría recorrer ids y
 * enumerar qué publicaciones tiene el club y cuáles le ocultan (RF-5).
 */
/** La publicación con quien la lee y sus grupos, o null si no es su
 * audiencia o no existe. Lo comparten abrirla y servir las imágenes de su
 * cuerpo (#603), que no necesitan firmar nada más. */
async function findVisibleNewsPost(
  gateways: Pick<NewsGateways, "members" | "memberGroups" | "posts">,
  request: { readonly callerId: string; readonly postId: string },
): Promise<{
  readonly caller: RoleRequestMember;
  readonly post: NewsPost | null;
  readonly groupIds: readonly string[];
}> {
  const caller = await findNewsReader(gateways, request.callerId);
  const [post, groupIds] = await Promise.all([
    gateways.posts.findPost({ clubId: caller.clubId, postId: request.postId }),
    findReaderGroupIds(gateways, request.callerId),
  ]);
  const isVisible =
    post !== null && isVisibleTo(post, { id: request.callerId, groupIds });
  return { caller, post: isVisible ? post : null, groupIds };
}

/** La publicación, si quien llama es su audiencia; null si no, igual que si
 * no existiera. */
export async function findReadableNewsPost(
  gateways: Pick<NewsGateways, "members" | "memberGroups" | "posts">,
  request: { readonly callerId: string; readonly postId: string },
): Promise<NewsPost | null> {
  return (await findVisibleNewsPost(gateways, request)).post;
}

export async function openNewsPost(
  gateways: NewsGateways,
  request: {
    readonly callerId: string;
    readonly postId: string;
    /** Contra la que caduca el fijado (D7). El endpoint la pasa siempre. */
    readonly now?: Date;
  },
): Promise<NewsPostDetail> {
  const { caller, post, groupIds } = await findVisibleNewsPost(
    gateways,
    request,
  );
  if (post === null) {
    throw new NewsPostNotFoundError();
  }
  const canManage = canManageNewsPost(
    { id: request.callerId, role: caller.role },
    post,
  );
  // Quien la publicó la sigue viendo aunque ya no pueda gestionarla, y
  // entonces también a quién iba.
  const isAuthor = post.author.id === request.callerId;
  return describeNewsPost(gateways, post, {
    access: { canManage, canPin: canPinNewsPosts(caller.role) },
    now: request.now ?? new Date(),
    namedGroups:
      canManage || isAuthor
        ? ALL_AUDIENCE_GROUPS
        : { kind: "readerGroups", groupIds },
  });
}
