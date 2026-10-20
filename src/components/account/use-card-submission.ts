"use client";

import { useRef, useState } from "react";

/**
 * El envío de una tarjeta abierta (#772): mientras se guarda no se manda otro,
 * y un fallo se queda para que la tarjeta lo enseñe sin cerrarse. Lo comparten
 * Sobre mí y Contacto del perfil y el Contacto de la ficha, cada uno con su
 * guardado de siempre.
 */

type Outcome = { readonly kind: "saved" } | { readonly kind: "failed" };

export type CardSubmissionStatus<Failure> =
  { readonly kind: "idle" } | { readonly kind: "sending" } | Failure;

export type CardSubmission<Result extends Outcome> = {
  readonly status: CardSubmissionStatus<Extract<Result, { kind: "failed" }>>;
  readonly isSending: boolean;
  readonly submit: (
    request: () => Promise<Result>,
    onSaved: (result: Extract<Result, { kind: "saved" }>) => void,
  ) => Promise<void>;
  /** Un aviso habla del envío anterior: se quita en cuanto se edita. */
  readonly clearFailure: () => void;
};

function isFailed<Result extends Outcome>(
  result: Result,
): result is Extract<Result, { kind: "failed" }> {
  return result.kind === "failed";
}

function isSaved<Result extends Outcome>(
  result: Result,
): result is Extract<Result, { kind: "saved" }> {
  return result.kind === "saved";
}

export function useCardSubmission<
  Result extends Outcome,
>(): CardSubmission<Result> {
  const [status, setStatus] = useState<
    CardSubmissionStatus<Extract<Result, { kind: "failed" }>>
  >({ kind: "idle" });
  // El estado desactiva el botón en el siguiente pintado, pero un doble clic
  // llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);

  async function submit(
    request: () => Promise<Result>,
    onSaved: (result: Extract<Result, { kind: "saved" }>) => void,
  ): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const result = await request();
    isSendingRef.current = false;
    if (isFailed(result)) {
      setStatus(result);
      return;
    }
    if (isSaved(result)) {
      setStatus({ kind: "idle" });
      onSaved(result);
    }
  }

  function clearFailure(): void {
    setStatus((current) =>
      current.kind === "sending" ? current : { kind: "idle" },
    );
  }

  return {
    status,
    isSending: status.kind === "sending",
    submit,
    clearFailure,
  };
}
