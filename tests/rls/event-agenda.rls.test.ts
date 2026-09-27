import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import {
  AGENDA_PAGE_SIZE,
  type AgendaQuery,
  listAgenda,
  openEvent,
} from "@/lib/events/event-agenda";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import { createEventAgendaGateways } from "@/lib/events/supabase-event-agenda-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../support/rls";

/**
 * La agenda y el detalle contra `seadragons-dev` con el adaptador real
 * (#309). Lo que sólo una base de verdad puede afirmar: que la consulta
 * aplica la audiencia y el periodo, que los conteos y los nombres dejan
 * fuera a quien salió de la audiencia o está dado de baja, y que una página
 * de 50 cuesta una sola llamada de conteos. Quién cuenta, regla por regla,
 * está en `tests/unit/supabase/event-rsvp-tallies-migration.test.ts`.
 *
 * Los eventos se siembran en 2099 y la consulta se hace con ese "hoy", para
 * que lo que ya tenga el club en dev no se cuele en la página.
 */

const FAR_DAY = "2099-03-02";
const NEXT_FAR_DAY = "2099-03-03";
const TALLIES_RPC_PATH = "/rpc/event_rsvp_tallies";

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", "victoria-seadragons")
    .single();
  if (error || !data) {
    throw new Error(
      `No se pudo leer el club sembrado: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.id as string;
}

/** Una identidad activa con su fila de miembro, deshecha al terminar. */
function withMember<T>(
  serviceClient: ServiceRoleClient,
  member: { readonly clubId: string; readonly fullName: string },
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withTestUser(serviceClient, (user) =>
    withSeededRows(
      serviceClient,
      "members",
      [
        {
          club_id: member.clubId,
          user_id: user.id,
          full_name: member.fullName,
          email: user.email,
          account_status: "active",
        },
      ],
      () => run(user),
    ),
  );
}

async function insertRows(
  serviceClient: ServiceRoleClient,
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const { error } = await serviceClient.client.from(table).insert(rows);
  if (error) {
    throw new Error(`No se pudo sembrar ${table}: ${error.message}`);
  }
}

function eventRow(
  author: { readonly clubId: string; readonly userId: string },
  fields: {
    readonly startsOn: string;
    readonly title: string;
    readonly audience: "all" | "groups";
  },
): Record<string, unknown> {
  return {
    club_id: author.clubId,
    title: fields.title,
    event_type: "training",
    starts_on: fields.startsOn,
    start_time: "19:00",
    location: "MSAC",
    audience: fields.audience,
    author_id: author.userId,
  };
}

type AgendaWorld = {
  readonly serviceClient: ServiceRoleClient;
  readonly clubId: string;
  readonly groupId: string;
  readonly groupEventId: string;
  readonly clubEventId: string;
  readonly insider: TestUser;
  readonly outsider: TestUser;
};

/**
 * Un grupo con tres miembros (Rita, Bea y Carla) y un cuarto fuera (Dani).
 * Un evento para el grupo al que responden los cuatro, y Carla está dada de
 * baja después; y otro para todo el club, el día siguiente.
 */
async function withAgendaWorld(
  run: (world: AgendaWorld) => Promise<void>,
): Promise<void> {
  const serviceClient = createServiceRoleTestClient(process.env);
  const clubId = await seededClubId(serviceClient);
  const member = (fullName: string) => ({ clubId, fullName });
  await withMember(serviceClient, member("Rita Agenda"), (insider) =>
    withMember(serviceClient, member("Bea Agenda"), (bea) =>
      withMember(serviceClient, member("Carla Agenda"), (carla) =>
        withMember(serviceClient, member("Dani Agenda"), (outsider) =>
          withSeededRows(
            serviceClient,
            "groups",
            [{ club_id: clubId, name: `Agenda ${randomUUID().slice(0, 8)}` }],
            async ([group]) => {
              const groupId = group?.id as string;
              await insertRows(
                serviceClient,
                "group_memberships",
                [insider, bea, carla].map((user) => ({
                  group_id: groupId,
                  user_id: user.id,
                  club_id: clubId,
                })),
              );
              const author = { clubId, userId: insider.id };
              await withSeededRows(
                serviceClient,
                "events",
                [
                  eventRow(author, {
                    startsOn: FAR_DAY,
                    title: "Del grupo",
                    audience: "groups",
                  }),
                  eventRow(author, {
                    startsOn: NEXT_FAR_DAY,
                    title: "De todo el club",
                    audience: "all",
                  }),
                ],
                async ([groupEvent, clubEvent]) => {
                  const groupEventId = groupEvent?.id as string;
                  await insertRows(serviceClient, "event_groups", [
                    {
                      event_id: groupEventId,
                      group_id: groupId,
                      club_id: clubId,
                    },
                  ]);
                  await insertRows(
                    serviceClient,
                    "event_rsvps",
                    [
                      [insider, "yes"],
                      [bea, "maybe"],
                      [carla, "yes"],
                      [outsider, "yes"],
                    ].map(([user, response]) => ({
                      event_id: groupEventId,
                      user_id: (user as TestUser).id,
                      club_id: clubId,
                      response,
                    })),
                  );
                  await serviceClient.client
                    .from("members")
                    .update({ account_status: "inactive" })
                    .eq("user_id", carla.id)
                    .throwOnError();
                  await run({
                    serviceClient,
                    clubId,
                    groupId,
                    groupEventId,
                    clubEventId: clubEvent?.id as string,
                    insider,
                    outsider,
                  });
                },
              );
            },
          ),
        ),
      ),
    ),
  );
}

function farAgendaQuery(
  world: AgendaWorld,
  overrides: Partial<AgendaQuery>,
): AgendaQuery {
  return {
    clubId: world.clubId,
    callerId: world.insider.id,
    visibility: { kind: "club" },
    period: "upcoming",
    today: FAR_DAY,
    after: null,
    limit: AGENDA_PAGE_SIZE,
    ...overrides,
  };
}

/** Un cliente de servicio que apunta cada petición que hace. */
function countingServiceClient(): {
  readonly client: ReturnType<typeof createClient>;
  readonly requestedUrls: string[];
} {
  const config = readSupabaseServiceRoleConfig(process.env);
  if (config.kind === "missing") {
    throw new Error(`Faltan variables: ${config.missingKeys.join(", ")}`);
  }
  const requestedUrls: string[] = [];
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        requestedUrls.push(
          String(input instanceof Request ? input.url : input),
        );
        return fetch(input, init);
      },
    },
  });
  return { client, requestedUrls };
}

describeRls("agenda y detalle contra la base", () => {
  it(
    "la consulta aplica la audiencia de quien no organiza",
    () =>
      withAgendaWorld(async (world) => {
        const gateways = createEventAgendaGateways(world.serviceClient.client);
        const titles = async (groupIds: readonly string[]) =>
          (
            await gateways.agenda.findAgendaPage(
              farAgendaQuery(world, {
                visibility: { kind: "audience", groupIds },
              }),
            )
          ).map((row) => row.title);

        await expect(titles([world.groupId])).resolves.toEqual([
          "Del grupo",
          "De todo el club",
        ]);
        await expect(titles([])).resolves.toEqual(["De todo el club"]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "trae la audiencia con nombres, la respuesta propia y sigue el cursor",
    () =>
      withAgendaWorld(async (world) => {
        const gateways = createEventAgendaGateways(world.serviceClient.client);

        const [first] = await gateways.agenda.findAgendaPage(
          farAgendaQuery(world, { limit: 1 }),
        );
        const rest = await gateways.agenda.findAgendaPage(
          farAgendaQuery(world, {
            after: { startsAt: first?.startsAt ?? "", id: first?.id ?? "" },
          }),
        );

        expect(first).toMatchObject({
          title: "Del grupo",
          startsOn: FAR_DAY,
          startTime: "19:00",
          myResponse: "yes",
          audience: { kind: "groups", groups: [{ id: world.groupId }] },
        });
        expect(rest.map((row) => row.id)).toEqual([world.clubEventId]);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "cuenta y nombra sólo a quien sigue en la audiencia y está activo",
    () =>
      withAgendaWorld(async (world) => {
        const gateways = createEventAgendaGateways(world.serviceClient.client);

        const tallies = await gateways.agenda.countResponses([
          world.groupEventId,
          world.clubEventId,
        ]);
        const detail = await openEvent(gateways, {
          callerId: world.insider.id,
          eventId: world.groupEventId,
        });

        expect(tallies).toEqual([
          { eventId: world.groupEventId, goingCount: 1, maybeCount: 1 },
        ]);
        expect(detail).toMatchObject({
          going: ["Rita Agenda"],
          maybe: ["Bea Agenda"],
          myResponse: "yes",
        });
        expect(detail).not.toHaveProperty("audience");
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "a un Player fuera de la audiencia le responde que el evento no existe",
    () =>
      withAgendaWorld(async (world) => {
        const gateways = createEventAgendaGateways(world.serviceClient.client);

        await expect(
          openEvent(gateways, {
            callerId: world.outsider.id,
            eventId: world.groupEventId,
          }),
        ).rejects.toBeInstanceOf(EventNotFoundError);
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "los conteos de una página de 50 eventos salen de una sola consulta",
    () =>
      withAgendaWorld(async (world) => {
        const author = { clubId: world.clubId, userId: world.insider.id };
        const manyEvents = Array.from({ length: AGENDA_PAGE_SIZE + 1 }, () =>
          eventRow(author, {
            startsOn: FAR_DAY,
            title: "Uno de muchos",
            audience: "all",
          }),
        );
        await withSeededRows(
          world.serviceClient,
          "events",
          manyEvents,
          async () => {
            const counting = countingServiceClient();

            const page = await listAgenda(
              createEventAgendaGateways(counting.client),
              {
                callerId: world.insider.id,
                period: "upcoming",
                now: new Date(),
              },
            );

            expect(page.events).toHaveLength(AGENDA_PAGE_SIZE);
            expect(
              counting.requestedUrls.filter((url) =>
                url.includes(TALLIES_RPC_PATH),
              ),
            ).toHaveLength(1);
          },
        );
      }),
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
