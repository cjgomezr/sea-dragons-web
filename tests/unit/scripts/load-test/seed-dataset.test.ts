import { describe, expect, it } from "vitest";
import {
  generateSeedDataset,
  GROUP_COUNT,
  LOGIN_IDENTITY_COUNT,
  NEWS_POST_COUNT,
  type SeedDataset,
} from "../../../../scripts/load-test/seed-dataset";

/** Los mínimos de NFR-008. */
const MIN_MEMBERS = 500;
const MIN_OCCURRENCES = 5_000;
const MIN_ATTENDANCE = 50_000;

const ANCHOR_DATE = "2026-10-08";
const MAX_SERIES_DAYS = 366;

// Generar el dataset completo cuesta lo suyo: una vez para todo el archivo.
const dataset: SeedDataset = generateSeedDataset({
  seed: 524,
  anchorDate: ANCHOR_DATE,
});

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function isoWeekday(date: string): number {
  const sunday = 0;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === sunday ? 7 : day;
}

describe("generateSeedDataset: determinism", () => {
  it("returns the same data for the same seed and anchor date", () => {
    const again = generateSeedDataset({ seed: 524, anchorDate: ANCHOR_DATE });

    expect(again).toEqual(dataset);
  });

  it("returns different data for a different seed", () => {
    const other = generateSeedDataset({ seed: 525, anchorDate: ANCHOR_DATE });

    expect(other.members.map((member) => member.userId)).not.toEqual(
      dataset.members.map((member) => member.userId),
    );
  });
});

describe("generateSeedDataset: NFR-008 sizes", () => {
  it("has at least 500 members", () => {
    expect(dataset.members.length).toBeGreaterThanOrEqual(MIN_MEMBERS);
  });

  it("has at least 5,000 event occurrences", () => {
    expect(dataset.events.length).toBeGreaterThanOrEqual(MIN_OCCURRENCES);
  });

  it("has at least 50,000 attendance records", () => {
    expect(dataset.attendance.length).toBeGreaterThanOrEqual(MIN_ATTENDANCE);
  });
});

describe("generateSeedDataset: attendance", () => {
  const eventsById = new Map(dataset.events.map((event) => [event.id, event]));
  const memberIds = new Set(dataset.members.map((member) => member.userId));

  it("only points at past occurrences", () => {
    const future = dataset.attendance.filter(
      (record) => eventsById.get(record.eventId)!.startsOn >= ANCHOR_DATE,
    );

    expect(future).toEqual([]);
  });

  it("only points at existing trainings", () => {
    const notTraining = dataset.attendance.filter(
      (record) => eventsById.get(record.eventId)?.eventType !== "training",
    );

    expect(notTraining).toEqual([]);
  });

  it("only points at members of the club", () => {
    const strangers = dataset.attendance.filter(
      (record) =>
        !memberIds.has(record.userId) || !memberIds.has(record.recordedBy),
    );

    expect(strangers).toEqual([]);
  });

  it("records each member at most once per occurrence", () => {
    const keys = dataset.attendance.map(
      (record) => `${record.eventId}:${record.userId}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("generateSeedDataset: login identities", () => {
  const identities = dataset.members.filter((member) => member.canSignIn);
  const countByRole = (role: string): number =>
    identities.filter((member) => member.role === role).length;

  it("has 50 identities that can sign in", () => {
    expect(identities).toHaveLength(LOGIN_IDENTITY_COUNT);
  });

  it("makes most of them Players", () => {
    expect(countByRole("Player")).toBeGreaterThan(LOGIN_IDENTITY_COUNT / 2);
  });

  it("includes at least one Coach, Committee and Admin", () => {
    expect(countByRole("Coach")).toBeGreaterThan(0);
    expect(countByRole("Committee")).toBeGreaterThan(0);
    expect(countByRole("Admin")).toBeGreaterThan(0);
  });

  it("gives every member a unique email", () => {
    const emails = dataset.members.map((member) => member.email);

    expect(new Set(emails).size).toBe(emails.length);
  });
});

describe("generateSeedDataset: the rest of the club", () => {
  const futureEvents = dataset.events.filter(
    (event) => event.startsOn > ANCHOR_DATE,
  );

  it("has the named number of groups, and every member is in one", () => {
    const grouped = new Set(
      dataset.groupMemberships.map((membership) => membership.userId),
    );

    expect(dataset.groups).toHaveLength(GROUP_COUNT);
    expect(grouped.size).toBe(dataset.members.length);
  });

  it("has RSVPs on half of the future occurrences and none in the past", () => {
    const answered = new Set(dataset.rsvps.map((rsvp) => rsvp.eventId));
    const answeredFuture = futureEvents.filter((event) =>
      answered.has(event.id),
    );

    expect(answeredFuture).toHaveLength(Math.ceil(futureEvents.length / 2));
    expect(answered.size).toBe(answeredFuture.length);
  });

  it("has the named number of news posts, all published in the past", () => {
    const fromTheFuture = dataset.newsPosts.filter(
      (post) => post.publishedAt.slice(0, 10) > ANCHOR_DATE,
    );

    expect(dataset.newsPosts).toHaveLength(NEWS_POST_COUNT);
    expect(fromTheFuture).toEqual([]);
  });

  it("gives every member notifications and a membership", () => {
    const notified = new Set(dataset.notifications.map((n) => n.userId));

    expect(notified.size).toBe(dataset.members.length);
    expect(dataset.memberships).toHaveLength(dataset.members.length);
  });

  it("evaluates most Players and nobody twice", () => {
    const players = dataset.members.filter((m) => m.role === "Player");
    const evaluated = new Set(dataset.evaluations.map((e) => e.userId));

    expect(evaluated.size).toBe(dataset.evaluations.length);
    expect(evaluated.size).toBeGreaterThan(players.length / 2);
  });

  it("keeps every series within one year, on its own weekdays", () => {
    const seriesById = new Map(dataset.series.map((s) => [s.id, s]));
    const tooLong = dataset.series.filter(
      (s) => daysBetween(s.startsOn, s.endsOn) >= MAX_SERIES_DAYS,
    );
    const offPattern = dataset.events.filter((event) => {
      const series = seriesById.get(event.seriesId)!;
      return (
        !series.weekdays.includes(isoWeekday(event.startsOn)) ||
        event.startsOn < series.startsOn ||
        event.startsOn > series.endsOn
      );
    });

    expect(tooLong).toEqual([]);
    expect(offPattern).toEqual([]);
  });

  it("uses unique ids across every table", () => {
    const ids = [
      ...dataset.members.map((m) => m.userId),
      ...dataset.groups.map((g) => g.id),
      ...dataset.series.map((s) => s.id),
      ...dataset.events.map((e) => e.id),
      ...dataset.newsPosts.map((p) => p.id),
      ...dataset.notifications.map((n) => n.id),
      ...dataset.evaluations.map((e) => e.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
