import { describeSkippedIntegrationTests } from "./test-selection.mts";

/** Avisa una sola vez por corrida, y no en cada archivo, de que los tests de
 * integración no corrieron. */
export default function announceSkippedIntegrationTests(): void {
  const notice = describeSkippedIntegrationTests(process.env);
  if (notice !== null) {
    console.info(notice);
  }
}
