/**
 * Una tarjeta de la columna derecha del perfil y de la ficha (#774, RF-5 del
 * PRD de E30): Membresía, Asistencia, Grupos, Evaluación y Rol. Lleva el
 * título y, a su derecha, lo que la tarjeta ofrezca (un enlace, Editar, una
 * etiqueta). Lo de dentro lo pone cada una.
 */
export function SideCard({
  headingId,
  title,
  action,
  isSummary = false,
  children,
}: {
  /** Único en la página: el perfil y la ficha dan el suyo. */
  headingId: string;
  title: string;
  action?: React.ReactNode;
  /** Membresía y Asistencia: en el móvil van lado a lado como resumen
   * (#777). */
  isSummary?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={
        isSummary
          ? "profile-side-card profile-side-card-summary"
          : "profile-side-card"
      }
      aria-labelledby={headingId}
    >
      <div className="profile-side-card-header">
        <h2 id={headingId}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
