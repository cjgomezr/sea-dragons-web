import { afterEach, describe, expect, it, vi } from "vitest";
import { changeNewsPostStatus, editNewsPost } from "@/lib/news/news-management";
import type { NewsDraft } from "@/lib/news/news-posts";
import { publishNewsPostWithUploads } from "@/lib/news/news-uploads";
import {
  type FakeAttachmentClub,
  type FakeAttachmentClubOptions,
  fakeAttachmentClub,
} from "../helpers/news-attachments-club";
import {
  CALLER_ID,
  CLUB_ID,
  INSERTED_POST_ID,
  MASTERS_SQUAD_ID,
  SENIOR_SQUAD_ID,
  aPost,
} from "../helpers/news-club";

/**
 * El aviso a la audiencia cuando se publica algo (#332, RF-7 del PRD de E11,
 * FR-061). Va por la puerta única de avisos, después de guardar, y su fallo
 * nunca tumba la publicación. Editar y volver a publicar no avisan (D2).
 */

const ANA = "a1000000-0000-4000-8000-000000000001";
const BEA = "b2000000-0000-4000-8000-000000000002";
const CARO = "c3000000-0000-4000-8000-000000000003";

const DRAFT: NewsDraft = {
  category: "announcement",
  title: "Cambia la piscina",
  body: "El martes entrenamos en MSAC.",
  audience: { kind: "club" },
};

const CLUB_MEMBERS = {
  [CALLER_ID]: "active",
  [ANA]: "active",
  [BEA]: "active",
  [CARO]: "active",
} as const;

function publishingClub(
  options: FakeAttachmentClubOptions = {},
): FakeAttachmentClub {
  return fakeAttachmentClub({
    callerRole: "Committee",
    clubMembers: CLUB_MEMBERS,
    ...options,
  });
}

function publish(
  club: FakeAttachmentClub,
  draft: NewsDraft = DRAFT,
): ReturnType<typeof publishNewsPostWithUploads> {
  return publishNewsPostWithUploads(club.gateways, {
    callerId: CALLER_ID,
    draft,
    uploadIds: [],
    now: new Date(),
  });
}

function toGroups(...groupIds: string[]): NewsDraft {
  return { ...DRAFT, audience: { kind: "groups", groupIds } };
}

function notifiedIn(club: FakeAttachmentClub): string[] {
  return club.notices.map((notice) => notice.userId);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aviso de publicación nueva", () => {
  it("avisa a todo el club menos a quien publica", async () => {
    const club = publishingClub();

    await publish(club);

    expect(notifiedIn(club)).toEqual([ANA, BEA, CARO]);
  });

  it("guarda la publicación, su categoría y su título como datos del aviso", async () => {
    const club = publishingClub();

    await publish(club);

    expect(club.notices[0]).toEqual({
      clubId: CLUB_ID,
      userId: ANA,
      type: "news_post_published",
      data: {
        postId: INSERTED_POST_ID,
        category: "announcement",
        title: "Cambia la piscina",
      },
    });
  });

  it("avisa sólo a los miembros de los grupos elegidos", async () => {
    const club = publishingClub({
      groupMembers: { [SENIOR_SQUAD_ID]: [ANA], [MASTERS_SQUAD_ID]: [BEA] },
    });

    await publish(club, toGroups(SENIOR_SQUAD_ID));

    expect(notifiedIn(club)).toEqual([ANA]);
  });

  it("avisa una sola vez a quien está en dos de los grupos elegidos", async () => {
    const club = publishingClub({
      groupMembers: {
        [SENIOR_SQUAD_ID]: [ANA, BEA],
        [MASTERS_SQUAD_ID]: [ANA, CARO],
      },
    });

    await publish(club, toGroups(SENIOR_SQUAD_ID, MASTERS_SQUAD_ID));

    expect(notifiedIn(club)).toEqual([ANA, BEA, CARO]);
  });

  it("no avisa a quien publica aunque esté en un grupo elegido", async () => {
    const club = publishingClub({
      groupMembers: { [SENIOR_SQUAD_ID]: [CALLER_ID, ANA] },
    });

    await publish(club, toGroups(SENIOR_SQUAD_ID));

    expect(notifiedIn(club)).toEqual([ANA]);
  });

  it("no avisa a un miembro dado de baja", async () => {
    const club = publishingClub({
      clubMembers: { ...CLUB_MEMBERS, [BEA]: "inactive" },
    });

    await publish(club);

    expect(notifiedIn(club)).toEqual([ANA, CARO]);
  });
});

describe("aviso que falla", () => {
  it("si falla un aviso, los demás llegan y la publicación se guarda igual", async () => {
    const club = publishingClub({ failNoticeFor: [BEA] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const post = await publish(club);

    expect(post.id).toBe(INSERTED_POST_ID);
    expect(club.deletedPostIds).toEqual([]);
    expect(notifiedIn(club)).toEqual([ANA, CARO]);
  });

  it("deja en el log el aviso que no se guardó", async () => {
    const club = publishingClub({ failNoticeFor: [BEA] });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await publish(club);

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("aviso sin guardar"),
      expect.objectContaining({ recipientUserId: BEA }),
    );
  });

  it("si falla la lectura de la audiencia, la publicación se guarda igual y el fallo queda en el log", async () => {
    const club = publishingClub({ failAudience: true });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const post = await publish(club);

    expect(post.id).toBe(INSERTED_POST_ID);
    expect(club.deletedPostIds).toEqual([]);
    expect(club.notices).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(INSERTED_POST_ID),
      expect.any(Error),
    );
  });
});

describe("cuándo no se avisa", () => {
  const POST_ID = "d3d3d3d3-0000-4000-8000-00000000000d";
  const ownPost = aPost({
    id: POST_ID,
    author: { id: CALLER_ID, fullName: "Quien llama" },
  });

  it("al editar una publicación", async () => {
    const club = publishingClub({ posts: [ownPost] });

    await editNewsPost(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      draft: DRAFT,
      expectedEditedAt: null,
      now: new Date(),
    });

    expect(club.notices).toEqual([]);
  });

  it("al volver a publicar una retirada", async () => {
    const club = publishingClub({
      posts: [{ ...ownPost, status: "withdrawn" }],
    });

    await changeNewsPostStatus(club.gateways, {
      callerId: CALLER_ID,
      postId: POST_ID,
      status: "published",
    });

    expect(club.notices).toEqual([]);
  });
});
