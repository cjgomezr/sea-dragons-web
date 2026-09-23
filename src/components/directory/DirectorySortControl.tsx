import {
  DIRECTORY_DIRECTIONS,
  DIRECTORY_SORTS,
  type DirectoryDirection,
  type DirectorySort,
} from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";

/**
 * El orden de la lista de tarjetas (#283). Por debajo de 768px la tabla pierde
 * sus cabeceras, y con ellas los botones que piden el orden; este selector los
 * sustituye. Lee y escribe el mismo orden que las cabeceras, que vive en la
 * pantalla, así que cambiar de ancho no lo pierde. Desde 768px lo esconde la
 * hoja de estilos y quedan las cabeceras de siempre.
 *
 * Dos grupos de pastillas, campo y sentido, como las del filtro por rol: cada
 * opción se ve y se toca sin abrir nada, y el sentido queda dicho con
 * palabras, sin una flecha que haya que interpretar. Cambiar de campo
 * conserva el sentido elegido, porque aquí el sentido está a la vista.
 */

export type DirectoryOrder = {
  readonly sort: DirectorySort;
  readonly direction: DirectoryDirection;
};

/** El título de cada columna, que es también el nombre del campo en el
 * selector: los dos controles hablan de lo mismo con las mismas palabras. */
export const SORT_COLUMN_LABELS = {
  name: "directory.column.member",
  role: "directory.column.role",
  position: "directory.column.position",
} as const satisfies Readonly<Record<DirectorySort, string>>;

/** Los dos grupos son radios con nombre propio: con el del filtro por rol
 * compartirían selección. */
const SORT_GROUP_NAME = "directory-sort";
const DIRECTION_GROUP_NAME = "directory-direction";

function SortOption({
  name,
  label,
  isChosen,
  onChoose,
}: {
  name: string;
  label: string;
  isChosen: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  return (
    <label className="directory-role">
      <input type="radio" name={name} checked={isChosen} onChange={onChoose} />
      <span>{label}</span>
    </label>
  );
}

export function DirectorySortControl({
  translate,
  order,
  onChange,
}: {
  translate: Translator;
  order: DirectoryOrder;
  onChange: (order: DirectoryOrder) => void;
}): React.JSX.Element {
  return (
    <div className="directory-sort-control">
      <fieldset className="directory-roles">
        <legend>{translate("directory.sort.label")}</legend>
        <div className="directory-role-options">
          {DIRECTORY_SORTS.map((sort) => (
            <SortOption
              key={sort}
              name={SORT_GROUP_NAME}
              label={translate(SORT_COLUMN_LABELS[sort])}
              isChosen={order.sort === sort}
              onChoose={() => onChange({ ...order, sort })}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="directory-roles">
        <legend>{translate("directory.sort.directionLabel")}</legend>
        <div className="directory-role-options">
          {DIRECTORY_DIRECTIONS.map((direction) => (
            <SortOption
              key={direction}
              name={DIRECTION_GROUP_NAME}
              label={translate(`directory.sort.direction.${direction}`)}
              isChosen={order.direction === direction}
              onChoose={() => onChange({ ...order, direction })}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
