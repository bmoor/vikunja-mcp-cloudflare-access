import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

function env(overrides = {}) {
  return {
    VIKUNJA_BASE_URL: 'http://vikunja:3456', VIKUNJA_MCP_API_TOKEN: 'test-only-token',
    VIKUNJA_ALLOWED_PROJECT_IDS: '7', VIKUNJA_MCP_OWNER_USER_ID: '1', CF_ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
    CF_ACCESS_AUDIENCE: 'audience', CF_ACCESS_ALLOWED_EMAILS: 'owner@example.test', ...overrides,
  };
}

test('configuration rejects integer suffixes and malformed origins', () => {
  assert.throws(() => loadConfig(env({ PORT: '3000oops' })), /PORT must be an integer/);
  assert.throws(() => loadConfig(env({ VIKUNJA_ALLOWED_PROJECT_IDS: '7oops' })), /project IDs/);
  assert.throws(() => loadConfig(env({ MCP_ALLOWED_ORIGINS: 'https://chatgpt.com/mcp' })), /exact HTTP/);
});

test('configuration exposes bounded defaults and an empty optional Origin allowlist', () => {
  const config = loadConfig(env());
  assert.equal(config.port, 3000);
  assert.equal(config.vikunjaRequestTimeoutMs, 10000);
  assert.equal(config.accessJwksTimeoutMs, 5000);
  assert.equal(config.allowedOrigins.size, 0);
});

test('configuration permits an all-access project scope only as the exact all keyword', () => {
  assert.equal(loadConfig(env({ VIKUNJA_ALLOWED_PROJECT_IDS: 'all' })).allowedProjectIds, null);
  assert.throws(() => loadConfig(env({ VIKUNJA_ALLOWED_PROJECT_IDS: 'all,7' })), /project IDs/);
});

test('project owner is required only when writes are enabled', () => {
  assert.equal(loadConfig(env({ VIKUNJA_MCP_OWNER_USER_ID: '' })).projectOwnerUserId, undefined);
  assert.throws(() => loadConfig(env({
    MCP_WRITE_ENABLED: 'true',
    MCP_WRITE_ALLOWED_EMAILS: 'owner@example.test',
    VIKUNJA_MCP_OWNER_USER_ID: '',
  })), /VIKUNJA_MCP_OWNER_USER_ID is required/);
});
