import { SUPABASE_FETCH_WORST_CASE_MS } from "./supabase-fetch-timeout";
import { SUPABASE_RETRY_BUDGET_MS } from "./supabase-retry";

/** Timeout de los tests que hablan por red con el proyecto de Supabase (en
 * Sídney): bajo `npm test` completo compiten por CPU y sockets con el resto
 * de los workers de Vitest, y los 5 s por defecto, pensados para tests en
 * memoria, no alcanzan. Mismo patrón que el #50 para tests que lanzan
 * procesos reales.
 *
 * Encima va el presupuesto de dos reintentos completos (#165): un test crea el
 * usuario, inicia sesión, consulta y limpia, y un corte puede pillar a más de
 * una de esas llamadas. Sin ese margen el test caería por plazo antes de que
 * el reintento pudiera recuperarlo.
 *
 * Y encima, una lectura colgada en todos sus intentos (#506): si el test se
 * agotara antes, el fallo diría "timeout" en vez de nombrar la petición. Por
 * eso es también el plazo por defecto de los tests y hooks del proyecto
 * `integration`. */
const NETWORK_TEST_BASE_TIMEOUT_MS = 20_000;
const RETRIES_COVERED_PER_TEST = 2;
export const NETWORK_TEST_TIMEOUT_MS =
  NETWORK_TEST_BASE_TIMEOUT_MS +
  SUPABASE_RETRY_BUDGET_MS * RETRIES_COVERED_PER_TEST +
  SUPABASE_FETCH_WORST_CASE_MS;
