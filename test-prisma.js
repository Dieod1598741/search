const { PrismaClient } = require('@prisma/client');
try {
  const prisma = new PrismaClient({
    url: "file:./dev.db"
  });
  console.log("Success with url");
} catch(e) {
  console.error("Failed with url:", e.message);
}

try {
  const prisma = new PrismaClient({
    adapter: "sqlite",
    url: "file:./dev.db"
  });
  console.log("Success with adapter string");
} catch(e) {
  console.error("Failed with adapter string:", e.message);
}
