"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NEW_MEMBER_PATH } from "@/lib/auth/routes";
import type { Role } from "@/lib/auth/roles";
import {
  DEFAULT_DIRECTORY_QUERY,
  type DirectoryDirection,
  type DirectoryListing,
  type DirectoryQuery,
  type DirectorySort,
  withMemberRole,
} from "@/lib/directory/directory";
import { writeDirectoryQuery } from "@/lib/directory/directory-query";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { AdministrationNotice } from "./AdministrationNotice";
import {
  DirectoryEmailComposer,
  type EmailRecipient,
} from "./DirectoryEmailComposer";
import {
  type DirectoryFailure,
  describeDirectoryFailure,
  loadDirectory,
} from "./directory-client";
import {
  type DirectoryFilterState,
  DirectoryFilters,
} from "./DirectoryFilters";
import { NO_MORE_FILTERS, countActiveFilters } from "./DirectoryMoreFilters";
import type { DirectoryOrder } from "./DirectorySortControl";
import { DirectoryExportButton } from "./DirectoryExportButton";
import { DirectoryTable } from "./DirectoryTable";
import { RoleRequestsPanel } from "./RoleRequestsPanel";
import { useDebouncedValue } from "./use-debounced-value";
import { useFilterChoices } from "./use-filter-choices";
import { useMemberRoleChange } from "./use-member-role-change";

/**
 * La pantalla del directorio (#239, RF-2 del PRD de E5): quién está en el
 * club, con su país, su nivel, su rol y su posición.
 *
 * La alcanza cualquier cuenta activa, sea cual sea su rol, así que no hay nada
 * que comprobar aquí: quien no tiene sesión no llega, y lo que es del Admin lo
 * decide el servidor. Que quien mira sea Admin se sabe por la respuesta, que
 * viene marcada, y no por un rol que la pantalla haya leído por su cuenta.
 * Con esa marca, un Admin encuentra además la bandeja de solicitudes de rol y
 * el cambio de rol de cada fila (#240), que antes vivían en su propia pantalla
 * de administración.
 *
 * Es de cliente porque su razón de ser es cambiar sin recargar: buscar,
 * filtrar y ordenar rehacen la lectura. Lee por la API v1 y nunca contra la
 * base, porque la aplicación nativa de Release 2 usará ese mismo endpoint
 * (CON-002). El idioma llega como prop porque el traductor no puede cruzar del
 * servidor al navegador.
 */

/** Lo que se espera entre dos teclas antes de preguntarle al servidor. Con
 * menos, escribir un nombre dispara una petición por letra; con más, la lista
 * se queda atrás de quien escribe. */
const SEARCH_DEBOUNCE_MS = 250;

const EMAIL_EMPTY_REASON_ID = "correo-directorio-sin-socios";

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: DirectoryFailure }
  | {
      readonly kind: "ready";
      readonly listing: DirectoryListing;
      /** La consulta que trajo esta lista. Mientras llega la siguiente, la
       * de los controles ya es otra, y exportar (#500) tiene que dar la que
       * se ve. */
      readonly listedQuery: DirectoryQuery;
    };

/** Lo que la pantalla enseña en sus controles para una consulta. */
function filtersOf(query: DirectoryQuery): DirectoryFilterState {
  return {
    search: query.search ?? "",
    role: query.role,
    includeInactive: query.includeInactive,
    position: query.position,
    groupId: query.groupId,
    auf: query.auf,
    membership: query.membership,
    withoutPhone: query.withoutPhone,
    withoutEmergencyContact: query.withoutEmergencyContact,
  };
}

/** Los filtros viven en la dirección (#497): recargar o compartirla devuelve
 * la misma lista. Se reemplaza la entrada del historial en vez de apilar una
 * por letra escrita, y Next la sincroniza con su router. */
function writeQueryToAddress(query: DirectoryQuery): void {
  const written = writeDirectoryQuery(query).toString();
  const { pathname } = window.location;
  window.history.replaceState(
    null,
    "",
    written === "" ? pathname : `${pathname}?${written}`,
  );
}

/** Un nombre de sólo espacios no filtra nada, igual que para el endpoint. */
function asSearchQuery(search: string): string | null {
  const trimmed = search.trim();
  return trimmed === "" ? null : trimmed;
}

function invert(direction: DirectoryDirection): DirectoryDirection {
  return direction === "asc" ? "desc" : "asc";
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  translate: Translator;
  failure: DirectoryFailure;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeDirectoryFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("directory.retry")}
      </button>
    </div>
  );
}

/** Nadie coincide con lo que se pidió. Limpiar sólo se ofrece cuando hay algo
 * que limpiar: con el club entero delante, ese botón no haría nada. */
function EmptyDirectory({
  translate,
  hasFilters,
  onClear,
}: {
  translate: Translator;
  hasFilters: boolean;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className="directory-empty">
      <p className="admin-empty">{translate("directory.empty")}</p>
      {hasFilters ? (
        <button type="button" className="admin-secondary" onClick={onClear}>
          {translate("directory.clearFilters")}
        </button>
      ) : null}
    </div>
  );
}

/** Escriben correos quienes reciben la lista con el correo de todos (D5, D7):
 * la marca la pone el servidor, y el servidor vuelve a mirar el rol al
 * enviar. */
function canWriteEmails(listing: DirectoryListing): boolean {
  return listing.kind === "admin" || listing.kind === "committee";
}

/** La lista que se está viendo, sin las bajas: no van a recibirlo. El
 * servidor las vuelve a quitar al enviar, por si alguien se dio de baja
 * entre medias. */
function emailRecipientsOf(
  listing: DirectoryListing,
): readonly EmailRecipient[] {
  return listing.members
    .filter((member) => member.status !== "inactive")
    .map(({ userId, fullName }) => ({ userId, fullName }));
}

function WriteEmailButton({
  translate,
  recipients,
  onOpen,
}: {
  translate: Translator;
  recipients: readonly EmailRecipient[];
  onOpen: (recipients: readonly EmailRecipient[]) => void;
}): React.JSX.Element {
  const isEmpty = recipients.length === 0;
  return (
    <div className="directory-email-open">
      <button
        type="button"
        className="admin-secondary"
        disabled={isEmpty}
        aria-describedby={isEmpty ? EMAIL_EMPTY_REASON_ID : undefined}
        onClick={() => onOpen(recipients)}
      >
        {translate("directory.email.open")}
      </button>
      {isEmpty ? (
        <p className="auth-hint" id={EMAIL_EMPTY_REASON_ID}>
          {translate("directory.email.emptyReason")}
        </p>
      ) : null}
    </div>
  );
}

export function DirectoryScreen({
  locale,
  initialQuery = DEFAULT_DIRECTORY_QUERY,
}: {
  locale: Locale;
  /** La consulta con la que llega: la de la dirección (#497), como el nombre
   * que trae la búsqueda global (#427). */
  initialQuery?: DirectoryQuery;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [filters, setFilters] = useState<DirectoryFilterState>(() =>
    filtersOf(initialQuery),
  );
  const [order, setOrder] = useState<DirectoryOrder>({
    sort: initialQuery.sort,
    direction: initialQuery.direction,
  });
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  // Volver a intentarlo cuenta como una lectura más, aunque la consulta sea la
  // misma de antes: así el pedido vive sólo en el efecto.
  const [reloads, setReloads] = useState(0);
  // A quién va el correo que se está escribiendo (#501), o `null` sin
  // formulario abierto.
  const [emailRecipients, setEmailRecipients] = useState<
    readonly EmailRecipient[] | null
  >(null);

  const settledSearch = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const query = useMemo<DirectoryQuery>(
    () => ({
      search: asSearchQuery(settledSearch),
      role: filters.role,
      includeInactive: filters.includeInactive,
      position: filters.position,
      groupId: filters.groupId,
      auf: filters.auf,
      membership: filters.membership,
      withoutPhone: filters.withoutPhone,
      withoutEmergencyContact: filters.withoutEmergencyContact,
      sort: order.sort,
      direction: order.direction,
    }),
    [
      settledSearch,
      filters.role,
      filters.includeInactive,
      filters.position,
      filters.groupId,
      filters.auf,
      filters.membership,
      filters.withoutPhone,
      filters.withoutEmergencyContact,
      order,
    ],
  );

  useEffect(() => {
    writeQueryToAddress(query);
  }, [query]);

  const availableFilters =
    state.kind === "ready" ? state.listing.availableFilters : [];
  const choices = useFilterChoices(availableFilters.includes("group"));

  // La lista anterior se queda a la vista mientras llega la nueva: quien
  // escribe un nombre no ve parpadear la pantalla entre letra y letra. Una
  // respuesta que llega tarde, de una consulta que ya nadie pidió, se tira.
  useEffect(() => {
    let isCurrent = true;
    void loadDirectory(query).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(
        outcome.kind === "loaded"
          ? { kind: "ready", listing: outcome.listing, listedQuery: query }
          : { kind: "failed", failure: outcome },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [query, reloads]);

  /** Reintentar tras un 403 quita lo que esta pantalla puede dejar de pedir
   * y depende del rol: los dados de baja, los filtros de grupo, AUF y
   * membresía (#497) y los de contacto (#499). Sin esto, a quien deja de ser
   * Admin con la pantalla abierta, o a quien abre una dirección compartida por un Admin, le queda un
   * botón que repite el mismo 403 para siempre, porque el control que lo causa
   * ya no se dibuja. El otro 403 del endpoint, el de una cuenta que deja de
   * estar activa, no se arregla desde aquí: ahí reintentar vuelve a fallar, y
   * así tiene que ser. */
  function retryLoad(): void {
    if (state.kind === "failed" && state.failure.failure === "forbidden") {
      setFilters((current) => ({
        ...current,
        includeInactive: false,
        groupId: null,
        auf: null,
        membership: null,
        withoutPhone: false,
        withoutEmergencyContact: false,
      }));
    }
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  /** La misma columna otra vez invierte el sentido; una nueva empieza
   * ascendente, que es como se lee una lista por primera vez. */
  function sortBy(column: DirectorySort): void {
    setOrder((current) => ({
      sort: column,
      direction: current.sort === column ? invert(current.direction) : "asc",
    }));
  }

  /** Lo que el servidor ya confirmó llega a la fila sin volver a leer la
   * lista: la aprobación de una solicitud o un cambio de rol. */
  function applyRole(userId: string, role: Role): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            ...current,
            listing: withMemberRole(current.listing, userId, role),
          }
        : current,
    );
  }

  const roleChange = useMemberRoleChange(translate, applyRole);

  const hasNarrowingFilters =
    asSearchQuery(filters.search) !== null ||
    filters.role !== null ||
    countActiveFilters(filters) > 0;

  return (
    <div className="directory">
      <header className="directory-header">
        <div>
          <h1>{translate("directory.title")}</h1>
          <p className="app-lead">{translate("directory.lead")}</p>
        </div>
        <div className="directory-actions">
          {state.kind === "ready" && canWriteEmails(state.listing) ? (
            <WriteEmailButton
              translate={translate}
              recipients={emailRecipientsOf(state.listing)}
              onOpen={setEmailRecipients}
            />
          ) : null}
          {/* Exporta quien escribe correos: quien ve el contacto de todos
              (D6, #500). */}
          {state.kind === "ready" && canWriteEmails(state.listing) ? (
            <DirectoryExportButton
              translate={translate}
              query={state.listedQuery}
              isEmpty={state.listing.members.length === 0}
            />
          ) : null}
          {/* Sólo quien recibe la lista de Admin puede dar de alta (#243). */}
          {state.kind === "ready" && state.listing.kind === "admin" ? (
            <Link href={NEW_MEMBER_PATH} className="auth-submit directory-add">
              {translate("directory.addMember")}
            </Link>
          ) : null}
        </div>
      </header>
      {emailRecipients === null ? null : (
        <DirectoryEmailComposer
          locale={locale}
          recipients={emailRecipients}
          onClose={() => setEmailRecipients(null)}
        />
      )}
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("directory.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={retryLoad}
        />
      ) : null}
      {state.kind === "ready" && state.listing.kind === "admin" ? (
        <RoleRequestsPanel translate={translate} onRoleGranted={applyRole} />
      ) : null}
      {state.kind === "ready" ? (
        <section className="admin-section" aria-labelledby="miembros-del-club">
          <h2 id="miembros-del-club">{translate("directory.list.title")}</h2>
          <AdministrationNotice notice={roleChange.notice} />
          <DirectoryFilters
            translate={translate}
            locale={locale}
            filters={filters}
            canIncludeInactive={state.listing.kind === "admin"}
            availableFilters={availableFilters}
            choices={choices}
            onChange={setFilters}
          />
          {state.listing.members.length === 0 ? (
            <EmptyDirectory
              translate={translate}
              hasFilters={hasNarrowingFilters}
              onClear={() =>
                setFilters((current) => ({
                  ...current,
                  ...NO_MORE_FILTERS,
                  search: "",
                  role: null,
                }))
              }
            />
          ) : (
            <DirectoryTable
              translate={translate}
              locale={locale}
              listing={state.listing}
              order={order}
              onSort={sortBy}
              onOrderChange={setOrder}
              onSaveRole={roleChange.saveRole}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
