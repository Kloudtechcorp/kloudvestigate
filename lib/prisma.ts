import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Audit storage is not configured. Set DATABASE_URL in .env and run the database migrations.");
  }

  return new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });
}

let prisma: PrismaClient | undefined = globalForPrisma.prisma;

export function getPrisma(): PrismaClient {
  // Initialize inside request handlers so configuration errors can be handled there.
  prisma ??= createPrismaClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
  return prisma;
}
