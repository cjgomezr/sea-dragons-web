/** Con qué termina el nombre de un estado de pantalla visitado en español. */
const SPANISH_STATE_SUFFIX = "-es";

/**
 * Los estados en español que conservan su propia captura (#255).
 *
 * Una pantalla en español se diferencia de la inglesa sólo en el texto, así
 * que su captura casi nunca defiende algo que la inglesa no defienda ya. Lo
 * que sí cambia con el idioma es el largo de un aviso de varias líneas: el
 * español es más largo, parte en otro sitio y puede empujar el diseño. Estos
 * son los estados cuyo texto es de ese tipo: un aviso de varias líneas, o la
 * lista de avisos de la campana, donde cada cuerpo parte donde le toca.
 *
 * El estado sigue existiendo aunque no se fotografíe: sus pruebas de scroll
 * horizontal y de accesibilidad corren igual en los dos idiomas. La barra de
 * pestañas y el sidebar no pasan por aquí; conservan sus capturas por idioma
 * porque son justo los sitios apretados.
 */
export const SPANISH_STATES_WITH_OWN_CAPTURE: readonly string[] = [
  "alta-invitacion-enviada-es",
  "avisos-con-avisos-es",
  "ficha-aviso-validacion-es",
  "ficha-invitacion-pendiente-es",
  "perfil-error-de-red-es",
];

/** ¿Toma este estado de pantalla sus capturas de línea base? */
export function isStatePhotographed(stateName: string): boolean {
  if (!stateName.endsWith(SPANISH_STATE_SUFFIX)) {
    return true;
  }
  return SPANISH_STATES_WITH_OWN_CAPTURE.includes(stateName);
}
