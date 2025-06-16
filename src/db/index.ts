import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema';

// Function to create a Drizzle instance from the D1 binding
export function getDb(d1Binding: D1Database) {
  return drizzle(d1Binding, { schema });
}

// Export the schema for convenience
export { schema }; 