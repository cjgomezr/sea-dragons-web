import type { RegistrationField } from "@/lib/auth/registration";
import type { Translator } from "@/lib/i18n/translator";

/** La etiqueta de un campo de la cuenta. La comparten el registro y completar
 * registro, que piden tres de los mismos datos, y los resúmenes de errores,
 * que nombran el campo delante de lo que le pasa. */
export function labelOfField(
  translate: Translator,
  field: RegistrationField,
): string {
  switch (field) {
    case "fullName":
      return translate("auth.field.fullName");
    case "email":
      return translate("auth.field.email");
    case "country":
      return translate("auth.field.country");
    case "dateOfBirth":
      return translate("auth.field.dateOfBirth");
    case "membershipType":
      return translate("auth.field.membershipType");
    case "password":
      return translate("auth.field.password");
  }
}
