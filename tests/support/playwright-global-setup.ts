import { prepareE2eSession } from "./e2e-session";
import { visualBaselineNotice } from "./visual-baseline-notice";

/** Lo que la suite de Playwright necesita antes del primer test: avisar de si
 * la comparación visual de esta plataforma es vinculante, y dejar preparado
 * el socio con el que entrar a la aplicación. */
export default async function globalSetup(): Promise<void> {
  const notice = visualBaselineNotice(process.platform);
  if (notice) {
    console.log(`\n${notice}\n`);
  }
  await prepareE2eSession();
}
