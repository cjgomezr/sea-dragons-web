const PATH_OPTION = "--path";

/**
 * Una letra de unidad seguida de dos puntos y una barra: `C:/...` o `C:\...`.
 * Nunca es una ruta de la aplicación, así que solo puede venir de Git Bash.
 */
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

const LEADING_SLASHES = /^\/+/;

/**
 * Git Bash (MSYS) reescribe los argumentos que parecen rutas absolutas antes de
 * que Node los vea, así que `--path /entrar` llega como `C:/Program Files/Git/entrar`.
 * Capturarla daría una revisión de una pantalla que nadie pidió, de modo que aquí
 * se para y se explican las dos formas de esquivarlo.
 */
function rejectPathRewrittenByTerminal(value: string): void {
  if (!WINDOWS_DRIVE_PATH.test(value)) {
    return;
  }
  throw new Error(
    `La terminal convirtió la ruta en ${value}. Git Bash reescribe las rutas absolutas: ` +
      `escribe MSYS_NO_PATHCONV=1 npm run ui:screenshots -- ${PATH_OPTION} /entrar, ` +
      `o bien ${PATH_OPTION} //entrar, que pasa sin convertir.`,
  );
}

/**
 * Lee la ruta a capturar de los argumentos. Una opción desconocida es un error
 * y no un argumento ignorado: quien escribió `--pat` esperaba capturar otra
 * pantalla, y capturar la portada en silencio le daría una revisión falsa.
 */
export function parseCapturePath(argv: readonly string[]): string {
  if (argv.length === 0) {
    return "/";
  }

  const [option, value, ...rest] = argv;
  if (option !== PATH_OPTION) {
    throw new Error(
      `Opción desconocida: ${option}. La única admitida es ${PATH_OPTION} <ruta>.`,
    );
  }
  if (value === undefined || value === "") {
    throw new Error(
      `${PATH_OPTION} necesita una ruta, por ejemplo ${PATH_OPTION} /settings.`,
    );
  }
  if (rest.length > 0) {
    throw new Error(
      `Argumentos de más tras ${PATH_OPTION} ${value}: ${rest.join(" ")}.`,
    );
  }
  rejectPathRewrittenByTerminal(value);

  const absolute = value.startsWith("/") ? value : `/${value}`;
  return absolute.replace(LEADING_SLASHES, "/");
}
