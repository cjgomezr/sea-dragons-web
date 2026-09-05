import { createNotFoundModule } from "@/lib/api/handler";

// Cualquier ruta bajo /api/v1 que no coincida con un endpoint declarado cae
// aquí, para responder con la forma de error de la convención en lugar del
// HTML de error de Next.
export const { GET, POST, PUT, PATCH, DELETE } = createNotFoundModule();
