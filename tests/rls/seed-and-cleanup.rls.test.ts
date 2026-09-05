import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
} from "../support/rls";

describeRls("siembra y limpieza", () => {
  it("los datos sembrados existen durante el test y no existen después", async () => {
    const serviceClient = createServiceRoleTestClient(process.env);
    const slug = `rls-harness-${randomUUID()}`;
    let seededId: string | undefined;

    await withSeededRows(
      serviceClient,
      "clubs",
      [{ slug, name: "Club de prueba del arnés RLS" }],
      async (seededRows) => {
        seededId = seededRows[0]?.id as string;

        const { data } = await serviceClient.client
          .from("clubs")
          .select("id")
          .eq("id", seededId);

        expect(data).toEqual([{ id: seededId }]);
      },
    );

    const { data: afterCleanup } = await serviceClient.client
      .from("clubs")
      .select("id")
      .eq("id", seededId);

    expect(afterCleanup).toEqual([]);
  });
});
