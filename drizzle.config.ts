import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/src/db/schema.ts',
  out: './server/src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './server/data/learning-studio.db',
  },
});
