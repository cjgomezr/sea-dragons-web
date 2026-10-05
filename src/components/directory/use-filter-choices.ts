"use client";

import { useEffect, useState } from "react";
import type { NamedPosition } from "@/lib/club/club-positions";
import type { Group } from "@/lib/groups/groups";
import { loadPositionChoices } from "@/components/club/positions-client";
import { loadGroups } from "@/components/groups/groups-client";

/**
 * Las opciones de los filtros del directorio (#497): las posiciones del club,
 * que lee cualquier cuenta activa, y sus grupos, que sólo lee quien gestiona
 * grupos. Cada una se pide una vez: no cambian mientras se filtra.
 *
 * Mientras no llegan, o si no se pudieron leer, el filtro no se ofrece: un
 * desplegable sin sus opciones no deja elegir nada, y el resto del
 * directorio sigue funcionando sin él.
 */

export type FilterChoices = {
  readonly positions: readonly NamedPosition[] | null;
  readonly groups: readonly Group[] | null;
};

function usePositionChoices(): readonly NamedPosition[] | null {
  const [positions, setPositions] = useState<readonly NamedPosition[] | null>(
    null,
  );
  useEffect(() => {
    let isCurrent = true;
    void loadPositionChoices().then((outcome) => {
      if (isCurrent && outcome.kind === "loaded") {
        setPositions(outcome.positions);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  return positions;
}

/** Sólo se piden cuando el servidor dice que se puede filtrar por grupo: a
 * un Player, `GET /api/v1/groups` le respondería 403. */
function useGroupChoices(canFilterByGroup: boolean): readonly Group[] | null {
  const [groups, setGroups] = useState<readonly Group[] | null>(null);
  useEffect(() => {
    if (!canFilterByGroup) {
      return;
    }
    let isCurrent = true;
    void loadGroups().then((outcome) => {
      if (isCurrent && outcome.kind === "loaded") {
        setGroups(outcome.groups);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [canFilterByGroup]);
  return canFilterByGroup ? groups : null;
}

export function useFilterChoices(canFilterByGroup: boolean): FilterChoices {
  return {
    positions: usePositionChoices(),
    groups: useGroupChoices(canFilterByGroup),
  };
}
