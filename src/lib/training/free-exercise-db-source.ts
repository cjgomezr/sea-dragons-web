import type { LibrarySource } from "./exercise-library-loader";

/**
 * El origen de la biblioteca (#897): free-exercise-db en GitHub, en una
 * versión fija para que dos cargas iguales den lo mismo.
 */

/** El último commit de `main` de yuhonas/free-exercise-db cuando se escribió
 * la carga (27 de septiembre de 2026). Cambiarlo es cargar una versión nueva:
 * el script actualiza lo que cambió y no borra nada. */
export const FREE_EXERCISE_DB_SHA = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";

const RAW_BASE_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db";

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} respondió ${response.status}`);
  }
  return response;
}

export function createFreeExerciseDbSource(
  sha: string = FREE_EXERCISE_DB_SHA,
): LibrarySource {
  const baseUrl = `${RAW_BASE_URL}/${sha}`;
  return {
    fetchEntries: async () =>
      (await fetchOk(`${baseUrl}/dist/exercises.json`)).json(),
    fetchPhoto: async (sourcePath) =>
      new Uint8Array(
        await (
          await fetchOk(`${baseUrl}/exercises/${sourcePath}`)
        ).arrayBuffer(),
      ),
  };
}
