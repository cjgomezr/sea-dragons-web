import { visualBaselineNotice } from "./visual-baseline-notice";

export default function globalSetup(): void {
  const notice = visualBaselineNotice(process.platform);
  if (notice) {
    console.log(`\n${notice}\n`);
  }
}
