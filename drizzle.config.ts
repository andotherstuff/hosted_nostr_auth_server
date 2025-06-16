import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config(); // Load .env file if present

export default {
  schema: './src/db/schema.ts',
  out: './migrations', // Output directory for migrations
  dialect: 'sqlite', // Specify SQLite dialect for D1
  driver: 'd1-http', // Use d1-http driver
  dbCredentials: {
    // Read from environment variables
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.DATABASE_ID!, // We'll need to set this
    token: process.env.CLOUDFLARE_API_TOKEN! // Make sure this token has D1 perms
  }
} satisfies Config; 