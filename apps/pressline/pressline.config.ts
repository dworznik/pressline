import { defineConfig } from './src/lib/server/config/schema';

// Operator configuration (ADR-0014). Edit, commit, redeploy.
// Secrets live in the platform environment; see .env.example.
export default defineConfig({
  name: 'Pressline',
  currency: 'EUR',
  engines: [{ slug: 'sample', baseUrl: 'http://localhost:5174' }],
});
