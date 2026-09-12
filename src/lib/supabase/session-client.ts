import { type CookieOptions, createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./config";

/**
 * El cliente de Supabase que lleva la sesión del usuario en cookies.
 *
 * Es el único que puede decir quién está pidiendo algo, y usa la llave
 * anónima: quien protege los datos detrás de ella es RLS. El cliente de
 * servicio (`service-client.ts`) salta RLS y no tiene nada que hacer aquí.
 *
 * Las cookies no se escriben solas. Supabase las emite cuando refresca el
 * token o cuando la sesión cambia, y este módulo las apunta para que quien
 * construya la respuesta HTTP las ponga en ella. Perderlas es el bug clásico
 * de este patrón: cierres de sesión al azar y un refresco en cada petición.
 */

export type IncomingCookie = { readonly name: string; readonly value: string };

export type SessionCookie = {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
};

export type SessionCookieRecord = {
  /** Las cookies que Supabase quiere dejar en la respuesta. */
  readonly cookies: readonly SessionCookie[];
  /** Las cabeceras que tienen que viajar con ellas. Supabase las manda para
   * impedir que una CDN cachee una respuesta con `Set-Cookie` de sesión y le
   * sirva la sesión de una persona a otra. */
  readonly headers: Readonly<Record<string, string>>;
};

export type SessionCookieRecorder = {
  recorded(): SessionCookieRecord;
};

export type SessionClientResult =
  | {
      readonly kind: "ready";
      readonly client: SupabaseClient;
      readonly recorder: SessionCookieRecorder;
    }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

type Environment = Readonly<Record<string, string | undefined>>;

export function createSessionClient(
  env: Environment,
  incomingCookies: readonly IncomingCookie[],
): SessionClientResult {
  const config = readSupabaseConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }

  // El único estado mutable del módulo, y vive dentro de una sola petición:
  // Supabase llama a `setAll` mientras atiende, y la respuesta se construye
  // después. Fuera de aquí sólo se ve la lista ya cerrada.
  let record: SessionCookieRecord = { cookies: [], headers: {} };

  const client = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => incomingCookies.map(({ name, value }) => ({ name, value })),
      setAll: (cookiesToSet, headers) => {
        record = { cookies: [...record.cookies, ...cookiesToSet], headers };
      },
    },
  });

  return { kind: "ready", client, recorder: { recorded: () => record } };
}

/** Las cookies que llegan en la petición, en la forma que espera Supabase. */
export function readIncomingCookies(
  request: NextRequest,
): readonly IncomingCookie[] {
  return request.cookies.getAll().map(({ name, value }) => ({ name, value }));
}

/** Vuelca en la respuesta lo que Supabase emitió mientras atendía. Sin esto la
 * sesión nueva no llega al navegador y el cierre de sesión no la borra. */
export function applySessionCookies(
  response: NextResponse,
  recorder: SessionCookieRecorder,
): void {
  const { cookies, headers } = recorder.recorded();
  for (const { name, value, options } of cookies) {
    response.cookies.set({ name, value, ...options });
  }
  for (const [header, value] of Object.entries(headers)) {
    response.headers.set(header, value);
  }
}

/**
 * Caduca en la respuesta toda cookie que Supabase haya emitido en esta
 * petición, en vez de entregarla.
 *
 * Es lo contrario de `applySessionCookies` y existe para un caso concreto: una
 * petición que autenticó bien y falló después. Ahí el grabador ya tiene las
 * cookies de una sesión viva, y entregarlas con un 500 dejaría dentro a quien
 * la aplicación acaba de decidir que no entra. Toca sólo las que se emitieron
 * aquí: las demás cookies del navegador no son asunto de este módulo.
 */
export function expireSessionCookies(
  response: NextResponse,
  recorder: SessionCookieRecorder,
): void {
  for (const { name, options } of recorder.recorded().cookies) {
    response.cookies.set({
      name,
      value: "",
      path: options.path ?? "/",
      maxAge: 0,
    });
  }
}
