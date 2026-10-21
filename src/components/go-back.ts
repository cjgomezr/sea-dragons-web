import { DASHBOARD_PATH } from "@/lib/auth/routes";

/** Lo que hace falta del router de Next.js para volver. */
type BackRouter = {
  back(): void;
  push(href: string): void;
};

/** La API de navegación, donde la hay, dice si se puede volver atrás dentro
 * de esta pestaña. Sin ella, la historia con más de una entrada. */
export function hasPreviousPage(): boolean {
  const { navigation } = window as unknown as {
    navigation?: { canGoBack?: boolean };
  };
  return navigation?.canGoBack ?? window.history.length > 1;
}

/** Vuelve a la pantalla de la que se vino o, si se entró directamente a
 * ésta, al inicio: un botón de volver nunca se queda sin destino. */
export function goBackOrHome(router: BackRouter): void {
  if (hasPreviousPage()) {
    router.back();
    return;
  }
  router.push(DASHBOARD_PATH);
}
