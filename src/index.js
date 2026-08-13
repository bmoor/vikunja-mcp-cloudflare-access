import { CloudflareAccessJwtValidator } from './access-jwt.js';
import { loadConfig } from './config.js';
import { createHttpApp } from './http-server.js';
import { createLogger } from './logger.js';
import { VikunjaClient } from './vikunja-client.js';

const config = loadConfig();
const logger = createLogger();
const client = new VikunjaClient({
  baseUrl: config.vikunjaBaseUrl,
  apiToken: config.vikunjaApiToken,
  allowedProjectIds: config.allowedProjectIds,
  requestTimeoutMs: config.vikunjaRequestTimeoutMs,
  pageSize: config.vikunjaPageSize,
  maxPages: config.vikunjaMaxPages,
  maxResults: config.vikunjaMaxResults,
});
const validator = new CloudflareAccessJwtValidator({
  issuer: config.accessIssuer,
  audience: config.accessAudience,
  allowedEmails: config.allowedEmails,
  jwksTimeoutMs: config.accessJwksTimeoutMs,
});
const app = createHttpApp({
  client,
  validator,
  logger,
  writeEnabled: config.writeEnabled,
  writeAllowedEmails: config.writeAllowedEmails,
  projectOwnerUserId: config.projectOwnerUserId,
  allowedOrigins: config.allowedOrigins,
});

app.listen(config.port, '0.0.0.0', () => {
  logger.event('started', { port: config.port, write_enabled: config.writeEnabled });
});
