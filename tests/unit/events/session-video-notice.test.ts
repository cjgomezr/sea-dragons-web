import { afterEach, describe, expect, it, vi } from "vitest";
import {
  removeSessionVideo,
  setSessionVideo,
} from "@/lib/events/session-video";
import {
  CLUB_VIDEO_EVENT as CLUB_EVENT,
  SENIOR_VIDEO_EVENT as SENIOR_EVENT,
  VIDEO_CALLER_ID as CALLER_ID,
  VIDEO_EVENT_ID as EVENT_ID,
  VIDEO_SENIOR_EVENT_ID as SENIOR_EVENT_ID,
  VIDEO_SENIOR_SQUAD_ID as SENIOR_SQUAD_ID,
  VIDEO_URL as VIDEO,
  fakeVideoClub as fakeClub,
} from "../helpers/session-video-club";

/**
 * El aviso en la campana cuando una sesión pasa de no tener vídeo a tenerlo
 * (#966, RF-6, D9 y D10 del PRD de E37). Va a la audiencia del evento sin
 * quien lo puso; cambiar o quitar el enlace no avisa, y un aviso que falla
 * no tumba el vídeo ya guardado.
 */

const PLAYER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const SENIOR_PLAYER_ID = "b2b2b2b2-0000-4000-8000-00000000000b";
const OTHER_VIDEO = "https://www.youtube.com/watch?v=xyz789";

const CLUB_MEMBERS = {
  [CALLER_ID]: "active",
  [PLAYER_ID]: "active",
  [SENIOR_PLAYER_ID]: "active",
} as const;

function recipientsOf(club: ReturnType<typeof fakeClub>): readonly string[] {
  return club.notices.map((notice) => notice.userId).sort();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("el aviso del vídeo de una sesión", () => {
  it("avisa a cada socio del club cuando la sesión no tenía vídeo", async () => {
    const club = fakeClub({ role: "Admin", clubMembers: CLUB_MEMBERS });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    expect(recipientsOf(club)).toEqual([PLAYER_ID, SENIOR_PLAYER_ID].sort());
  });

  it("cuenta la sesión con su título, su día y su hora", async () => {
    const club = fakeClub({ role: "Admin", clubMembers: CLUB_MEMBERS });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    expect(club.notices[0]).toMatchObject({
      type: "event_video_added",
      data: {
        eventId: EVENT_ID,
        title: CLUB_EVENT.title,
        startsOn: CLUB_EVENT.startsOn,
        startTime: CLUB_EVENT.startTime,
      },
    });
  });

  it("avisa sólo a los socios de los grupos de la audiencia", async () => {
    const club = fakeClub({
      role: "Committee",
      events: [SENIOR_EVENT],
      clubMembers: CLUB_MEMBERS,
      groupMembers: { [SENIOR_SQUAD_ID]: [SENIOR_PLAYER_ID] },
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: SENIOR_EVENT_ID,
      url: VIDEO,
    });

    expect(recipientsOf(club)).toEqual([SENIOR_PLAYER_ID]);
  });

  it("no se lo manda a quien puso el vídeo aunque sea de la audiencia", async () => {
    const club = fakeClub({
      role: "Coach",
      events: [SENIOR_EVENT],
      callerGroupIds: [SENIOR_SQUAD_ID],
      clubMembers: CLUB_MEMBERS,
      groupMembers: { [SENIOR_SQUAD_ID]: [CALLER_ID, SENIOR_PLAYER_ID] },
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: SENIOR_EVENT_ID,
      url: VIDEO,
    });

    expect(recipientsOf(club)).toEqual([SENIOR_PLAYER_ID]);
  });

  it("no avisa al cambiar el enlace de una sesión que ya tenía vídeo", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, videoUrl: VIDEO }],
      clubMembers: CLUB_MEMBERS,
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: OTHER_VIDEO,
    });

    expect(club.notices).toEqual([]);
  });

  it("no avisa al quitar el vídeo, aunque el evento esté cancelado", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, status: "cancelled", videoUrl: VIDEO }],
      clubMembers: CLUB_MEMBERS,
    });

    await removeSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
    });

    expect(club.notices).toEqual([]);
  });

  it("vuelve a avisar al poner un vídeo después de quitar el anterior", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, videoUrl: VIDEO }],
      clubMembers: CLUB_MEMBERS,
    });
    await removeSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: OTHER_VIDEO,
    });

    expect(recipientsOf(club)).toEqual([PLAYER_ID, SENIOR_PLAYER_ID].sort());
  });

  it("guarda el vídeo y deja el fallo en el log si el aviso no se puede repartir", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const club = fakeClub({
      role: "Admin",
      clubMembers: CLUB_MEMBERS,
      failAudience: true,
    });

    const video = await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    expect(video).toEqual({ eventId: EVENT_ID, url: VIDEO });
    expect(club.videos.get(EVENT_ID)).toBe(VIDEO);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("event_video_added"),
      expect.any(Error),
    );
  });
});
