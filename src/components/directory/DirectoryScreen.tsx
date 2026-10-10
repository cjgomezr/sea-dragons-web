"use client";

import { useEffect, useMemo, useState } from "react";
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
  DirectoryEmptyState,
  describeEmptyCriteria,
} from "./DirectoryEmptyState";
import { NO_MORE_FILTERS } from "./DirectoryFilterFields";
import {
  type DirectoryFilterState,
  DirectoryFilters,
} from "./DirectoryFilters";
import { DirectoryHeader } from "./DirectoryHeader";
import type { DirectoryOrder } from "./DirectorySortControl";
import { DirectoryPanel } from "./DirectoryPanel";
import {
  DirectoryTable,
  type RequestedRoles,
  memberRowId,
} from "./DirectoryTable";
import { RoleRequestsPanel } from "./RoleRequestsPanel";
import { findSelectedMember } from "./selected-member";
import { useDebouncedValue } from "./use-debounced-value";
import { useFilterChoices } from "./use-filter-choices";
import {
  type PendingRequestsState,
  usePendingRoleRequests,
} from "./use-pending-role-requests";

/**
 * La pantalla del directorio (#239, RF-2 del PRD de E5): quién está en el
 * club, con su país, su nivel, su rol y su posición.
 *
 * La alcanza cualquier cuenta activa, sea cual sea su rol, así que no hay nada
 * que comprobar aquí: quien no tiene sesión no llega, y lo que es del Admin lo
 * decide el servidor. Que quien mira sea Admin se sabe por la respuesta, que
 * viene marcada, y no por un rol que la pantalla haya leído por su cuenta.
 * Con esa marca, un Admin encuentra además la bandeja de solicitudes de rol
 * (#240), que antes vivía en su propia pantalla de administración, y en cada
 * fila el rol que ese socio pidió. La cabecera y la barra son las del
 * rediseño de E21 (#548): la bandeja queda debajo de la lista, y la cabecera
 * lleva a ella. La lista es la compacta de #549, que ya no cambia el rol:
 * pulsar una fila abre su ficha rápida en el panel lateral (#550), y es ahí
 * donde el Admin lo cambia.
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

const MEMBERS_HEADING_ID = "miembros-del-club";

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

/** El sentido con el que empieza cada columna (#549): la asistencia, de
 * mayor a menor, porque lo que se busca es quién viene más; el resto, como
 * se lee una lista por primera vez. */
const FIRST_DIRECTION: Readonly<Record<DirectorySort, DirectoryDirection>> = {
  name: "asc",
  role: "asc",
  position: "asc",
  attendance: "desc",
};

const NO_REQUESTED_ROLES: RequestedRoles = new Map();

/** Lo que pidió cada socio, mientras la bandeja lo sabe. */
function requestedRolesOf(state: PendingRequestsState): RequestedRoles {
  if (state.kind !== "ready") {
    return NO_REQUESTED_ROLES;
  }
  return new Map(
    state.requests.map((request) => [request.userId, request.requestedRole]),
  );
}

/** Devuelve el foco a la fila del socio que el panel enseñaba, si sigue en
 * la lista: quien cerró el panel con el teclado sigue donde estaba. */
function focusMemberRow(userId: string): void {
  const row = document.getElementById(memberRowId(userId));
  if (row !== null) {
    row.focus();
  }
}

/** Qué enseña el panel lateral (#550). Elegir a alguien lo abre siempre;
 * cerrarlo suelta la selección, para que ninguna fila quede marcada sin su
 * ficha a la vista. */
function usePanelSelection(): {
  readonly isOpen: boolean;
  readonly selectedUserId: string | null;
  readonly toggleMember: (userId: string) => void;
  readonly close: () => void;
  readonly togglePanel: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  function deselect(): void {
    if (selectedUserId !== null) {
      focusMemberRow(selectedUserId);
    }
    setSelectedUserId(null);
  }

  function toggleMember(userId: string): void {
    if (selectedUserId === userId) {
      deselect();
      return;
    }
    setSelectedUserId(userId);
    setIsOpen(true);
  }

  /** Sin nadie elegido, hasta el resumen del club, el panel no tiene nada
   * que enseñar: la ✕ y Esc lo cierran del todo. */
  function close(): void {
    deselect();
    setIsOpen(false);
  }

  function togglePanel(): void {
    setSelectedUserId(null);
    setIsOpen((current) => !current);
  }

  return { isOpen, selectedUserId, toggleMember, close, togglePanel };
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

  const panel = usePanelSelection();

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

  /** La misma columna otra vez invierte el sentido; una nueva empieza por
   * el suyo. */
  function sortBy(column: DirectorySort): void {
    setOrder((current) => ({
      sort: column,
      direction:
        current.sort === column
          ? invert(current.direction)
          : FIRST_DIRECTION[column],
    }));
  }

  /** Lo que el servidor ya confirmó llega a la fila sin volver a leer la
   * lista: la aprobación de una solicitud o el rol guardado en el panel. */
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

  const isAdminListing =
    state.kind === "ready" && state.listing.kind === "admin";
  const pendingRequests = usePendingRoleRequests({
    isEnabled: isAdminListing,
    translate,
    onRoleGranted: applyRole,
  });

  const selected =
    state.kind === "ready" && panel.selectedUserId !== null
      ? findSelectedMember(state.listing, panel.selectedUserId)
      : null;

  const emptyCriteria = describeEmptyCriteria(filters, {
    translate,
    locale,
    choices,
  });

  return (
    <div
      className={panel.isOpen ? "directory directory-with-panel" : "directory"}
    >
      <DirectoryHeader
        translate={translate}
        listed={state.kind === "ready" ? state : null}
        pendingRequests={isAdminListing ? pendingRequests.state : null}
        onOpenEmail={setEmailRecipients}
      />
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
      {state.kind === "ready" ? (
        <section
          className="directory-members"
          aria-labelledby={MEMBERS_HEADING_ID}
        >
          <h2 id={MEMBERS_HEADING_ID} className="visually-hidden">
            {translate("directory.list.title")}
          </h2>
          <DirectoryFilters
            translate={translate}
            locale={locale}
            filters={filters}
            canIncludeInactive={isAdminListing}
            availableFilters={availableFilters}
            choices={choices}
            shownCount={state.listing.members.length}
            isPanelOpen={panel.isOpen}
            onChange={setFilters}
            onTogglePanel={panel.togglePanel}
          />
          <div className="directory-body">
            {state.listing.members.length === 0 ? (
              <DirectoryEmptyState
                translate={translate}
                criteria={emptyCriteria}
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
                requestedRoles={
                  isAdminListing
                    ? requestedRolesOf(pendingRequests.state)
                    : NO_REQUESTED_ROLES
                }
                selection={{
                  selectedUserId: panel.selectedUserId,
                  onToggle: panel.toggleMember,
                }}
                onSort={sortBy}
                onOrderChange={setOrder}
              />
            )}
            {panel.isOpen ? (
              <DirectoryPanel
                translate={translate}
                locale={locale}
                selected={selected}
                pendingRequests={isAdminListing ? pendingRequests : null}
                onClose={panel.close}
                onRoleChanged={applyRole}
              />
            ) : null}
          </div>
        </section>
      ) : null}
      {isAdminListing ? (
        <RoleRequestsPanel
          translate={translate}
          pendingRequests={pendingRequests}
        />
      ) : null}
    </div>
  );
}
