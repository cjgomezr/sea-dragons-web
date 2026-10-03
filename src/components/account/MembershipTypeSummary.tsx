import Link from "next/link";
import { PAYMENTS_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type { MembershipPlan } from "@/lib/membership/membership";

/** El tipo de membresía en el perfil propio (#456, RF-6 del PRD de E12): se
 * ve pero no se edita aquí. Se cambia en Pagos, al siguiente ciclo, y el
 * enlace lleva allí. La tarjeta es la de la evaluación, como la asistencia:
 * la clase no dice qué lleva dentro. */
export function MembershipTypeSummary({
  translate,
  plan,
}: {
  readonly translate: Translator;
  readonly plan: MembershipPlan | null;
}): React.JSX.Element {
  return (
    <section className="account-evaluation" aria-labelledby="mi-membresia">
      <h2 id="mi-membresia">{translate("account.membership.title")}</h2>
      <p>
        {plan === null
          ? translate("account.membership.none")
          : translate("account.membership.type", { plan })}
      </p>
      <p>
        <Link href={PAYMENTS_PATH}>
          {translate("account.membership.change")}
        </Link>
      </p>
    </section>
  );
}
