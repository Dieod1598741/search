import { PrismaClient } from '@prisma/client'

let prisma: PrismaClient;

try {
  const prismaClientSingleton = () => {
    return new PrismaClient()
  }

  declare const globalThis: {
    prismaGlobal: ReturnType<typeof prismaClientSingleton>;
  } & typeof global;

  prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

  if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
} catch (error: any) {
  console.error("PRISMA INITIALIZATION ERROR:", error);
  // Create a fake prisma client that just throws the error when queried,
  // so the API route can catch it and return it as JSON instead of crashing Next.js completely.
  prisma = new Proxy({} as any, {
    get: () => {
      throw new Error(`Prisma Init Error: ${error.message}`);
    }
  });
}

export default prisma
