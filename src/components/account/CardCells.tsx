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
}: {
  cells: readonly CardCell[];
}): React.JSX.Element {
  return (
    <dl className="profile-cells">
      {cells.map((cell) => (
        <div key={cell.label} className="profile-cell">
          <dt>{cell.label}</dt>
          <dd>{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
