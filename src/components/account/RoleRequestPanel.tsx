"use client";

import { useEffect, useRef, useState } from "react";
import {
  type RoleRequest,
  roleRequestAvailability,
} from "@/lib/auth/role-request";
import type { Role } from "@/lib/auth/roles";
import { formatClubMoment } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { RoleRequestForm } from "./RoleRequestForm";

/**
 * La parte de Mi cuenta que cambia sin recargar: el formulario se convierte en
 * la solicitud pendiente en cuanto el servidor la acepta (#209). Qué se enseña
 * lo decide `roleRequestAvailability`, la misma regla que aplica el servidor.
 *
 * Es de cliente por eso, por el estado. El idioma llega como prop porque el
 * traductor no puede cruzar del servidor al navegador.
 */

function PendingRoleRequest({
  translate,
  request,
  takesFocus,
}: {
  translate: Translator;
  request: RoleRequest;
  /** Sólo al acabar de enviarla: quien usa un lector de pantalla se quedaría
   * si no sobre un botón que ya no existe. Al abrir la página no se roba el
   * foco a nadie. */
  takesFocus: boolean;
}): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takesFocus) {
      headingRef.current?.focus();
    }
  }, [takesFocus]);

  return (
    <section className="auth-pending" aria-labelledby="solicitud-pendiente">
      <h2 id="solicitud-pendiente" ref={headingRef} tabIndex={-1}>
        {translate("account.pending.title")}
      </h2>
      <p>
        {translate("account.pending.body", {
          role: translate(`role.${request.requestedRole}`),
          date: formatClubMoment(translate.locale, new Date(request.createdAt)),
        })}
      </p>
    </section>
  );
}

export function RoleRequestPanel({
  locale,
  role,
  latestRequest,
}: {
  locale: Locale;
  role: Role;
  latestRequest: RoleRequest | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [latest, setLatest] = useState(latestRequest);
  const [wasJustCreated, setWasJustCreated] = useState(false);
  const availability = roleRequestAvailability(role, latest);

  function handleCreated(request: RoleRequest): void {
    setLatest(request);
    setWasJustCreated(true);
  }

  switch (availability.kind) {
    case "not_needed":
      return <p className="app-lead">{translate("account.adminNote")}</p>;
    case "pending":
      return (
        <PendingRoleRequest
          translate={translate}
          request={availability.request}
          takesFocus={wasJustCreated}
        />
      );
    case "available":
      return (
        <RoleRequestForm
          translate={translate}
          roles={availability.roles}
          onCreated={handleCreated}
        />
      );
  }
}
