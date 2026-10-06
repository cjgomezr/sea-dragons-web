import { z } from "zod";
import {
  EMERGENCY_CONTACT_TEXT_MAX_LENGTH,
  PHONE_MAX_LENGTH,
} from "./profile-contact";

/**
 * La forma con la que el teléfono y el contacto de emergencia llegan a la
 * API: al perfil propio (#496) y a la ficha del Admin (#499). Sólo la forma:
 * que el número se pueda marcar y que el contacto vaya entero lo decide
 * `profile-contact.ts`, que dice además cuál falló.
 */

/** Topes holgados sólo para no arrastrar un cuerpo de megas hasta el
 * dominio, que cuenta en caracteres y no en unidades UTF-16. */
const PHONE_BODY_MAX_LENGTH = PHONE_MAX_LENGTH * 4;
const CONTACT_TEXT_BODY_MAX_LENGTH = EMERGENCY_CONTACT_TEXT_MAX_LENGTH * 4;

export const phoneBodySchema = z.string().max(PHONE_BODY_MAX_LENGTH);

/** Las tres partes van siempre: que estén todas o ninguna lo decide el
 * dominio, que dice cuál falta. */
export const emergencyContactBodySchema = z
  .object({
    name: z.string().max(CONTACT_TEXT_BODY_MAX_LENGTH),
    phone: phoneBodySchema,
    relationship: z.string().max(CONTACT_TEXT_BODY_MAX_LENGTH),
  })
  .strict();
