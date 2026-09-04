const PATH_OPTION = "--path";

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
    throw new Error(`Opción desconocida: ${option}. La única admitida es ${PATH_OPTION} <ruta>.`);
  }
  if (value === undefined) {
    throw new Error(`${PATH_OPTION} necesita una ruta, por ejemplo ${PATH_OPTION} /settings.`);
  }
  if (rest.length > 0) {
    throw new Error(`Argumentos de más tras ${PATH_OPTION} ${value}: ${rest.join(" ")}.`);
  }

  return value.startsWith("/") ? value : `/${value}`;
}
