"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ContactReminderNotice } from "@/components/account/ContactReminderNotice";
import type {
  Dashboard,
  MemberDashboard,
  NextUp,
  RestrictedDashboard,
} from "@/lib/dashboard/dashboard";
import { greetingPeriodAt } from "@/lib/dashboard/dashboard-view";
import { formatDashboardDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { type ClubMoment, clubMoment } from "@/lib/time/club-calendar";
import {
  type DashboardFailure,
  describeDashboardFailure,
  loadDashboard,
} from "./dashboard-client";
import { DashboardMembershipNotice } from "./DashboardMembershipNotice";
import { DashboardWeek } from "./DashboardWeek";
import { DashboardNews, DashboardRestrictedNews } from "./DashboardNews";
import { ManagementColumn, type OpenableSections } from "./ManagementColumn";
import { NewEventLink } from "./NewEventLink";
import { NextUpCard } from "./NextUpCard";
import { PlayerColumn } from "./PlayerColumn";

/**
 * La pantalla de inicio (#426, RF-1 a RF-4 del PRD de E14), que E27 rehizo.
 * De arriba abajo: la cabecera con el día y el saludo, los avisos y la
 * tarjeta "Próximo" con el RSVP y el equipo (#747, RF-3 y RF-8 del PRD de
 * E27), con la columna del rol a su derecha (#749 y #750, RF-5 y RF-6) y
 * "Esta semana" (#748, RF-4) bajo "Próximo"; debajo, las noticias (#751,
 * RF-7). En el móvil va todo en una columna en el orden de #2a (#752, RF-9).
 *
 * El saludo no espera a la respuesta (#752): el nombre lo lee la página en
 * el servidor, y cada bloque enseña su esqueleto mientras tanto.
 *
 * Es de cliente porque responde al RSVP sin recargar y porque la hora del
 * saludo y de "hace N" es la del momento en que se pintó. Lo lee todo de
 * `GET /api/v1/dashboard` (#424) en una petición, la misma que usará la
 * aplicación nativa de Release 2 (CON-002). Cambiar de idioma vuelve a
 * pintar lo que ya llegó, sin pedirlo otra vez.
 *
 * A quien no tiene la membresía al día el endpoint le sirve el inicio
 * reducido (#453): la cabecera, el aviso que lleva a Pagos, la tarjeta
 * "Próximo" sin RSVP, la semana sin "Responder" y sólo los títulos de las
 * noticias (D2). El aviso del contacto que
 * falta (#498) sólo sale en el inicio de un socio al día, para no competir
 * con el de la membresía. Se pide al montar, así que al volver del perfil con
 * el contacto guardado el aviso ya no está.
 */

type DashboardState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: DashboardFailure }
  | {
      readonly kind: "ready";
      readonly dashboard: Dashboard;
      /** Cuándo llegó: de aquí salen el día de hoy de los bloques y "hace
       * N". */
      readonly loadedAt: Date;
    };

const GREETING_KEYS = {
  morning: "dashboard.greeting.morning",
  afternoon: "dashboard.greeting.afternoon",
  evening: "dashboard.greeting.evening",
} as const;

function subscribeToNothing(): () => void {
  return () => {};
}

/** El día y la franja del saludo son los del navegador que abre el inicio,
 * no los del servidor que lo pintó: hasta hidratar, el título dice sólo la
 * sección, para que lo del servidor no choque con lo del navegador. */
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

function DashboardGreeting({
  translate,
  firstName,
  now,
}: {
  readonly translate: Translator;
  readonly firstName: string;
  readonly now: ClubMoment;
}): React.JSX.Element {
  return (
    <div>
      <p className="dashboard-eyebrow">
        {translate("dashboard.eyebrow.dated", {
          date: formatDashboardDay(translate.locale, now.date),
          section: translate("dashboard.eyebrow"),
        })}
      </p>
      <h1>
        {translate(GREETING_KEYS[greetingPeriodAt(now)], { name: firstName })}
      </h1>
    </div>
  );
}

function DashboardHeader({
  translate,
  firstName,
  openedAt,
  canCreateEvents,
}: {
  readonly translate: Translator;
  readonly firstName: string;
  readonly openedAt: Date;
  readonly canCreateEvents: boolean;
}): React.JSX.Element {
  const isHydrated = useIsHydrated();
  return (
    <header className="dashboard-header">
      {isHydrated ? (
        <DashboardGreeting
          translate={translate}
          firstName={firstName}
          now={clubMoment(openedAt)}
        />
      ) : (
        <h1>{translate("dashboard.eyebrow")}</h1>
      )}
      {canCreateEvents ? <NewEventLink translate={translate} /> : null}
    </header>
  );
}

/** La forma de cada bloque mientras llega la respuesta: "Próximo" y "Esta
 * semana", la columna del rol y las noticias, sin texto a la vista. */
function DashboardSkeleton({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="dashboard-skeleton" role="status">
      <span className="visually-hidden">{translate("dashboard.loading")}</span>
      <div className="dashboard-columns" aria-hidden="true">
        <div className="dashboard-main">
          <div className="dashboard-next-up-slot">
            <div className="section-loading-block dashboard-skeleton-next-up" />
          </div>
          <div className="section-loading-block dashboard-skeleton-week" />
        </div>
        <div className="section-loading-block dashboard-skeleton-column" />
      </div>
      <div
        className="section-loading-block dashboard-skeleton-news"
        aria-hidden="true"
      />
    </div>
  );
}

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  readonly translate: Translator;
  readonly failure: DashboardFailure;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeDashboardFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("dashboard.retry")}
      </button>
    </div>
  );
}

/** El día del Próximo marca la semana cuando cae en ella (D14). */
function nextUpStartsOn(nextUp: NextUp): string | null {
  return nextUp.kind === "event" ? nextUp.startsOn : null;
}

type ContentProps<Shown extends Dashboard> = {
  readonly translate: Translator;
  readonly userId: string;
  readonly dashboard: Shown;
  readonly loadedAt: Date;
  readonly canCreateEvents: boolean;
  readonly openableSections: OpenableSections;
  readonly onRetry: () => void;
};

/** Sin poder leer el contacto no se avisa: el resto del inicio sigue. */
function DashboardContactReminder({
  translate,
  userId,
  dashboard,
}: Pick<
  ContentProps<MemberDashboard>,
  "translate" | "userId" | "dashboard"
>): React.JSX.Element | null {
  const { contactReminder } = dashboard;
  return contactReminder.kind === "unavailable" ? null : (
    <ContactReminderNotice
      locale={translate.locale}
      userId={userId}
      reminder={contactReminder.reminder}
      variant="strip"
    />
  );
}

function RestrictedContent({
  translate,
  dashboard,
  loadedAt,
  canCreateEvents,
  onRetry,
}: ContentProps<RestrictedDashboard>): React.JSX.Element {
  const now = clubMoment(loadedAt);
  return (
    <>
      <DashboardMembershipNotice
        translate={translate}
        membership={dashboard.membership}
      />
      <div className="dashboard-columns">
        <div className="dashboard-main">
          <div className="dashboard-next-up-slot">
            <NextUpCard
              translate={translate}
              nextUp={dashboard.nextUp}
              viewer={{ isRestricted: true, canCreateEvents, today: now.date }}
              onRetry={onRetry}
            />
          </div>
          <DashboardWeek
            translate={translate}
            week={dashboard.week}
            today={now.date}
            nextUpStartsOn={nextUpStartsOn(dashboard.nextUp)}
            isRestricted
            onRetry={onRetry}
          />
        </div>
        <PlayerColumn
          translate={translate}
          attendance={dashboard.me.attendance}
          membership={dashboard.membership}
          onRetry={onRetry}
        />
      </div>
      <DashboardRestrictedNews
        translate={translate}
        news={dashboard.latestNews}
        now={loadedAt}
        onRetry={onRetry}
      />
    </>
  );
}

function MemberContent({
  translate,
  userId,
  dashboard,
  loadedAt,
  canCreateEvents,
  openableSections,
  onRetry,
}: ContentProps<MemberDashboard>): React.JSX.Element {
  const now = clubMoment(loadedAt);
  return (
    <>
      <DashboardContactReminder
        translate={translate}
        userId={userId}
        dashboard={dashboard}
      />
      <div
        className={
          dashboard.column === "management"
            ? "dashboard-columns dashboard-columns-management"
            : "dashboard-columns"
        }
      >
        <div className="dashboard-main">
          <div className="dashboard-next-up-slot">
            <NextUpCard
              translate={translate}
              nextUp={dashboard.nextUp}
              viewer={{ isRestricted: false, canCreateEvents, today: now.date }}
              onRetry={onRetry}
            />
          </div>
          <DashboardWeek
            translate={translate}
            week={dashboard.week}
            today={now.date}
            nextUpStartsOn={nextUpStartsOn(dashboard.nextUp)}
            isRestricted={false}
            onRetry={onRetry}
          />
        </div>
        {dashboard.column === "player" ? (
          <PlayerColumn
            translate={translate}
            attendance={dashboard.me.attendance}
            membership={dashboard.membership}
            onRetry={onRetry}
          />
        ) : (
          <ManagementColumn
            translate={translate}
            todos={dashboard.todos}
            club={dashboard.club}
            myAttendance={dashboard.me.attendance}
            openableSections={openableSections}
            onRetry={onRetry}
          />
        )}
      </div>
      <DashboardNews
        translate={translate}
        news={dashboard.latestNews}
        now={loadedAt}
        onRetry={onRetry}
      />
    </>
  );
}

export function DashboardScreen({
  locale,
  firstName,
  userId,
  canCreateEvents,
  openableSections,
}: {
  readonly locale: Locale;
  /** El nombre de pila del saludo, que así no espera a la respuesta. */
  readonly firstName: string;
  /** Quien mira: el cierre del aviso del teléfono es de su cuenta (#498). */
  readonly userId: string;
  /** Si se pinta "+ Evento". Sólo decide el botón: crear lo
   * vuelve a comprobar el endpoint (#307). */
  readonly canCreateEvents: boolean;
  /** Las secciones que el rol abre: deciden qué números del club enlazan.
   * Abrirlas lo vuelve a comprobar la frontera de la sesión. */
  readonly openableSections: OpenableSections;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [openedAt] = useState(() => new Date());
  const [state, setState] = useState<DashboardState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadDashboard().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      setState(
        outcome.kind === "loaded"
          ? {
              kind: "ready",
              dashboard: outcome.dashboard,
              loadedAt: new Date(),
            }
          : { kind: "failed", failure: outcome },
      );
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retry(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return (
    <div className="dashboard">
      <DashboardHeader
        translate={translate}
        firstName={firstName}
        openedAt={openedAt}
        canCreateEvents={canCreateEvents}
      />
      {state.kind === "loading" ? (
        <DashboardSkeleton translate={translate} />
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={retry}
        />
      ) : null}
      {state.kind === "ready" && state.dashboard.kind === "member" ? (
        <MemberContent
          translate={translate}
          userId={userId}
          dashboard={state.dashboard}
          loadedAt={state.loadedAt}
          canCreateEvents={canCreateEvents}
          openableSections={openableSections}
          onRetry={retry}
        />
      ) : null}
      {state.kind === "ready" && state.dashboard.kind === "restricted" ? (
        <RestrictedContent
          translate={translate}
          userId={userId}
          dashboard={state.dashboard}
          loadedAt={state.loadedAt}
          canCreateEvents={canCreateEvents}
          openableSections={openableSections}
          onRetry={retry}
        />
      ) : null}
    </div>
  );
}
