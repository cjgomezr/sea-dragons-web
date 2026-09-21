/**
 * El resultado de la última acción de un Admin en el directorio: la bandeja
 * de solicitudes o el cambio de rol. Un error se anuncia como `alert` porque
 * interrumpe lo que se estaba haciendo; un éxito, como `status`, que no
 * interrumpe a quien usa un lector de pantalla.
 */
export type AdministrationNoticeState =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "success"; readonly message: string }
  | null;

export function AdministrationNotice({
  notice,
}: {
  notice: AdministrationNoticeState;
}): React.JSX.Element | null {
  if (notice === null) {
    return null;
  }
  return notice.kind === "error" ? (
    <p className="auth-error" role="alert">
      {notice.message}
    </p>
  ) : (
    <p className="admin-notice" role="status">
      {notice.message}
    </p>
  );
}
