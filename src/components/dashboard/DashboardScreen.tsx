"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CALENDAR_NEW_EVENT_QUERY_PARAM,
  CALENDAR_PATH,
} from "@/lib/auth/routes";
import { MembershipNotice } from "@/components/MembershipNotice";
import { ContactReminderNotice } from "@/components/account/ContactReminderNotice";
import type {
  Dashboard,
  MemberDashboard,
  RestrictedDashboard,
} from "@/lib/dashboard/dashboard";
import { greetingPeriodAt } from "@/lib/dashboard/dashboard-view";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { type ClubMoment, clubMoment } from "@/lib/time/club-calendar";
import {
  type DashboardFailure,
  describeDashboardFailure,
  loadDashboard,
} from "./dashboard-client";
import { LatestNewsPanel, UpcomingPanel } from "./DashboardLists";
import { DashboardTiles } from "./DashboardTiles";
import { NextTrainingCard, ReadOnlyTrainingCard } from "./NextTrainingCard";

/**
 * La pantalla de inicio (#426, RF-1 a RF-4 del PRD de E14): el saludo, las
 * cuatro teselas, los próximos eventos y las últimas noticias de
 * docs/mockups/dashboard-light.png, y en el móvil la tarjeta del próximo
 * entrenamiento con el RSVP de docs/mockups/mobile-home-light.png.
 *
 * Es de cliente porque responde al RSVP sin recargar y porque la hora del
 * saludo y de "hace N" es la del momento en que se pintó. Lo lee todo de
 * `GET /api/v1/dashboard` (#424) en una petición, la misma que usará la
 * aplicación nativa de Release 2 (CON-002). Cambiar de idioma vuelve a
 * pintar lo que ya llegó, sin pedirlo otra vez.
 *
 * A quien no tiene la membresía al día el endpoint le sirve el inicio
 * reducido (#453): el saludo, el aviso que lleva a Pagos y el próximo
 * entrenamiento sin RSVP.
 *
 * Los dos inicios llevan bajo el saludo el aviso de los datos de contacto
 * que faltan (#498). Se pide al montar, así que al volver del perfil con el
 * contacto guardado el aviso ya no está.
 */

const NEW_TRAINING_HREF = `${CALENDAR_PATH}?${new URLSearchParams({
  [CALENDAR_NEW_EVENT_QUERY_PARAM]: "training",
}).toString()}`;

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
  canCreateTrainings,
}: {
  readonly translate: Translator;
  readonly firstName: string;
  readonly now: ClubMoment;
  readonly canCreateTrainings: boolean;
}): React.JSX.Element {
  return (
    <header className="dashboard-header">
      <div>
        <p className="agenda-eyebrow">{translate("dashboard.eyebrow")}</p>
        <h1>
          {translate(GREETING_KEYS[greetingPeriodAt(now)], {
            name: firstName,
          })}
        </h1>
      </div>
      {canCreateTrainings ? (
        <Link
          href={NEW_TRAINING_HREF}
          className="auth-submit dashboard-new-training"
        >
          <span aria-hidden="true">+ </span>
          {translate("dashboard.newTraining")}
        </Link>
      ) : null}
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

type ContentProps<Shown extends Dashboard> = {
  readonly translate: Translator;
  readonly userId: string;
  readonly dashboard: Shown;
  readonly loadedAt: Date;
  readonly canCreateTrainings: boolean;
};

/** Sin poder leer el contacto no se avisa: el resto del inicio sigue. */
function DashboardContactReminder({
  translate,
  userId,
  dashboard,
}: Pick<
  ContentProps<Dashboard>,
  "translate" | "userId" | "dashboard"
>): React.JSX.Element | null {
  const { contactReminder } = dashboard;
  return contactReminder.kind === "unavailable" ? null : (
    <ContactReminderNotice
      locale={translate.locale}
      userId={userId}
      reminder={contactReminder.reminder}
    />
  );
}

function RestrictedContent({
  translate,
  userId,
  dashboard,
  loadedAt,
  canCreateTrainings,
}: ContentProps<RestrictedDashboard>): React.JSX.Element {
  return (
    <>
      <DashboardHeader
        translate={translate}
        firstName={dashboard.viewer.firstName}
        now={clubMoment(loadedAt)}
        canCreateTrainings={canCreateTrainings}
      />
      <DashboardContactReminder
        translate={translate}
        userId={userId}
        dashboard={dashboard}
      />
      <MembershipNotice
        translate={translate}
        block={dashboard.block}
        linksToPayments
      />
      <ReadOnlyTrainingCard
        translate={translate}
        nextTraining={dashboard.nextTraining}
      />
    </>
  );
}

function MemberContent({
  translate,
  userId,
  dashboard,
  loadedAt,
  canCreateTrainings,
}: ContentProps<MemberDashboard>): React.JSX.Element {
  const now = clubMoment(loadedAt);
  const { nextTraining } = dashboard.tiles;
  return (
    <>
      <DashboardHeader
        translate={translate}
        firstName={dashboard.viewer.firstName}
        now={now}
        canCreateTrainings={canCreateTrainings}
      />
      <DashboardContactReminder
        translate={translate}
        userId={userId}
        dashboard={dashboard}
      />
      <DashboardTiles translate={translate} tiles={dashboard.tiles} now={now} />
      {nextTraining.kind === "training" ? (
        <NextTrainingCard
          key={nextTraining.training.id}
          translate={translate}
          training={nextTraining.training}
        />
      ) : null}
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
  canCreateTrainings,
}: {
  readonly locale: Locale;
  /** Quien mira: el cierre del aviso del teléfono es de su cuenta (#498). */
  readonly userId: string;
  /** Si se pinta "Nuevo entrenamiento". Sólo decide el botón: crear lo
   * vuelve a comprobar el endpoint (#307). */
  readonly canCreateTrainings: boolean;
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
          canCreateTrainings={canCreateTrainings}
        />
      ) : null}
      {state.kind === "ready" && state.dashboard.kind === "restricted" ? (
        <RestrictedContent
          translate={translate}
          userId={userId}
          dashboard={state.dashboard}
          loadedAt={state.loadedAt}
          canCreateTrainings={canCreateTrainings}
        />
      ) : null}
    </div>
  );
}
