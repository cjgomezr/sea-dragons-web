/**
 * Lo que hay que mover la barra de pestañas para que quede pegada al fondo de
 * la ventana visible (#703). Chrome en el iPhone esconde su barra de abajo y
 * la ventana visible crece, pero una barra `position: fixed; bottom: 0` se
 * queda donde estaba y por debajo asoma la página. Safari y los navegadores
 * de escritorio ya la llevan al fondo, así que ahí el desfase es 0.
 */

/** La parte de `window.visualViewport` que importa, en píxeles CSS. */
export type VisualViewportBox = {
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
};

export type TabBarOffsetInput = {
  /** Borde inferior de la barra sin desplazar, medido desde arriba. */
  readonly barBottom: number;
  /** `null` donde el navegador no tiene `visualViewport`. */
  readonly visualViewport: VisualViewportBox | null;
  readonly isKeyboardOpen: boolean;
};

/** Por debajo de un píxel es redondeo del navegador, no un hueco. */
const MIN_VISIBLE_OFFSET_PX = 1;

/** Con la página ampliada la barra se queda como hoy, quieta en la página. */
const UNZOOMED_SCALE_TOLERANCE = 0.01;

/** Píxeles que bajar la barra; negativo es subirla. */
export function tabBarOffset({
  barBottom,
  visualViewport,
  isKeyboardOpen,
}: TabBarOffsetInput): number {
  // Con el teclado abierto la barra sigue abajo, como hoy: subirla con la
  // ventana visible la dejaría encima del teclado, tapando el campo.
  if (visualViewport === null || isKeyboardOpen) {
    return 0;
  }
  if (Math.abs(visualViewport.scale - 1) > UNZOOMED_SCALE_TOLERANCE) {
    return 0;
  }
  // Al tirar de la página para refrescar, offsetTop es negativo mientras dura
  // el gesto: es la página estirada por encima de su borde, no la ventana
  // visible moviéndose, y contarlo subiría la barra con el dedo.
  const visibleTop = Math.max(0, visualViewport.offsetTop);
  const offset = visibleTop + visualViewport.height - barBottom;
  return Math.abs(offset) < MIN_VISIBLE_OFFSET_PX ? 0 : offset;
}
