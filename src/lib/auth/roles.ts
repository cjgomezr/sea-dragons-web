/** Los cuatro roles de FR-012. Son los mismos nombres que acepta el `check` de
 * `members.role` en `supabase/migrations/0003_members.sql`, en inglés como en
 * el SRD: traducirlos para mostrarlos es cosa de las pantallas. */
export const ROLES = ["Admin", "Coach", "Committee", "Player"] as const;

export type Role = (typeof ROLES)[number];

/** Estrecha un valor que llega de fuera. Compara exacto, sin normalizar
 * mayúsculas ni espacios: `"admin"` no es un rol, y adivinar cuál quiso decir
 * quien lo mandó es justo como un valor raro acaba dando permisos. */
export function parseRole(value: unknown): Role | null {
  return ROLES.find((role) => role === value) ?? null;
}

/** Las filas de la matriz de la sección 4 del SRD. Solicitar un rol (FR-010)
 * no está aquí: lo puede hacer cualquier cuenta activa. */
export type Capability =
  | "viewEvaluations"
  | "publishNewsAndDocuments"
  | "createEvents"
  | "manageUsersAndRoles"
  | "buildTeamsAndTrackAttendance"
  | "manageGroups"
  | "useMemberFeatures";

/** Una fila de la matriz. Al ser un `Record` de los cuatro roles, una fila que
 * se olvide de uno no compila. */
export type RoleGrants = Readonly<Record<Role, boolean>>;

/** La matriz de la sección 4 del SRD, celda por celda. Tipada con todas las
 * capacidades como claves, así que añadir una al tipo sin su fila tampoco
 * compila. */
export const CAPABILITY_MATRIX: Readonly<Record<Capability, RoleGrants>> = {
  // Evaluaciones (OVR y notas). Un Player no ve ni las propias (BR-007).
  viewEvaluations: {
    Admin: true,
    Coach: true,
    Committee: false,
    Player: false,
  },
  publishNewsAndDocuments: {
    Admin: true,
    Coach: false,
    Committee: true,
    Player: false,
  },
  createEvents: { Admin: true, Coach: false, Committee: true, Player: false },
  manageUsersAndRoles: {
    Admin: true,
    Coach: false,
    Committee: false,
    Player: false,
  },
  buildTeamsAndTrackAttendance: {
    Admin: true,
    Coach: true,
    Committee: false,
    Player: false,
  },
  manageGroups: { Admin: true, Coach: true, Committee: true, Player: false },
  // Directorio, calendario, noticias, RSVP, perfil propio y pagos.
  useMemberFeatures: {
    Admin: true,
    Coach: true,
    Committee: true,
    Player: true,
  },
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return CAPABILITY_MATRIX[capability][role];
}
