const dotenv = require('dotenv');
const path = require('path');

const envFound = dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (envFound.error && process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-console
  console.warn('⚠️  No .env file found, relying on process environment variables.');
}

const requiredEnvVars = ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'API_KEY', 'API_SCOPE'];
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

module.exports = {
  tenantId: process.env.TENANT_ID,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  apiKey: process.env.API_KEY,
  apiScope: process.env.API_SCOPE,
  port: process.env.API_PORT ? Number(process.env.API_PORT) : 3001,
};
