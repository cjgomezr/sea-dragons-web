import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import {
  InvalidSessionVideoUrlError,
  SessionVideoEventCancelledError,
  SessionVideoForbiddenError,
  removeSessionVideo,
  setSessionVideo,
} from "@/lib/events/session-video";
import {
  CLUB_VIDEO_EVENT as CLUB_EVENT,
  SENIOR_VIDEO_EVENT as SENIOR_EVENT,
  VIDEO_CALLER_ID as CALLER_ID,
  VIDEO_EVENT_ID as EVENT_ID,
  VIDEO_OTHER_CLUB_ID as OTHER_CLUB_ID,
  VIDEO_SENIOR_EVENT_ID as SENIOR_EVENT_ID,
  VIDEO_SENIOR_SQUAD_ID as SENIOR_SQUAD_ID,
  VIDEO_URL as VIDEO,
  fakeVideoClub as fakeClub,
} from "../helpers/session-video-club";

/**
 * Poner y quitar el vídeo de una sesión (#965, RF-4 y D8 del PRD de E37),
 * contado sin Supabase delante. Lo hacen Admin, Committee y Coach; el Coach
 * sólo en los eventos que ve, que son los de su audiencia.
 */

describe("setSessionVideo", () => {
  it.each(["Admin", "Committee", "Coach"] as const)(
    "guarda el enlace recortado que pone un %s",
    async (role) => {
      const club = fakeClub({ role });

      const video = await setSessionVideo(club.gateways, {
        callerId: CALLER_ID,
        eventId: EVENT_ID,
        url: `  ${VIDEO} `,
      });

      expect(video).toEqual({ eventId: EVENT_ID, url: VIDEO });
      expect(club.videos.get(EVENT_ID)).toBe(VIDEO);
    },
  );

  it("cambia el enlace de una sesión que ya tenía vídeo", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, videoUrl: VIDEO }],
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: "https://www.youtube.com/watch?v=xyz789",
    });

    expect(club.videos.get(EVENT_ID)).toBe(
      "https://www.youtube.com/watch?v=xyz789",
    );
  });

  it("sólo pone el vídeo en la sesión pedida", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [CLUB_EVENT, SENIOR_EVENT],
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    expect(club.videos.get(SENIOR_EVENT_ID)).toBeNull();
  });

  it("niega a un Player con un 403, antes de mirar el evento", async () => {
    const club = fakeClub({ role: "Player" });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    await expect(result).rejects.toBeInstanceOf(SessionVideoForbiddenError);
    expect(club.videos.get(EVENT_ID)).toBeNull();
  });

  it("dice que no existe un evento de otro club", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, clubId: OTHER_CLUB_ID }],
    });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("dice que no existe un evento que no existe", async () => {
    const club = fakeClub({ role: "Admin", events: [] });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("dice a un Coach que no existe un evento fuera de su audiencia", async () => {
    const club = fakeClub({ role: "Coach", events: [SENIOR_EVENT] });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: SENIOR_EVENT_ID,
      url: VIDEO,
    });

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
    expect(club.videos.get(SENIOR_EVENT_ID)).toBeNull();
  });

  it("deja a un Coach del grupo de la audiencia", async () => {
    const club = fakeClub({
      role: "Coach",
      callerGroupIds: [SENIOR_SQUAD_ID],
      events: [SENIOR_EVENT],
    });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: SENIOR_EVENT_ID,
      url: VIDEO,
    });

    expect(club.videos.get(SENIOR_EVENT_ID)).toBe(VIDEO);
  });

  it("deja a un Committee un evento de grupos aunque no sea de ellos", async () => {
    const club = fakeClub({ role: "Committee", events: [SENIOR_EVENT] });

    await setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: SENIOR_EVENT_ID,
      url: VIDEO,
    });

    expect(club.videos.get(SENIOR_EVENT_ID)).toBe(VIDEO);
  });

  it("rechaza poner vídeo a un evento cancelado", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, status: "cancelled" }],
    });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    await expect(result).rejects.toBeInstanceOf(
      SessionVideoEventCancelledError,
    );
    expect(club.videos.get(EVENT_ID)).toBeNull();
  });

  it("rechaza un enlace que no es de un vídeo de YouTube, con el motivo", async () => {
    const club = fakeClub({ role: "Admin" });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: "https://www.youtube.com/@club",
    });

    await expect(result).rejects.toMatchObject({
      name: InvalidSessionVideoUrlError.name,
      issue: "not_youtube_video",
    });
    expect(club.videos.get(EVENT_ID)).toBeNull();
  });

  it("falla si quien llama no tiene ficha", async () => {
    const club = fakeClub({ role: null });

    const result = setSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
      url: VIDEO,
    });

    await expect(result).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("removeSessionVideo", () => {
  it("quita el vídeo de la sesión", async () => {
    const club = fakeClub({
      role: "Coach",
      events: [{ ...CLUB_EVENT, videoUrl: VIDEO }],
    });

    await removeSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
    });

    expect(club.videos.get(EVENT_ID)).toBeNull();
  });

  it("no falla si la sesión no tenía vídeo", async () => {
    const club = fakeClub({ role: "Admin" });

    await expect(
      removeSessionVideo(club.gateways, {
        callerId: CALLER_ID,
        eventId: EVENT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("deja quitar el vídeo de un evento cancelado", async () => {
    const club = fakeClub({
      role: "Committee",
      events: [{ ...CLUB_EVENT, status: "cancelled", videoUrl: VIDEO }],
    });

    await removeSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
    });

    expect(club.videos.get(EVENT_ID)).toBeNull();
  });

  it("niega a un Player con un 403", async () => {
    const club = fakeClub({
      role: "Player",
      events: [{ ...CLUB_EVENT, videoUrl: VIDEO }],
    });

    const result = removeSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
    });

    await expect(result).rejects.toBeInstanceOf(SessionVideoForbiddenError);
    expect(club.videos.get(EVENT_ID)).toBe(VIDEO);
  });

  it("dice que no existe un evento de otro club", async () => {
    const club = fakeClub({
      role: "Admin",
      events: [{ ...CLUB_EVENT, clubId: OTHER_CLUB_ID, videoUrl: VIDEO }],
    });

    const result = removeSessionVideo(club.gateways, {
      callerId: CALLER_ID,
      eventId: EVENT_ID,
    });

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
    expect(club.videos.get(EVENT_ID)).toBe(VIDEO);
  });
});
