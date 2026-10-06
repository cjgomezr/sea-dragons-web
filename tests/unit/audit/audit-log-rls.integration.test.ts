import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuditClubMismatchError,
  createSupabaseAuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import { DEFAULT_CLUB_SLUG } from "@/lib/auth/supabase-auth-gateways";
import {
  readSupabaseConfig,
  readSupabaseServiceRoleConfig,
} from "@/lib/supabase/config";
import {
  createServiceRoleTestClient,
  leaseTestUser,
  RLS_NETWORK_TEST_TIMEOUT_MS,
} from "../../support/rls";

// Este archivo monta sus propios clientes en vez de usar `describeRls`; el
// usuario autenticado sí sale de la reserva de `tests/support/rls.ts`.
// `.env.local` ya está cargado y verificado contra el proyecto de
// desarrollo por `vitest.setup.ts`, que corre antes que este archivo.

const supabaseConfig = readSupabaseConfig(process.env);
const serviceRoleConfig = readSupabaseServiceRoleConfig(process.env);
const hasCredentials =
  supabaseConfig.kind === "configured" &&
  serviceRoleConfig.kind === "configured";

if (!hasCredentials) {
  const missingKeys = new Set([
    ...(supabaseConfig.kind === "missing" ? supabaseConfig.missingKeys : []),
    ...(serviceRoleConfig.kind === "missing"
      ? serviceRoleConfig.missingKeys
      : []),
  ]);
  console.warn(
    `⚠ audit_log RLS/concurrencia: tests saltados, faltan variables: ${[...missingKeys].join(", ")}`,
  );
}

/**
 * La marca de tiempo la pone Postgres, así que esta comprobación enfrenta el
 * reloj del servidor de Supabase con el de esta máquina. Un segundo de margen
 * no aguantaba la deriva normal de NTP: se midieron 1623 ms de diferencia y el
 * test caía siempre, sin que hubiera nada roto en lo que prueba.
 *
 * Lo que se verifica es que la fila la escribe el servidor con SU hora, no el
 * cliente con la suya. Cinco minutos siguen delatando una marca absurda (el
 * epoch, o el futuro lejano) y dejan de castigar un reloj desincronizado.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** `insufficient_privilege` de Postgres: lo que responde PostgREST cuando el
 * rol no tiene el privilegio sobre la tabla. */
const PERMISSION_DENIED_CODE = "42501";

describe.skipIf(!hasCredentials)("audit_log: RLS y concurrencia", () => {
  let serviceClient: SupabaseClient;
  let asAuthenticatedUser: SupabaseClient;
  let clubId: string;
  let testUserId: string;
  let releaseTestUser: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    if (
      supabaseConfig.kind !== "configured" ||
      serviceRoleConfig.kind !== "configured"
    ) {
      throw new Error("unreachable: describe.skipIf ya saltó la suite");
    }

    // `persistSession: false` en los tres clientes: comparten el mismo
    // storage de auth (misma URL de proyecto) y sin esto la sesión iniciada
    // más abajo termina pisando las cabeceras de los otros dos.
    serviceClient = createClient(
      serviceRoleConfig.url,
      serviceRoleConfig.serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Por `slug`, no "el primer club que salga": `seadragons-dev` acumula
    // clubes efímeros que otras suites crean y borran, y si a esta le tocaba
    // uno de ésos mientras su dueña lo borraba, las escrituras de abajo caían
    // por clave foránea (23503). El club de la instalación no lo borra nadie.
    const { data: club, error: clubError } = await serviceClient
      .from("clubs")
      .select("id")
      .eq("slug", DEFAULT_CLUB_SLUG)
      .single();
    if (clubError || !club) {
      throw new Error(
        `No se pudo leer el club ${DEFAULT_CLUB_SLUG}: ${clubError?.message ?? "sin filas"}`,
      );
    }
    clubId = club.id as string;

    // El usuario sale de la reserva de socios de prueba (#415): crear uno
    // por corrida contaba como usuario del mes en Supabase aunque se borrara.
    const lease = await leaseTestUser(createServiceRoleTestClient(process.env));
    releaseTestUser = lease.release;
    testUserId = lease.user.id;
    const { email, password } = lease.user;

    const anonClient = createClient(
      supabaseConfig.url,
      supabaseConfig.anonKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: session, error: signInError } =
      await anonClient.auth.signInWithPassword({ email, password });
    if (signInError || !session.session) {
      throw new Error(
        `No se pudo autenticar al usuario de prueba: ${signInError?.message}`,
      );
    }

    asAuthenticatedUser = createClient(
      supabaseConfig.url,
      supabaseConfig.anonKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: `Bearer ${session.session.access_token}`,
          },
        },
      },
    );
  }, RLS_NETWORK_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await releaseTestUser?.();
  }, RLS_NETWORK_TEST_TIMEOUT_MS);

  it(
    "un usuario autenticado que no es Admin no recibe ninguna fila",
    async () => {
      const { error: insertError } = await serviceClient
        .from("audit_log")
        .insert({
          club_id: clubId,
          actor_id: randomUUID(),
          action: "auth.login_succeeded",
          entity_type: "user",
          entity_id: randomUUID(),
          result: "success",
        });
      expect(insertError).toBeNull();

      const { data, error } = await asAuthenticatedUser
        .from("audit_log")
        .select("*");

      // `0004` le quitó a `authenticated` el `select` sobre la bitácora, así
      // que la negación llega como error de permiso. Una base anterior a esa
      // migración la negaba con la policy, devolviendo cero filas. Las dos
      // formas niegan; lo único que no puede pasar es recibir filas.
      if (error !== null) {
        expect(error.code).toBe(PERMISSION_DENIED_CODE);
        return;
      }
      expect(data).toEqual([]);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un usuario autenticado no puede actualizar ni borrar filas",
    async () => {
      const { data: row, error: insertError } = await serviceClient
        .from("audit_log")
        .insert({
          club_id: clubId,
          actor_id: randomUUID(),
          action: "auth.login_succeeded",
          entity_type: "user",
          entity_id: randomUUID(),
          result: "success",
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      // Sin policy de update/delete, RLS no responde con un error HTTP: el
      // `where` de la operación no ve ninguna fila y la deja intacta. Por eso
      // el rechazo se comprueba releyendo la fila con el cliente de
      // servicio, no mirando el campo `error` de la respuesta.
      await asAuthenticatedUser
        .from("audit_log")
        .update({ result: "failure" })
        .eq("id", row!.id as string);

      const { data: afterUpdate } = await serviceClient
        .from("audit_log")
        .select("result")
        .eq("id", row!.id as string)
        .single();
      expect(afterUpdate?.result).toBe("success");

      await asAuthenticatedUser
        .from("audit_log")
        .delete()
        .eq("id", row!.id as string);

      const { data: afterDelete } = await serviceClient
        .from("audit_log")
        .select("id")
        .eq("id", row!.id as string)
        .single();
      expect(afterDelete?.id).toBe(row!.id);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "recordAuditEvent escribe exactamente una fila con la marca de tiempo del servidor",
    async () => {
      const writer = createSupabaseAuditLogWriter(serviceClient);
      const entityId = randomUUID();
      const before = Date.now();

      await recordAuditEvent(writer, {
        actor: { id: testUserId, clubId },
        clubId,
        action: "role.changed",
        entityType: "membership",
        entityId,
        result: "success",
      });

      const { data, error } = await serviceClient
        .from("audit_log")
        .select("*")
        .eq("entity_id", entityId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0]!;
      expect(row.club_id).toBe(clubId);
      expect(row.actor_id).toBe(testUserId);
      const writtenAt = new Date(row.created_at as string).getTime();
      expect(writtenAt).toBeGreaterThanOrEqual(
        before - CLOCK_SKEW_TOLERANCE_MS,
      );
      expect(writtenAt).toBeLessThanOrEqual(
        Date.now() + CLOCK_SKEW_TOLERANCE_MS,
      );
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "la escritura queda acotada al club del actor: un intento para otro club no llega a la base",
    async () => {
      const writer = createSupabaseAuditLogWriter(serviceClient);
      const entityId = randomUUID();
      const otherClubId = randomUUID();

      await expect(
        recordAuditEvent(writer, {
          actor: { id: testUserId, clubId },
          clubId: otherClubId,
          action: "role.changed",
          entityType: "membership",
          entityId,
          result: "success",
        }),
      ).rejects.toBeInstanceOf(AuditClubMismatchError);

      const { data, error } = await serviceClient
        .from("audit_log")
        .select("*")
        .eq("entity_id", entityId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "dos escrituras simultáneas del mismo actor producen dos filas",
    async () => {
      const writer = createSupabaseAuditLogWriter(serviceClient);
      const runTag = randomUUID();

      await Promise.all([
        recordAuditEvent(writer, {
          actor: { id: testUserId, clubId },
          clubId,
          action: "auth.login_succeeded",
          entityType: "user",
          entityId: runTag,
          result: "success",
          metadata: { attempt: 1 },
        }),
        recordAuditEvent(writer, {
          actor: { id: testUserId, clubId },
          clubId,
          action: "auth.login_succeeded",
          entityType: "user",
          entityId: runTag,
          result: "success",
          metadata: { attempt: 2 },
        }),
      ]);

      const { data, error } = await serviceClient
        .from("audit_log")
        .select("*")
        .eq("entity_id", runTag);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
