// Turso/libSQL Database Client for xG-Vantage
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

// Gracefully handle missing env vars during build time
const tursoUrl = process.env.TURSO_DATABASE_URL || 'file::memory:';
const tursoToken = process.env.TURSO_AUTH_TOKEN || '';

const client = createClient({
  url: tursoUrl,
  authToken: tursoToken,
});

export const db = drizzle(client);
export { client };
