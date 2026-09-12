import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm";

export const metadata: Metadata = {
  title: "Entrar · Victoria Seadragons",
  description:
    "Entra a la plataforma del club Victoria Seadragons de rugby subacuático.",
};

export default function SignInPage(): React.JSX.Element {
  return <SignInForm />;
}
