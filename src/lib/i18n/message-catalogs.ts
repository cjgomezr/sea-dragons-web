import type { Locale } from "./locale";
import type { MessageCatalog } from "./message";
import { englishMessages } from "./messages/en";
import { spanishMessages } from "./messages/es";

export const messageCatalogs: Readonly<Record<Locale, MessageCatalog>> = {
  en: englishMessages,
  es: spanishMessages,
};
