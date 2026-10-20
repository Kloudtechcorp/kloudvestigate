import assert from "node:assert/strict";
import { test } from "node:test";
import { getPrisma } from "./prisma";

test("Prisma can be imported without a database URL, then initialized and reused", async () => {
  const originalUrl = process.env.DATABASE_URL;
  let client: ReturnType<typeof getPrisma> | undefined;

  try {
    delete process.env.DATABASE_URL;
    assert.throws(getPrisma, /Audit storage is not configured\. Set DATABASE_URL/);

    // Creating a client must not connect; no live database is needed for this test.
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    client = getPrisma();
    assert.equal(getPrisma(), client);
  } finally {
    await client?.$disconnect();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
});
