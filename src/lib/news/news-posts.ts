import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type {
  RoleRequestGateways,
  RoleRequestMember,
} from "@/lib/auth/role-request";
import { hasCapability } from "@/lib/auth/roles";
import type { MemberGroupsGateway } from "@/lib/groups/member-groups";

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
export type NewsAudience =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groupIds: readonly string[] };

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
  readonly publishedAt: string;
  readonly editedAt: string | null;
  readonly status: NewsPostStatus;
  readonly audience: NewsAudience;
  readonly attachments: readonly NewsAttachmentSummary[];
};

/** Lo que recibe quien abre una publicación. Ni el club ni la audiencia: a
 * qué otros grupos iba no es asunto de quien la lee. */
export type NewsPostDetail = Omit<NewsPost, "clubId" | "audience">;

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
};

/** Una fila del feed antes de recortar el cuerpo en extracto. */
export type NewsFeedRow = {
  readonly id: string;
  readonly category: NewsCategory;
  readonly title: string;
  readonly body: string;
  readonly author: NewsAuthor;
  readonly publishedAt: string;
  readonly attachmentCount: number;
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
  readonly audienceGroupIds: readonly string[];
  readonly after: NewsFeedPosition | null;
  readonly limit: number;
};

export type NewsPostsGateway = {
  /** Cuáles de estos grupos son del club. */
  findClubGroupIds(query: {
    readonly clubId: string;
    readonly groupIds: readonly string[];
  }): Promise<ReadonlySet<string>>;
  insertPost(post: NewNewsPost): Promise<NewsPost>;
  /** Las publicadas del club que van a todo el club o a alguno de esos
   * grupos, de la más reciente a la más antigua y desde `after`. */
  findFeedPage(query: NewsFeedQuery): Promise<readonly NewsFeedRow[]>;
  /** La publicación, si es del club, esté como esté. */
  findPost(query: {
    readonly clubId: string;
    readonly postId: string;
  }): Promise<NewsPost | null>;
};

export type NewsGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly memberGroups: MemberGroupsGateway;
  readonly posts: NewsPostsGateway;
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

function toDetail(post: NewsPost): NewsPostDetail {
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    body: post.body,
    author: post.author,
    publishedAt: post.publishedAt,
    editedAt: post.editedAt,
    status: post.status,
    attachments: post.attachments,
  };
}

/** La frontera ya niega esta ruta a quien no publica; esto es el cerrojo del
 * dominio, para que no dependa de que nadie olvide la línea de
 * `RESTRICTED_ROUTES`. */
export async function publishNewsPost(
  gateways: NewsGateways,
  request: { readonly callerId: string; readonly draft: NewsDraft },
): Promise<NewsPostDetail> {
  const caller = await findNewsReader(gateways, request.callerId);
  if (!hasCapability(caller.role, "publishNewsAndDocuments")) {
    throw new NewsForbiddenError();
  }
  const { draft } = request;
  const title = normalizeNewsTitle(draft.title);
  const body = requireNewsBody(draft.body);
  const audience = await resolveAudience(
    gateways,
    caller.clubId,
    draft.audience,
  );
  const post = await gateways.posts.insertPost({
    clubId: caller.clubId,
    authorId: request.callerId,
    category: draft.category,
    title,
    body,
    audience,
  });
  return toDetail(post);
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
export async function openNewsPost(
  gateways: NewsGateways,
  request: { readonly callerId: string; readonly postId: string },
): Promise<NewsPostDetail> {
  const caller = await findNewsReader(gateways, request.callerId);
  const [post, groupIds] = await Promise.all([
    gateways.posts.findPost({ clubId: caller.clubId, postId: request.postId }),
    findReaderGroupIds(gateways, request.callerId),
  ]);
  if (post === null || !isVisibleTo(post, { id: request.callerId, groupIds })) {
    throw new NewsPostNotFoundError();
  }
  return toDetail(post);
}
