/** Sha del commit que Vercel construyó. Lo inyecta el propio build, así que no
 * existe en local ni en un `next start` a mano. Ver `docs/entornos.md`. */
export const DEPLOYMENT_COMMIT_ENV = "VERCEL_GIT_COMMIT_SHA";

type Environment = Readonly<Record<string, string | undefined>>;

/** Sha del despliegue vivo, o `null` donde nadie lo inyecta. Nunca un valor
 * inventado: quien vigile `/api/v1/health` tiene que poder distinguir "este
 * despliegue es el commit X" de "no sé de qué commit vengo". */
export function readDeploymentCommit(env: Environment): string | null {
  const commit = env[DEPLOYMENT_COMMIT_ENV]?.trim();
  return commit ? commit : null;
}
