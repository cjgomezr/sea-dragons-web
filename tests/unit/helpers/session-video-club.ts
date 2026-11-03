import type { Role } from "@/lib/auth/roles";
import type {
  SessionVideoEvent,
  SessionVideoGateways,
} from "@/lib/events/session-video";

/**
 * Un club de mentira para el vídeo de una sesión (#965): quien llama, sus
 * grupos y los eventos, con el vídeo de cada uno a la vista.
 */

export const VIDEO_CLUB_ID = "c1c1c1c1-0000-4000-8000-00000000000c";
export const VIDEO_OTHER_CLUB_ID = "c2c2c2c2-0000-4000-8000-00000000000c";
export const VIDEO_CALLER_ID = "a1a1a1a1-0000-4000-8000-00000000000a";
export const VIDEO_EVENT_ID = "e1e1e1e1-0000-4000-8000-00000000000e";
export const VIDEO_SENIOR_EVENT_ID = "e2e2e2e2-0000-4000-8000-00000000000e";
export const VIDEO_SENIOR_SQUAD_ID = "f1f1f1f1-0000-4000-8000-00000000000f";
export const VIDEO_URL = "https://youtu.be/abc123";

export type StoredVideoEvent = SessionVideoEvent & { readonly clubId: string };

export const CLUB_VIDEO_EVENT: StoredVideoEvent = {
  id: VIDEO_EVENT_ID,
  clubId: VIDEO_CLUB_ID,
  status: "scheduled",
  audience: { kind: "club" },
  videoUrl: null,
};

export const SENIOR_VIDEO_EVENT: StoredVideoEvent = {
  ...CLUB_VIDEO_EVENT,
  id: VIDEO_SENIOR_EVENT_ID,
  audience: { kind: "groups", groupIds: [VIDEO_SENIOR_SQUAD_ID] },
};

export type FakeVideoClubOptions = {
  /** Sin ficha con `null`. Coach si no se dice. */
  readonly role?: Role | null;
  readonly callerGroupIds?: readonly string[];
  readonly events?: readonly StoredVideoEvent[];
};

export type FakeVideoClub = {
  readonly gateways: SessionVideoGateways;
  /** El vídeo de cada evento, por id. */
  readonly videos: ReadonlyMap<string, string | null>;
};

export function fakeVideoClub(
  options: FakeVideoClubOptions = {},
): FakeVideoClub {
  const role = options.role === undefined ? "Coach" : options.role;
  const events = options.events ?? [CLUB_VIDEO_EVENT];
  const videos = new Map(events.map((event) => [event.id, event.videoUrl]));
  const gateways: SessionVideoGateways = {
    members: {
      findRoleRequestMember: async () =>
        role === null
          ? null
          : { clubId: VIDEO_CLUB_ID, fullName: "Cami Coach", role },
    },
    memberGroups: {
      listGroupsOf: async () =>
        (options.callerGroupIds ?? []).map((id) => ({ id, name: id })),
    },
    sessionVideos: {
      findEvent: async ({ clubId, eventId }) => {
        const event = events.find(
          (candidate) =>
            candidate.id === eventId && candidate.clubId === clubId,
        );
        return event === undefined
          ? null
          : { ...event, videoUrl: videos.get(event.id) ?? null };
      },
      saveVideo: async ({ eventId, url }) => {
        videos.set(eventId, url);
      },
      removeVideo: async ({ eventId }) => {
        videos.set(eventId, null);
      },
    },
  };
  return { gateways, videos };
}
