import { Pool } from 'pg';

// Initialize a connection pool
// We use DATABASE_URL from process.env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase connections
});

export default pool;
