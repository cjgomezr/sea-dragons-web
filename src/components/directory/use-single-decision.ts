"use client";

import { useRef, useState } from "react";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";

/**
 * Una decisión sobre las solicitudes de rol cada vez: mientras una está en
 * vuelo, ninguna otra sale, así que un doble toque no puede mandar dos. Lo
 * usan la bandeja de escritorio (#240) y la pantalla de solicitudes del
 * móvil (#553).
 */

type Decide = (
  request: PendingRoleRequest,
  decision: RoleRequestDecision,
) => Promise<void>;

export function useSingleDecision(onDecide: Decide): {
  readonly isDeciding: boolean;
  readonly decide: Decide;
} {
  const [isDeciding, setIsDeciding] = useState(false);
  // El estado desactiva los botones en el siguiente pintado, pero un doble
  // clic llega antes. La referencia cambia en el acto.
  const isDecidingRef = useRef(false);

  async function decide(
    request: PendingRoleRequest,
    decision: RoleRequestDecision,
  ): Promise<void> {
    if (isDecidingRef.current) {
      return;
    }
    isDecidingRef.current = true;
    setIsDeciding(true);
    await onDecide(request, decision);
    isDecidingRef.current = false;
    setIsDeciding(false);
  }

  return { isDeciding, decide };
}
