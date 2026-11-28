import { Pool } from 'pg';

// Initialize a connection pool
// We use DATABASE_URL from process.env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase connections
});

let schemaEnsuredPromise: Promise<void> | null = null;

/**
 * Ensures the "Product" table has all v0.8.0 multi-category & 3-channel comparison columns.
 * Non-destructive migration, runs at most once per server process lifecycle.
 */
export async function ensureProductSchema(): Promise<void> {
  if (!schemaEnsuredPromise) {
    schemaEnsuredPromise = (async () => {
      try {
        await pool.query(`
          ALTER TABLE "Product"
            ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'COSMETICS',
            ADD COLUMN IF NOT EXISTS "openMarketPrice" INTEGER,
            ADD COLUMN IF NOT EXISTS "openMarketLink" TEXT,
            ADD COLUMN IF NOT EXISTS "openMarketMall" TEXT,
            ADD COLUMN IF NOT EXISTS "openMarketShipping" INTEGER,
            ADD COLUMN IF NOT EXISTS "naverShipping" INTEGER,
            ADD COLUMN IF NOT EXISTS "coupangShipping" INTEGER,
            ADD COLUMN IF NOT EXISTS "matchedTitle" TEXT,
            ADD COLUMN IF NOT EXISTS "matchConfidence" VARCHAR(20),
            ADD COLUMN IF NOT EXISTS "matchNote" TEXT,
            ADD COLUMN IF NOT EXISTS "candidateJson" TEXT
        `);
      } catch (err) {
        // Reset promise so subsequent requests can retry if DB was temporarily unreachable
        schemaEnsuredPromise = null;
        throw err;
      }
    })();
  }
  return schemaEnsuredPromise;
}

export default pool;
