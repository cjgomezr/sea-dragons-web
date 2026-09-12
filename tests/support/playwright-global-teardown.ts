import { discardE2eSession } from "./e2e-session";

export default async function globalTeardown(): Promise<void> {
  await discardE2eSession();
}
