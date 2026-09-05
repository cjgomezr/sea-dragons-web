import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuditClubMismatchError,
  createSupabaseAuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import {
  readSupabaseConfig,
  readSupabaseServiceRoleConfig,
} from "@/lib/supabase/config";

// Sin arnés reutilizable todavía (#21 lo construye reusando esta tabla): este
// archivo monta y desmonta su propio usuario autenticado de prueba.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Sin .env.local (p. ej. en la nube sin secrets configurados): seguimos con
  // lo que ya haya en process.env, y el skip de abajo avisa qué falta.
}

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

const TEST_TIMEOUT_MS = 20_000;

describe.skipIf(!hasCredentials)("audit_log: RLS y concurrencia", () => {
  let serviceClient: SupabaseClient;
  let asAuthenticatedUser: SupabaseClient;
  let clubId: string;
  let testUserId: string;
  let testUserEmail: string;

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

    const { data: club, error: clubError } = await serviceClient
      .from("clubs")
      .select("id")
      .limit(1)
      .single();
    if (clubError || !club) {
      throw new Error(
        `No se pudo leer un club de prueba: ${clubError?.message ?? "sin filas"}`,
      );
    }
    clubId = club.id as string;

    testUserEmail = `audit-log-rls-${randomUUID()}@example.test`;
    const password = randomBytes(18).toString("base64url");
    const { data: created, error: createError } =
      await serviceClient.auth.admin.createUser({
        email: testUserEmail,
        password,
        email_confirm: true,
      });
    if (createError || !created.user) {
      throw new Error(
        `No se pudo crear el usuario de prueba: ${createError?.message}`,
      );
    }
    testUserId = created.user.id;

    const anonClient = createClient(
      supabaseConfig.url,
      supabaseConfig.anonKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: session, error: signInError } =
      await anonClient.auth.signInWithPassword({
        email: testUserEmail,
        password,
      });
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
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (testUserId) {
      await serviceClient.auth.admin.deleteUser(testUserId);
    }
  }, TEST_TIMEOUT_MS);

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

      expect(error).toBeNull();
      expect(data).toEqual([]);
    },
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
      expect(writtenAt).toBeGreaterThanOrEqual(before - 1000);
      expect(writtenAt).toBeLessThanOrEqual(Date.now() + 1000);
    },
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
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
    TEST_TIMEOUT_MS,
  );
});
