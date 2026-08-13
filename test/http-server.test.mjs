import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createHttpApp } from '../src/http-server.js';

function request(server, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: { ...(body ? { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } : {}), ...extraHeaders } }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data }));
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

test('health endpoint is local-safe and unauthenticated MCP requests are rejected', async () => {
  const app = createHttpApp({
    client: { async getInfo() { return { version: 'test' }; } },
    validator: { async validate() { throw new Error('unexpected validator call'); } },
    logger: { event() {} }, projectOwnerUserId: 1,
    writeEnabled: false,
    writeAllowedEmails: new Set(),
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    assert.equal((await request(server, 'GET', '/healthz')).status, 200);
    assert.equal((await request(server, 'GET', '/readyz')).status, 200);
    assert.equal((await request(server, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('MCP rejects a present Origin unless it is exactly allowlisted', async () => {
  const app = createHttpApp({
    client: { async getInfo() { return { version: 'test' }; } },
    validator: { async validate() { return { email: 'owner@example.test' }; } },
    logger: { event() {} }, writeEnabled: false, writeAllowedEmails: new Set(), projectOwnerUserId: 1,
    allowedOrigins: new Set(['https://chatgpt.com']),
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const body = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    assert.equal((await request(server, 'POST', '/mcp', body, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request(server, 'POST', '/mcp', body)).status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('authenticated requests expose usable stateless Streamable HTTP MCP responses', async () => {
  const app = createHttpApp({
    client: {
      async getInfo() { return { version: 'test' }; },
      async listProjects() { return [{ id: 7, title: 'Example project', is_archived: false }]; },
    },
    validator: { async validate() { return { email: 'owner@example.test' }; } },
    logger: { event() {} },
    writeEnabled: false, projectOwnerUserId: 1,
    writeAllowedEmails: new Set(),
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await request(server, 'POST', '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    });
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.result.serverInfo.name, 'vikunja-mcp');
    assert.equal(typeof payload.result.capabilities.tools.listChanged, 'boolean');

    const toolsResponse = await request(server, 'POST', '/mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    assert.equal(toolsResponse.status, 200);
    const toolsPayload = JSON.parse(toolsResponse.body);
    assert.ok(toolsPayload.result.tools.some((tool) => tool.name === 'list_projects'));
    assert.ok(toolsPayload.result.tools.some((tool) => tool.name === 'list_labels'));
    assert.equal(toolsPayload.result.tools.some((tool) => tool.name === 'create_task'), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('an explicitly allowed identity sees the owner-sharing project creation tool', async () => {
  const app = createHttpApp({
    client: { async getInfo() { return { version: 'test' }; } },
    validator: { async validate() { return { email: 'owner@example.test' }; } },
    logger: { event() {} }, writeEnabled: true,
    writeAllowedEmails: new Set(['owner@example.test']), projectOwnerUserId: 1,
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    await request(server, 'POST', '/mcp', {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    });
    const response = await request(server, 'POST', '/mcp', {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    const toolNames = JSON.parse(response.body).result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes('create_project'));
    assert.equal(toolNames.includes('delete_project'), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
