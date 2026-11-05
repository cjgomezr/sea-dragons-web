"use client";

import { useEffect, useState } from "react";
import { loadGroups } from "@/components/groups/groups-client";
import type { Group } from "@/lib/groups/groups";

/**
 * Los grupos del club que el campo For de Planificar ofrece (#980). Los lee
 * del mismo endpoint que Noticias y el calendario (`GET /api/v1/groups`),
 * una vez por pestaña: todos los ciclos eligen de la misma lista.
 */

export type PlannerGroups =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly groups: readonly Group[] };

export function usePlannerGroups(): PlannerGroups {
  const [groups, setGroups] = useState<PlannerGroups>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    void loadGroups().then((outcome) => {
      if (isCurrent) {
        setGroups(
          outcome.kind === "loaded"
            ? { kind: "ready", groups: outcome.groups }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  return groups;
}
