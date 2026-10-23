import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El indicador de desarrollo se ancla a una esquina de la ventana y se
  // superpone a la barra de pestañas móvil, que vive justo ahí. Como las
  // líneas base visuales se capturan contra el dev server, ese overlay tapaba
  // la primera pestaña en cada captura de 375px. Apagarlo no oculta errores:
  // Next sigue mostrando los de compilación y de ejecución.
  devIndicators: false,
  // La pantalla de administración de E3 se mudó al directorio (#240). Quien
  // llegue con un enlace viejo aterriza donde ahora están la bandeja y el
  // cambio de rol. Es permanente porque la ruta no va a volver. Lo mismo las
  // categorías de evaluación, que son una pestaña de Evaluaciones (#821), y
  // el alta de un socio, que es un panel del Directorio (#862).
  async redirects() {
    return [
      {
        source: "/administracion",
        destination: "/directorio",
        permanent: true,
      },
      {
        source: "/evaluaciones/categorias",
        destination: "/evaluaciones?tab=categories",
        permanent: true,
      },
      {
        source: "/directorio/nuevo",
        destination: "/directorio?invite=1",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
