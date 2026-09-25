import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  EmptyNewsAudienceError,
  ForeignNewsGroupError,
  InvalidNewsBodyError,
  InvalidNewsTitleError,
  NEWS_TITLE_MAX_LENGTH,
  type NewsDraft,
  NewsForbiddenError,
  NewsPostNotFoundError,
  openNewsPost,
  publishNewsPost,
} from "@/lib/news/news-posts";
import {
  AUTHOR,
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  OTHER_CLUB_ID,
  SENIOR_SQUAD_ID,
  aPost,
  fakeClub,
} from "../helpers/news-club";

/**
 * Publicar y abrir una publicación (#327, RF-2 y RF-5 del PRD de E11). El
 * club sale siempre de la fila de quien llama; quién puede publicar, de la
 * matriz de roles.
 */

const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";

const DRAFT: NewsDraft = {
  category: "announcement",
  title: "Cambia la piscina",
  body: "El martes entrenamos en MSAC.\nTraed gorro.",
  audience: { kind: "club" },
};

describe("publicar", () => {
  it.each(["Admin", "Committee"] as const)(
    "un %s guarda la publicación con su autor, su club y su fecha",
    async (role) => {
      const club = fakeClub({ callerRole: role });

      const post = await publishNewsPost(club.gateways, {
        callerId: CALLER_ID,
        draft: DRAFT,
      });

      expect(club.inserted).toEqual([
        {
          clubId: CLUB_ID,
          authorId: CALLER_ID,
          category: "announcement",
          title: "Cambia la piscina",
          body: DRAFT.body,
          audience: { kind: "club" },
        },
      ]);
      expect(post).toMatchObject({
        author: { id: CALLER_ID },
        publishedAt: expect.any(String),
        editedAt: null,
        status: "published",
      });
    },
  );

  it("guarda una audiencia de grupos con los grupos del club, sin repetirlos", async () => {
    const club = fakeClub({ callerRole: "Admin" });

    await publishNewsPost(club.gateways, {
      callerId: CALLER_ID,
      draft: {
        ...DRAFT,
        audience: {
          kind: "groups",
          groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID, SENIOR_SQUAD_ID],
        },
      },
    });

    expect(club.inserted[0]?.audience).toEqual({
      kind: "groups",
      groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID],
    });
  });

  it("recorta el título antes de guardarlo", async () => {
    const club = fakeClub({ callerRole: "Admin" });

    await publishNewsPost(club.gateways, {
      callerId: CALLER_ID,
      draft: { ...DRAFT, title: "  Cambia la piscina\n" },
    });

    expect(club.inserted[0]?.title).toBe("Cambia la piscina");
  });

  it("rechaza una audiencia de grupos vacía sin escribir nada", async () => {
    const club = fakeClub({ callerRole: "Admin" });

    await expect(
      publishNewsPost(club.gateways, {
        callerId: CALLER_ID,
        draft: { ...DRAFT, audience: { kind: "groups", groupIds: [] } },
      }),
    ).rejects.toBeInstanceOf(EmptyNewsAudienceError);
    expect(club.inserted).toEqual([]);
  });

  it("rechaza un grupo que no es del club sin escribir nada", async () => {
    const club = fakeClub({
      callerRole: "Admin",
      clubGroupIds: [SENIOR_SQUAD_ID],
    });

    await expect(
      publishNewsPost(club.gateways, {
        callerId: CALLER_ID,
        draft: {
          ...DRAFT,
          audience: {
            kind: "groups",
            groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID],
          },
        },
      }),
    ).rejects.toBeInstanceOf(ForeignNewsGroupError);
    expect(club.inserted).toEqual([]);
  });

  it.each([
    ["vacío", "   "],
    ["demasiado largo", "a".repeat(NEWS_TITLE_MAX_LENGTH + 1)],
    ["con caracteres de control", "Cambia\u0000 la piscina"],
  ])("rechaza un título %s", async (_case, title) => {
    const club = fakeClub({ callerRole: "Admin" });

    await expect(
      publishNewsPost(club.gateways, {
        callerId: CALLER_ID,
        draft: { ...DRAFT, title },
      }),
    ).rejects.toBeInstanceOf(InvalidNewsTitleError);
    expect(club.inserted).toEqual([]);
  });

  it("acepta un título de exactamente el máximo, contado en caracteres", async () => {
    const club = fakeClub({ callerRole: "Admin" });
    const title = "🤿".repeat(NEWS_TITLE_MAX_LENGTH);

    await publishNewsPost(club.gateways, {
      callerId: CALLER_ID,
      draft: { ...DRAFT, title },
    });

    expect(club.inserted[0]?.title).toBe(title);
  });

  it("rechaza un cuerpo de sólo espacios y saltos de línea", async () => {
    const club = fakeClub({ callerRole: "Admin" });

    await expect(
      publishNewsPost(club.gateways, {
        callerId: CALLER_ID,
        draft: { ...DRAFT, body: " \n\n\t" },
      }),
    ).rejects.toBeInstanceOf(InvalidNewsBodyError);
  });
});

describe("permisos de publicación", () => {
  it.each(["Coach", "Player"] as const)(
    "niega publicar a un %s sin escribir nada",
    async (role) => {
      const club = fakeClub({ callerRole: role });

      await expect(
        publishNewsPost(club.gateways, { callerId: CALLER_ID, draft: DRAFT }),
      ).rejects.toBeInstanceOf(NewsForbiddenError);
      expect(club.inserted).toEqual([]);
    },
  );

  it("niega publicar a una sesión sin fila de socio", async () => {
    const club = fakeClub({ callerIsMember: false });

    await expect(
      publishNewsPost(club.gateways, { callerId: CALLER_ID, draft: DRAFT }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("abrir una publicación", () => {
  const attachment = {
    id: "e4e4e4e4-0000-4000-8000-00000000000e",
    fileName: "politica-seguridad.pdf",
    contentType: "application/pdf",
    sizeBytes: 48_213,
  };

  it("da a su audiencia el cuerpo entero, el autor, la fecha, si se editó y los adjuntos", async () => {
    const body = "Línea uno.\n".repeat(80);
    const club = fakeClub({
      posts: [
        aPost({
          id: POST_ID,
          body,
          editedAt: "2026-09-27T08:00:00.000000+00:00",
          attachments: [attachment],
        }),
      ],
    });

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    expect(post).toEqual({
      id: POST_ID,
      category: "news",
      title: "Cambia la piscina",
      body,
      author: AUTHOR,
      publishedAt: "2026-09-26T10:00:00.000000+00:00",
      editedAt: "2026-09-27T08:00:00.000000+00:00",
      status: "published",
      attachments: [attachment],
    });
  });

  it("la ve quien pertenece a uno de sus grupos", async () => {
    const club = fakeClub({
      callerGroupIds: [MASTERS_SQUAD_ID],
      posts: [
        aPost({
          id: POST_ID,
          audience: {
            kind: "groups",
            groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID],
          },
        }),
      ],
    });

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    expect(post.id).toBe(POST_ID);
  });

  it("responde que no existe, y no que está prohibida, a quien no es su audiencia", async () => {
    const club = fakeClub({
      callerGroupIds: [MASTERS_SQUAD_ID],
      posts: [
        aPost({
          id: POST_ID,
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
      ],
    });

    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("responde que no existe a una publicación de grupos que ya no alcanza a nadie", async () => {
    const club = fakeClub({
      callerGroupIds: [SENIOR_SQUAD_ID],
      posts: [
        aPost({ id: POST_ID, audience: { kind: "groups", groupIds: [] } }),
      ],
    });

    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("responde que no existe a una publicación de otro club", async () => {
    const club = fakeClub({
      posts: [aPost({ id: POST_ID, clubId: OTHER_CLUB_ID })],
    });

    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("responde que no existe a una publicación que no existe", async () => {
    const club = fakeClub();

    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("responde que no existe a una retirada, aunque sea de todo el club", async () => {
    const club = fakeClub({
      posts: [aPost({ id: POST_ID, status: "withdrawn" })],
    });

    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });

  it("deja a quien publicó abrir la retirada, marcada como retirada", async () => {
    const club = fakeClub({
      posts: [
        aPost({
          id: POST_ID,
          status: "withdrawn",
          author: { id: CALLER_ID, fullName: "Quien llama" },
        }),
      ],
    });

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    expect(post.status).toBe("withdrawn");
  });

  it("deja a quien publicó abrir la suya aunque no esté en sus grupos", async () => {
    const club = fakeClub({
      posts: [
        aPost({
          id: POST_ID,
          author: { id: CALLER_ID, fullName: "Quien llama" },
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        }),
      ],
    });

    const post = await openNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
    });

    expect(post.id).toBe(POST_ID);
  });

  it("no le da a nadie más que al autor la retirada, ni al Admin", async () => {
    const club = fakeClub({
      callerRole: "Admin",
      posts: [aPost({ id: POST_ID, status: "withdrawn", author: AUTHOR })],
    });

    await expect(
      openNewsPost(club.gateways, { callerId: CALLER_ID, postId: POST_ID }),
    ).rejects.toBeInstanceOf(NewsPostNotFoundError);
  });
});
