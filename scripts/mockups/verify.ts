export function findMissingFiles(
  expectedFileNames: readonly string[],
  existingFileNames: readonly string[],
): string[] {
  const existing = new Set(existingFileNames);
  return expectedFileNames.filter((fileName) => !existing.has(fileName));
}
