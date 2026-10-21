/**
 * La lectura en celdas de Registro AUF y de Ficha del club (#773, RF-4 del
 * PRD de E30): una fila de etiqueta y valor por celda, separadas por una
 * raya. El valor puede llevar marcado, como el "en {n} días" del vencimiento.
 */

export type CardCell = {
  readonly label: string;
  readonly value: React.ReactNode;
};

export function CardCells({
  cells,
  className = null,
}: {
  cells: readonly CardCell[];
  /** Una clase más, para la tarjeta que se pinta distinta en el móvil. */
  className?: string | null;
}): React.JSX.Element {
  return (
    <dl
      className={
        className === null ? "profile-cells" : `profile-cells ${className}`
      }
    >
      {cells.map((cell) => (
        <div key={cell.label} className="profile-cell">
          <dt>{cell.label}</dt>
          <dd>{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
