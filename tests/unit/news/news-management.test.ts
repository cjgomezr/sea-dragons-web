import { describe, expect, it } from "vitest";
import { listNewsFeed } from "@/lib/news/news-feed";
import {
  NewsPostChangedError,
  NewsPostNotYoursError,
  changeNewsPostStatus,
  editNewsPost,
  readEditableNewsPost,
} from "@/lib/news/news-management";
import {
  type NewsDraft,
  NewsForbiddenError,
  NewsPostNotFoundError,
  InvalidNewsTitleError,
  ForeignNewsGroupError,
  openNewsPost,
  type NewsPost,
} from "@/lib/news/news-posts";
import { serveNewsAttachment } from "@/lib/news/news-attachments";
import {
  type FakeAttachmentClubOptions,
  attachmentIdFor,
  fakeAttachmentClub,
} from "../helpers/news-attachments-club";
import {
  AUTHOR_ID,
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  OTHER_CLUB_ID,
  SENIOR_SQUAD_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Editar y retirar una publicación (#331, RF-6 del PRD de E11). Retirar
 * oculta y no borra (D1); editar nunca avisa (D2). El Committee sólo toca lo
 * suyo; el Admin, todo lo del club.
 */

const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
const EDITED_AT = "2026-09-27T09:30:00.000Z";
const NOW = new Date(EDITED_AT);

const DRAFT: NewsDraft = {
  category: "announcement",
  title: "  Cambia la piscina: MSAC  ",
  body: "El martes entrenamos en MSAC.\nTraed gorro.",
  audience: { kind: "club" },
};

/** Una publicación de quien llama, a todo el club. */
function ownPost(overrides: Partial<NewsPost> = {}): NewsPost {
  return aPost({
    id: POST_ID,
    author: { id: CALLER_ID, fullName: "Quien llama" },
    ...overrides,
  });
}

function clubWith(
  post: NewsPost,
  options: FakeAttachmentClubOptions = {},
): ReturnType<typeof fakeAttachmentClub> {
  return fakeAttachmentClub({
    callerRole: "Committee",
    posts: [post],
    ...options,
  });
}

function edit(
  club: ReturnType<typeof fakeAttachmentClub>,
  overrides: Partial<Parameters<typeof editNewsPost>[1]> = {},
): ReturnType<typeof editNewsPost> {
  return editNewsPost(club.gateways, {
    callerId: CALLER_ID,
    postId: POST_ID,
    draft: DRAFT,
    expectedEditedAt: null,
    now: NOW,
    ...overrides,
  });
}

describe("editar una publicación", () => {
  it("guarda título, cuerpo, categoría y audiencia, y la marca como editada con su fecha", async () => {
    const club = clubWith(ownPost());

    const post = await edit(club);

    expect(post).toMatchObject({
      category: "announcement",
      title: "Cambia la piscina: MSAC",
      body: DRAFT.body,
      editedAt: EDITED_AT,
      status: "published",
    });
    expect(club.posts[0]?.editedAt).toBe(EDITED_AT);
  });

  it("escribe sólo si la publicación sigue en la edición que se tenía delante", async () => {
    const club = clubWith(ownPost({ editedAt: "2026-09-26T12:00:00.000Z" }));

    await edit(club, { expectedEditedAt: "2026-09-26T12:00:00.000Z" });

    expect(club.edits).toEqual([
      expect.objectContaining({
        postId: POST_ID,
        clubId: CLUB_ID,
        expectedEditedAt: "2026-09-26T12:00:00.000Z",
        editedAt: EDITED_AT,
      }),
    ]);
  });

  it("da un conflicto, sin pisar nada, si otra persona guardó entretanto", async () => {
    const club = clubWith(ownPost(), {
      editedMeanwhileAt: "2026-09-27T09:29:00.000Z",
    });

    await expect(edit(club)).rejects.toBeInstanceOf(NewsPostChangedError);

    expect(club.edits).toEqual([]);
    expect(club.posts[0]?.title).toBe("Cambia la piscina");
    expect(club.audited).toEqual([]);
  });

  it("ampliar la audiencia la pone en el feed de los nuevos", async () => {
    const club = clubWith(
      ownPost({ audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] } }),
    );

    await edit(club, {
      draft: {
        ...DRAFT,
        audience: {
          kind: "groups",
          groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID],
        },
      },
    });

    const newcomer = fakeClub({
      callerGroupIds: [MASTERS_SQUAD_ID],
      posts: club.posts,
    });
    const feed = await listNewsFeed(newcomer.gateways, {
      callerId: AUTHOR_ID,
    });
    expect(feed.posts.map((post) => post.id)).toEqual([POST_ID]);
  });

  it("reducir la audiencia la saca de quien queda fuera", async () => {
    const club = clubWith(ownPost());

    await edit(club, {
      draft: {
        ...DRAFT,
        audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
      },
    });

    const outsider = fakeClub({
      callerGroupIds: [MASTERS_SQUAD_ID],
      posts: club.posts,
    });
    const feed = await listNewsFeed(outsider.gateways, {
      callerId: AUTHOR_ID,
    });
    expect(feed.posts).toEqual([]);
  });

  it("no manda ningún aviso: sólo escribe la publicación y la bitácora", async () => {
    const club = clubWith(ownPost());

    await edit(club);

    expect(club.inserted).toEqual([]);
    expect(club.audited.map((row) => row.action)).toEqual(["news_post.edited"]);
  });

  it("valida el borrador igual que al publicar, antes de escribir", async () => {
    const club = clubWith(ownPost());

    await expect(
      edit(club, { draft: { ...DRAFT, title: "   " } }),
    ).rejects.toBeInstanceOf(InvalidNewsTitleError);
    await expect(
      edit(club, {
        draft: {
          ...DRAFT,
          audience: { kind: "groups", groupIds: [OTHER_CLUB_ID] },
        },
      }),
    ).rejects.toBeInstanceOf(ForeignNewsGroupError);
    expect(club.edits).toEqual([]);
  });

  it("responde que no existe a una publicación de otro club", async () => {
    const club = clubWith(ownPost({ clubId: OTHER_CLUB_ID }));

    await expect(edit(club)).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("da a quien puede editarla los valores que carga el formulario", async () => {
    const club = clubWith(
      ownPost({
        audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        editedAt: "2026-09-26T12:00:00.000Z",
      }),
    );

    const editable = await readEditableNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    expect(editable).toEqual({
      id: POST_ID,
      category: "news",
      title: "Cambia la piscina",
      body: "El martes entrenamos en MSAC.",
      audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
      editedAt: "2026-09-26T12:00:00.000Z",
      status: "published",
    });
  });
});

describe("retirar y volver a publicar", () => {
  it("retirar la saca del feed de todos, pero no la borra", async () => {
    const club = clubWith(ownPost());

    const post = await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "withdrawn",
    });

    expect(post.status).toBe("withdrawn");
    expect(club.deletedPostIds).toEqual([]);
    const reader = fakeClub({ posts: club.posts });
    const feed = await listNewsFeed(reader.gateways, { callerId: AUTHOR_ID });
    expect(feed.posts).toEqual([]);
  });

  it("una retirada deja de servir sus adjuntos", async () => {
    const attachmentId = attachmentIdFor(1);
    const club = clubWith(
      ownPost({
        attachments: [
          {
            id: attachmentId,
            fileName: "horario.pdf",
            contentType: "application/pdf",
            sizeBytes: 10,
          },
        ],
      }),
      {
        attachments: [
          {
            id: attachmentId,
            postId: POST_ID,
            clubId: CLUB_ID,
            fileName: "horario.pdf",
            contentType: "application/pdf",
            sizeBytes: 10,
            storagePath: `${CLUB_ID}/${POST_ID}/archivo.pdf`,
          },
        ],
      },
    );

    await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "withdrawn",
    });

    await expect(
      serveNewsAttachment(club.gateways, {
        callerId: CALLER_ID,
        postId: POST_ID,
        attachmentId,
      }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("volver a publicarla la devuelve al feed sin avisar a nadie", async () => {
    const club = clubWith(ownPost({ status: "withdrawn" }));

    const post = await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "published",
    });

    expect(post.status).toBe("published");
    expect(club.inserted).toEqual([]);
    const reader = fakeClub({ posts: club.posts });
    const feed = await listNewsFeed(reader.gateways, { callerId: AUTHOR_ID });
    expect(feed.posts.map((row) => row.id)).toEqual([POST_ID]);
  });

  it("retirar no la marca como editada", async () => {
    const club = clubWith(ownPost());

    const post = await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "withdrawn",
    });

    expect(post.editedAt).toBeNull();
  });

  it("no escribe nada si ya estaba en ese estado", async () => {
    const club = clubWith(ownPost({ status: "withdrawn" }));

    await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "withdrawn",
    });

    expect(club.audited).toEqual([]);
  });
});

describe("quién puede", () => {
  const othersPost = aPost({ id: POST_ID });

  it("niega al Committee editar la publicación de otra persona", async () => {
    const club = clubWith(othersPost);

    await expect(edit(club)).rejects.toBeInstanceOf(NewsPostNotYoursError);
    expect(club.edits).toEqual([]);
  });

  it("niega al Committee retirar la publicación de otra persona", async () => {
    const club = clubWith(othersPost);

    await expect(
      changeNewsPostStatus(club.gateways, {
        callerId: CALLER_ID,
        postId: POST_ID,
        status: "withdrawn",
      }),
    ).rejects.toBeInstanceOf(NewsPostNotYoursError);
    expect(club.posts[0]?.status).toBe("published");
  });

  it("deja al Admin editar y retirar la de otra persona", async () => {
    const club = clubWith(othersPost, { callerRole: "Admin" });

    await edit(club);
    await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "withdrawn",
    });

    expect(club.posts[0]).toMatchObject({
      editedAt: EDITED_AT,
      status: "withdrawn",
    });
  });

  it.each(["Coach", "Player"] as const)(
    "niega a un %s editar o retirar, aunque la publicación fuera suya",
    async (role) => {
      const club = clubWith(ownPost(), { callerRole: role });

      await expect(edit(club)).rejects.toBeInstanceOf(NewsForbiddenError);
      await expect(
        changeNewsPostStatus(club.gateways, {
          callerId: CALLER_ID,
          postId: POST_ID,
          status: "withdrawn",
        }),
      ).rejects.toBeInstanceOf(NewsForbiddenError);
      await expect(
        readEditableNewsPost(club.gateways, {
          callerId: CALLER_ID,
          postId: POST_ID,
        }),
      ).rejects.toBeInstanceOf(NewsForbiddenError);
    },
  );

  it("dice a quien abre la publicación si puede editarla y retirarla", async () => {
    const own = await openNewsPost(clubWith(ownPost()).gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });
    const others = await openNewsPost(clubWith(othersPost).gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });
    const asAdmin = await openNewsPost(
      clubWith(othersPost, { callerRole: "Admin" }).gateways,
      { callerId: CALLER_ID, postId: POST_ID },
    );

    expect([own.canManage, others.canManage, asAdmin.canManage]).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe("bitácora", () => {
  it("guarda una entrada por acción, con quién y sobre qué publicación, sin el texto", async () => {
    const club = clubWith(ownPost());

    await edit(club);
    await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "withdrawn",
    });
    await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "published",
    });

    expect(club.audited).toEqual(
      ["news_post.edited", "news_post.withdrawn", "news_post.republished"].map(
        (action) => ({
          club_id: CLUB_ID,
          actor_id: CALLER_ID,
          action,
          entity_type: "news_post",
          entity_id: POST_ID,
          result: "success",
          metadata: null,
        }),
      ),
    );
  });

  it("no deja rastro de una edición que no se guardó", async () => {
    const club = clubWith(aPost({ id: POST_ID }));

    await expect(edit(club)).rejects.toBeInstanceOf(NewsPostNotYoursError);

    expect(club.audited).toEqual([]);
  });
});
