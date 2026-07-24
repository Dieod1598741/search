-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "currentPrice" INTEGER NOT NULL,
    "naverPrice" INTEGER,
    "naverLink" TEXT,
    "coupangPrice" INTEGER,
    "coupangLink" TEXT,
    "lastCheckedAt" DATETIME
);
