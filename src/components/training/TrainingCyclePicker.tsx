import { useId } from "react";
import type { Translator } from "@/lib/i18n/translator";
import type { TrainingCycleOption } from "@/lib/training/training-plan";

/**
 * El selector de ciclo de Entrenamiento (#981, RF-6 de E38), encima de la
 * cabecera y sólo cuando el socio ve más de uno. Es un `<select>` nativo: el
 * lector de pantalla lo nombra y anuncia el elegido sin más, y su lista
 * abierta enseña los nombres enteros que el cerrado recorta con "…".
 */

const MIN_CYCLES_TO_PICK = 2;

export function TrainingCyclePicker({
  translate,
  cycles,
  selectedId,
  onChoose,
}: {
  readonly translate: Translator;
  readonly cycles: readonly TrainingCycleOption[];
  readonly selectedId: string;
  readonly onChoose: (cycleId: string) => void;
}): React.JSX.Element | null {
  const id = useId();
  if (cycles.length < MIN_CYCLES_TO_PICK) {
    return null;
  }
  return (
    <div className="training-cycle-picker">
      <label htmlFor={id}>{translate("training.member.cyclePicker")}</label>
      <select
        id={id}
        value={selectedId}
        onChange={(event) => onChoose(event.target.value)}
      >
        {cycles.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {cycle.name}
          </option>
        ))}
      </select>
    </div>
  );
}
