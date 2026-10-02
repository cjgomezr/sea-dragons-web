import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { listBuildableEvents } from "@/lib/teams/buildable-events";
import { openMyTeam } from "@/lib/teams/my-team";
import {
  createMyTeamGateways,
  createTeamBuilderGateways,
} from "@/lib/teams/supabase-team-builder-gateways";
import {
  DEFAULT_TEAM_LABELS,
  autoBalanceEventTeams,
  openTeamBuilder,
  saveTeamSplit,
} from "@/lib/teams/team-builder";
import { publishTeamSplit } from "@/lib/teams/team-publication";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  seedCurrentMembership,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * El team builder contra `seadragons-dev` (#401), con los adaptadores de
 * verdad y `0047_team_split_writes.sql` aplicada. Lo que ningún doble dice:
 * que la escuadra sale del RSVP vivo y de las evaluaciones con el esquema real,
 * que la posición trae su función, que guardar y publicar llaman a las
 * funciones con lo que esperan, y que los avisos se crean en la base.
 *
 * Todo corre en un club propio y desechable. Borrar a sus miembros se lleva
 * sus respuestas, sus evaluaciones y sus avisos; borrar el evento, el reparto.
 */

const AUDIT_LOG_TABLE = "audit_log";
const DAY_MS = 86_400_000;
/** Dos días: sigue en el futuro sea cual sea la hora de Melbourne. */
const DAYS_AHEAD = 2;
const GOALKEEPER_COVERAGE = "goalkeeper";
const PIA_RATING = 8;

type Squad = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly eventId: string;
  readonly coach: TestUser;
  readonly pia: TestUser;
  readonly beto: TestUser;
  readonly maya: TestUser;
};

async function succeed(
  what: string,
  query: PromiseLike<{ readonly error: { message: string } | null }>,
): Promise<void> {
  const { error } = await query;
  if (error) {
    throw new Error(`No se pudo ${what}: ${error.message}`);
  }
}

async function withTemporaryClub<T>(
  serviceClient: ServiceRoleClient,
  run: (clubId: string) => Promise<T>,
): Promise<T> {
  return withSeededRows(
    serviceClient,
    "clubs",
    [{ slug: `equipos-${randomUUID()}`, name: "Club de equipos" }],
    async ([club]) => {
      const clubId = String(club?.id);
      try {
        return await run(clubId);
      } finally {
        await succeed(
          "limpiar la bitácora",
          serviceClient.client
            .from(AUDIT_LOG_TABLE)
            .delete()
            .eq("club_id", clubId),
        );
      }
    },
  );
}

async function withActiveMember<T>(
  serviceClient: ServiceRoleClient,
  seed: { readonly clubId: string; readonly role: Role; readonly name: string },
  run: (member: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: seed.clubId,
          user_id: user.id,
          full_name: seed.name,
          email: user.email,
          account_status: "active",
          role: seed.role,
        },
      ],
      async () => {
        await seedCurrentMembership(serviceClient, {
          clubId: seed.clubId,
          userId: user.id,
        });
        return run(user);
      },
    ),
  );
}

async function withUpcomingTraining<T>(
  serviceClient: ServiceRoleClient,
  author: { readonly clubId: string; readonly userId: string },
  run: (eventId: string) => Promise<T>,
): Promise<T> {
  const startsOn = new Date(Date.now() + DAYS_AHEAD * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return withSeededRows(
    serviceClient,
    "events",
    [
      {
        club_id: author.clubId,
        title: "Scrimmage para armar",
        event_type: "training",
        starts_on: startsOn,
        start_time: "10:00",
        location: "MSAC",
        audience: "all",
        author_id: author.userId,
      },
    ],
    ([event]) => run(String(event?.id)),
  );
}

/** Pía, portera con un 8; Beto sin evaluar; los dos dicen Sí. Maya, Quizás. */
async function seedResponsesAndRatings(squad: Squad): Promise<void> {
  const { client } = squad.serviceClient;
  const { data: goalkeeper, error: positionError } = await client
    .from("club_positions")
    .select("id")
    .eq("club_id", squad.clubId)
    .eq("coverage", GOALKEEPER_COVERAGE)
    .single();
  if (positionError) {
    throw new Error(`No se encontró la portería: ${positionError.message}`);
  }
  await succeed(
    "dar la portería a Pía",
    client
      .from("members")
      .update({ position_id: goalkeeper.id })
      .eq("user_id", squad.pia.id),
  );
  await succeed(
    "sembrar las respuestas",
    client.from("event_rsvps").insert(
      [
        [squad.pia, "yes"],
        [squad.beto, "yes"],
        [squad.maya, "maybe"],
      ].map(([member, response]) => ({
        event_id: squad.eventId,
        club_id: squad.clubId,
        user_id: (member as TestUser).id,
        response,
      })),
    ),
  );
  const { data: evaluation, error: evaluationError } = await client
    .from("member_evaluations")
    .insert({ club_id: squad.clubId, user_id: squad.pia.id })
    .select("id")
    .single();
  if (evaluationError) {
    throw new Error(`No se pudo evaluar a Pía: ${evaluationError.message}`);
  }
  const { data: category, error: categoryError } = await client
    .from("evaluation_categories")
    .select("id")
    .eq("club_id", squad.clubId)
    .limit(1)
    .single();
  if (categoryError) {
    throw new Error(`No hay categorías: ${categoryError.message}`);
  }
  await succeed(
    "poner la nota de Pía",
    client.from("member_evaluation_ratings").insert({
      evaluation_id: evaluation.id,
      category_id: category.id,
      club_id: squad.clubId,
      rating: PIA_RATING,
    }),
  );
}

async function withSquad(run: (squad: Squad) => Promise<void>): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const member =
    (clubId: string, role: Role, name: string) =>
    (next: (user: TestUser) => Promise<void>) =>
      withActiveMember(serviceClient, { clubId, role, name }, next);
  await withTemporaryClub(serviceClient, (clubId) =>
    member(
      clubId,
      "Coach",
      "Carla Coach",
    )((coach) =>
      member(
        clubId,
        "Player",
        "Pía Portera",
      )((pia) =>
        member(
          clubId,
          "Player",
          "Beto Base",
        )((beto) =>
          member(
            clubId,
            "Player",
            "Maya Quizás",
          )((maya) =>
            withUpcomingTraining(
              serviceClient,
              { clubId, userId: coach.id },
              async (eventId) => {
                const squad = {
                  serviceClient,
                  clubId,
                  eventId,
                  coach,
                  pia,
                  beto,
                  maya,
                };
                await seedResponsesAndRatings(squad);
                await run(squad);
              },
            ),
          ),
        ),
      ),
    ),
  );
}

describeRls("el team builder en Supabase", () => {
  it(
    "arma la escuadra, balancea, guarda, publica con avisos y el jugador ve su equipo",
    async () => {
      await withSquad(async (squad) => {
        const gateways = createTeamBuilderGateways(squad.serviceClient.client);
        const request = {
          callerId: squad.coach.id,
          eventId: squad.eventId,
          now: new Date(),
        };

        const builder = await openTeamBuilder(gateways, request);
        expect(
          builder.available.map((entry) => [
            entry.fullName,
            entry.rating,
            entry.isUnrated,
            entry.coverage,
          ]),
        ).toEqual([
          ["Beto Base", 5, true, null],
          ["Pía Portera", PIA_RATING, false, GOALKEEPER_COVERAGE],
        ]);
        expect(builder.maybe.map((entry) => entry.fullName)).toEqual([
          "Maya Quizás",
        ]);

        const balanced = await autoBalanceEventTeams(gateways, request);
        expect(balanced.totals.ratingDifference).toBe(3);
        await expect(openTeamBuilder(gateways, request)).resolves.toMatchObject(
          { split: { mode: "auto", publishedAt: null } },
        );

        await saveTeamSplit(gateways, {
          ...request,
          teams: DEFAULT_TEAM_LABELS,
          assignments: [
            { userId: squad.pia.id, team: "a" },
            { userId: squad.maya.id, team: "b" },
          ],
        });

        await expect(
          publishTeamSplit(gateways, request),
        ).resolves.toMatchObject({ assignedCount: 2, notifiedCount: 2 });

        const { data: notices, error } = await squad.serviceClient.client
          .from("notifications")
          .select("user_id, type, data")
          .eq("club_id", squad.clubId)
          .order("user_id");
        expect(error).toBeNull();
        expect(notices).toHaveLength(2);
        expect(notices).toContainEqual({
          user_id: squad.pia.id,
          type: "team_assigned",
          data: expect.objectContaining({
            eventId: squad.eventId,
            teamName: DEFAULT_TEAM_LABELS.a.name,
            teamColor: DEFAULT_TEAM_LABELS.a.color,
          }),
        });

        const piaTeam = await openMyTeam(
          createMyTeamGateways(squad.serviceClient.client),
          { callerId: squad.pia.id, eventId: squad.eventId },
        );
        expect(piaTeam).toMatchObject({
          status: "published",
          me: { team: "a" },
        });
        expect(JSON.stringify(piaTeam)).not.toMatch(/rating/i);

        const { data: audit } = await squad.serviceClient.client
          .from(AUDIT_LOG_TABLE)
          .select("actor_id, action, entity_type, entity_id, metadata")
          .eq("club_id", squad.clubId);
        expect(audit).toEqual([
          {
            actor_id: squad.coach.id,
            action: "team_split.published",
            entity_type: "event",
            entity_id: squad.eventId,
            metadata: { assignedCount: 2 },
          },
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "lista los entrenamientos del club por armar, sin las reuniones ni los cancelados",
    async () => {
      await withSquad(async (squad) => {
        const { data: training } = await squad.serviceClient.client
          .from("events")
          .select("starts_on")
          .eq("id", squad.eventId)
          .single();
        const sameDay = {
          club_id: squad.clubId,
          status: "scheduled",
          starts_on: training?.starts_on,
          start_time: "18:00",
          location: "MSAC",
          audience: "all",
          author_id: squad.coach.id,
        };
        await withSeededRows(
          squad.serviceClient,
          "events",
          [
            { ...sameDay, title: "Reunión", event_type: "meeting" },
            {
              ...sameDay,
              title: "Cancelado",
              event_type: "competition",
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
            },
          ],
          async () => {
            const { events } = await listBuildableEvents(
              createTeamBuilderGateways(squad.serviceClient.client),
              { callerId: squad.coach.id, now: new Date() },
            );

            expect(events).toEqual([
              {
                id: squad.eventId,
                title: "Scrimmage para armar",
                eventType: "training",
                startsOn: training?.starts_on,
                startTime: "10:00",
              },
            ]);
          },
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "deja fuera de la escuadra a quien dejó de estar al día (#453)",
    async () => {
      await withSquad(async (squad) => {
        const { error } = await squad.serviceClient.client
          .from("memberships")
          .update({ status: "past_due" })
          .eq("user_id", squad.maya.id);
        if (error) {
          throw new Error(`No se pudo mover la membresía: ${error.message}`);
        }

        const builder = await openTeamBuilder(
          createTeamBuilderGateways(squad.serviceClient.client),
          { callerId: squad.coach.id, eventId: squad.eventId, now: new Date() },
        );

        expect(builder.maybe).toEqual([]);
        expect(builder.available.map((entry) => entry.fullName)).toEqual([
          "Beto Base",
          "Pía Portera",
        ]);
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
