import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { Icon } from "@/components/Icon";

/** El aviso bajo un campo del correo (#859): el círculo de aviso y la frase,
 * en el color de peligro. El campo apunta aquí con `aria-describedby`. */
export function DirectoryEmailFieldError({
  id,
  children,
}: {
  readonly id: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className="directory-email-field-error" id={id}>
      <Icon glyph={WarningCircle} />
      {children}
    </p>
  );
}
