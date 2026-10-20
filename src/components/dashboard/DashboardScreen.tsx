"use client";

import { useEffect, useState } from "react";
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
import { LatestNewsPanel, UpcomingPanel } from "./DashboardLists";
import { ManagementColumn, type OpenableSections } from "./ManagementColumn";
import { NewEventLink } from "./NewEventLink";
import { NextUpCard } from "./NextUpCard";
import { PlayerColumn } from "./PlayerColumn";

/**
 * La pantalla de inicio (#426, RF-1 a RF-4 del PRD de E14), que E27 rehace
 * por partes. De arriba abajo: la cabecera con el día y el saludo, los avisos
 * y la tarjeta "Próximo" con el RSVP y el equipo (#747, RF-3 y RF-8 del PRD
 * de E27), con la columna del Player a su derecha (#749, RF-5) y "Esta
 * semana" (#748, RF-4) bajo "Próximo"; debajo, de momento, los próximos
 * eventos y las últimas noticias.
 *
 * Es de cliente porque responde al RSVP sin recargar y porque la hora del
 * saludo y de "hace N" es la del momento en que se pintó. Lo lee todo de
 * `GET /api/v1/dashboard` (#424) en una petición, la misma que usará la
 * aplicación nativa de Release 2 (CON-002). Cambiar de idioma vuelve a
 * pintar lo que ya llegó, sin pedirlo otra vez.
 *
 * A quien no tiene la membresía al día el endpoint le sirve el inicio
 * reducido (#453): la cabecera, el aviso que lleva a Pagos, la tarjeta
 * "Próximo" sin RSVP y la semana sin "Responder". El aviso del contacto que
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
      /** Cuándo llegó: de aquí salen el saludo, el tiempo hasta el
       * entrenamiento y "hace N". */
      readonly loadedAt: Date;
    };

const GREETING_KEYS = {
  morning: "dashboard.greeting.morning",
  afternoon: "dashboard.greeting.afternoon",
  evening: "dashboard.greeting.evening",
} as const;

function DashboardHeader({
  translate,
  firstName,
  now,
  canCreateEvents,
}: {
  readonly translate: Translator;
  readonly firstName: string;
  readonly now: ClubMoment;
  readonly canCreateEvents: boolean;
}): React.JSX.Element {
  return (
    <header className="dashboard-header">
      <div>
        <p className="dashboard-eyebrow">
          {translate("dashboard.eyebrow.dated", {
            date: formatDashboardDay(translate.locale, now.date),
            section: translate("dashboard.eyebrow"),
          })}
        </p>
        <h1>
          {translate(GREETING_KEYS[greetingPeriodAt(now)], {
            name: firstName,
          })}
        </h1>
      </div>
      {canCreateEvents ? <NewEventLink translate={translate} /> : null}
    </header>
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
      <DashboardHeader
        translate={translate}
        firstName={dashboard.viewer.firstName}
        now={now}
        canCreateEvents={canCreateEvents}
      />
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
      <DashboardHeader
        translate={translate}
        firstName={dashboard.viewer.firstName}
        now={now}
        canCreateEvents={canCreateEvents}
      />
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
      <div className="dashboard-panels">
        <UpcomingPanel
          translate={translate}
          upcoming={dashboard.upcomingEvents}
        />
        <LatestNewsPanel
          translate={translate}
          news={dashboard.latestNews}
          now={loadedAt}
        />
      </div>
    </>
  );
}

export function DashboardScreen({
  locale,
  userId,
  canCreateEvents,
  openableSections,
}: {
  readonly locale: Locale;
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
      {/* Sin el nombre todavía, la pantalla se titula igual. */}
      {state.kind === "ready" ? null : (
        <h1>{translate("dashboard.eyebrow")}</h1>
      )}
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("dashboard.loading")}</p>
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
