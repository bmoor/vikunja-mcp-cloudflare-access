import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AccessDeniedError } from './access-jwt.js';
import { createMcpServer } from './mcp-server.js';

export function createHttpApp({ client, validator, logger, writeEnabled, writeAllowedEmails, projectOwnerUserId, allowedOrigins = new Set() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb', type: ['application/json', 'application/*+json'] }));
  app.use((_, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/healthz', (_, response) => response.status(200).json({ status: 'ok' }));
  app.get('/readyz', async (_, response) => {
    try {
      await client.getInfo();
      response.status(200).json({ status: 'ready' });
    } catch {
      response.status(503).json({ status: 'unavailable' });
    }
  });

  app.post('/mcp', async (request, response) => {
    const origin = request.get('Origin');
    if (origin && !allowedOrigins.has(origin)) {
      logger.event('origin_denied');
      response.status(403).json({ error: 'forbidden' });
      return;
    }

    let requestIdentity;
    try {
      requestIdentity = await validator.validate(request.get('Cf-Access-Jwt-Assertion'));
    } catch (error) {
      const code = error instanceof AccessDeniedError ? error.code : 'access_validation_failed';
      logger.event('access_denied', { code });
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const server = createMcpServer({ client, logger, requestIdentity, writeEnabled, writeAllowedEmails, projectOwnerUserId });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      logger.event('mcp_transport_error');
      if (!response.headersSent) response.status(500).json({ error: 'internal_error' });
    }
  });

  app.all('/mcp', (_, response) => response.status(405).json({ error: 'method_not_allowed' }));
  return app;
}
