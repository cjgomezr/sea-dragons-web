import type { Metadata } from "next";
import { PasswordRecoveryRequestForm } from "@/components/auth/PasswordRecoveryRequestForm";

export const metadata: Metadata = {
  title: "Recuperar tu contraseña · Victoria Seadragons",
  description:
    "Pide un enlace para elegir una contraseña nueva en la plataforma del club Victoria Seadragons.",
};

export default function PasswordRecoveryPage(): React.JSX.Element {
  return <PasswordRecoveryRequestForm />;
}
