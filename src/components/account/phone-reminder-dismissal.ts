/**
 * Que un socio cerró el aviso del teléfono (#498), guardado en el navegador y
 * por cuenta: quien comparte el ordenador no cierra el aviso de otro. No va
 * al servidor a propósito (fuera de alcance del ticket): en otro navegador el
 * aviso vuelve a salir, y eso basta.
 *
 * `localStorage` puede no estar (modo privado de algunos navegadores, cuota
 * llena, almacenamiento bloqueado). Un aviso que se pueda cerrar no merece
 * romper la pantalla: leer sin almacenamiento es no haberlo cerrado, y
 * guardar sin él deja el aviso cerrado sólo mientras dure la pantalla.
 */

const STORAGE_KEY_PREFIX = "seadragons:phone-reminder-dismissed:";
const DISMISSED_VALUE = "1";

/** Las escrituras en la misma pestaña no disparan `storage`. */
export const PHONE_REMINDER_DISMISSED_EVENT =
  "seadragons:phone-reminder-dismissed";

function storageKeyOf(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export function isPhoneReminderDismissed(userId: string): boolean {
  try {
    return (
      window.localStorage.getItem(storageKeyOf(userId)) === DISMISSED_VALUE
    );
  } catch {
    return false;
  }
}

/** Si se pudo guardar. Sin almacenamiento devuelve false, y quien llama
 * cierra el aviso sólo en la pantalla. */
export function dismissPhoneReminder(userId: string): boolean {
  try {
    window.localStorage.setItem(storageKeyOf(userId), DISMISSED_VALUE);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(PHONE_REMINDER_DISMISSED_EVENT));
  return true;
}

export function subscribeToPhoneReminderDismissal(
  onChange: () => void,
): () => void {
  window.addEventListener(PHONE_REMINDER_DISMISSED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PHONE_REMINDER_DISMISSED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
