import { Pool } from 'pg';

// Initialize a connection pool
// We use DATABASE_URL from process.env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase connections
});

let schemaEnsuredPromise: Promise<void> | null = null;

/**
 * Ensures the "Product" table has the `category` column (non-destructive migration).
 * Runs at most once per server process lifecycle.
 */
export async function ensureProductSchema(): Promise<void> {
  if (!schemaEnsuredPromise) {
    schemaEnsuredPromise = (async () => {
      try {
        await pool.query(
          `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'COSMETICS'`
        );
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
