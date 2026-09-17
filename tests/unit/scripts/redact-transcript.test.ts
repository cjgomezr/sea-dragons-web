import { describe, expect, it } from "vitest";

import {
  MIN_SECRET_LENGTH,
  REDACTED_PLACEHOLDER,
  redactSecrets,
} from "../../../scripts/redact-transcript.ts";

/** Un token de verdad es largo. Estos lo son lo justo para pasar el filtro. */
const OAUTH_TOKEN = "sk-ant-oat01-ejemplo-de-token";
const APP_TOKEN = "ghs_ejemploDeTokenDeLaApp";

describe("redactSecrets", () => {
  it("reemplaza todas las apariciones de un secreto, no solo la primera", () => {
    const transcript = `{"cmd":"git remote -v","out":"https://x:${OAUTH_TOKEN}@github.com y otra vez ${OAUTH_TOKEN}"}`;

    const redacted = redactSecrets(transcript, [OAUTH_TOKEN]);

    expect(redacted).not.toContain(OAUTH_TOKEN);
    expect(redacted.split(REDACTED_PLACEHOLDER)).toHaveLength(3);
  });

  it("enmascara cada secreto de la lista", () => {
    const transcript = `${OAUTH_TOKEN} y ${APP_TOKEN}`;

    const redacted = redactSecrets(transcript, [OAUTH_TOKEN, APP_TOKEN]);

    expect(redacted).toBe(`${REDACTED_PLACEHOLDER} y ${REDACTED_PLACEHOLDER}`);
  });

  it("devuelve el contenido intacto cuando ningún secreto aparece", () => {
    const transcript = '{"cmd":"npm test","out":"1904 passed"}';

    expect(redactSecrets(transcript, [OAUTH_TOKEN])).toBe(transcript);
  });

  it("ignora los valores demasiado cortos para ser un token", () => {
    // Una credencial sin configurar llega como cadena corta o vacía, y
    // reemplazar algo así destrozaría la transcripción sin proteger nada.
    const shortValue = "a".repeat(MIN_SECRET_LENGTH - 1);
    const transcript = `deja ${shortValue} en paz`;

    expect(redactSecrets(transcript, [shortValue])).toBe(transcript);
  });

  it("no toca nada cuando no hay secretos que enmascarar", () => {
    const transcript = '{"cmd":"git status"}';

    expect(redactSecrets(transcript, [])).toBe(transcript);
  });
});
