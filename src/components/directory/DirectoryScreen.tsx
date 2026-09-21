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
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { AdministrationNotice } from "./AdministrationNotice";
import {
  type DirectoryFailure,
  describeDirectoryFailure,
  loadDirectory,
} from "./directory-client";
import {
  type DirectoryFilterState,
  DirectoryFilters,
} from "./DirectoryFilters";
import { DirectoryTable } from "./DirectoryTable";
import { RoleRequestsPanel } from "./RoleRequestsPanel";
import { useDebouncedValue } from "./use-debounced-value";
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

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: DirectoryFailure }
  | { readonly kind: "ready"; readonly listing: DirectoryListing };

type SortState = {
  readonly sort: DirectorySort;
  readonly direction: DirectoryDirection;
};

const INITIAL_FILTERS: DirectoryFilterState = {
  search: "",
  role: DEFAULT_DIRECTORY_QUERY.role,
  includeInactive: DEFAULT_DIRECTORY_QUERY.includeInactive,
};

const INITIAL_SORT: SortState = {
  sort: DEFAULT_DIRECTORY_QUERY.sort,
  direction: DEFAULT_DIRECTORY_QUERY.direction,
};

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

export function DirectoryScreen({
  locale,
}: {
  locale: Locale;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [filters, setFilters] = useState<DirectoryFilterState>(INITIAL_FILTERS);
  const [order, setOrder] = useState<SortState>(INITIAL_SORT);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  // Volver a intentarlo cuenta como una lectura más, aunque la consulta sea la
  // misma de antes: así el pedido vive sólo en el efecto.
  const [reloads, setReloads] = useState(0);

  const settledSearch = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const query = useMemo<DirectoryQuery>(
    () => ({
      search: asSearchQuery(settledSearch),
      role: filters.role,
      includeInactive: filters.includeInactive,
      sort: order.sort,
      direction: order.direction,
    }),
    [settledSearch, filters.role, filters.includeInactive, order],
  );

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
          ? { kind: "ready", listing: outcome.listing }
          : { kind: "failed", failure: outcome },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [query, reloads]);

  /** Reintentar tras un 403 quita lo único que esta pantalla puede dejar de
   * pedir: los dados de baja, que sólo un Admin alcanza. Sin esto, a quien deja
   * de ser Admin con la pantalla abierta le queda un botón que repite el mismo
   * 403 para siempre, porque la casilla que lo causa ya no se dibuja. El otro
   * 403 del endpoint, el de una cuenta que deja de estar activa, no se arregla
   * desde aquí: ahí reintentar vuelve a fallar, y así tiene que ser. */
  function retryLoad(): void {
    if (state.kind === "failed" && state.failure.failure === "forbidden") {
      setFilters((current) => ({ ...current, includeInactive: false }));
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
            kind: "ready",
            listing: withMemberRole(current.listing, userId, role),
          }
        : current,
    );
  }

  const roleChange = useMemberRoleChange(translate, applyRole);

  const hasNarrowingFilters =
    asSearchQuery(filters.search) !== null || filters.role !== null;

  return (
    <div className="directory">
      <h1>{translate("directory.title")}</h1>
      <p className="app-lead">{translate("directory.lead")}</p>
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
            filters={filters}
            canIncludeInactive={state.listing.kind === "admin"}
            onChange={setFilters}
          />
          {state.listing.members.length === 0 ? (
            <EmptyDirectory
              translate={translate}
              hasFilters={hasNarrowingFilters}
              onClear={() =>
                setFilters((current) => ({
                  ...current,
                  search: "",
                  role: null,
                }))
              }
            />
          ) : (
            <DirectoryTable
              translate={translate}
              listing={state.listing}
              sort={order.sort}
              direction={order.direction}
              onSort={sortBy}
              onSaveRole={roleChange.saveRole}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
