import { readFileSync } from 'node:fs';

function required(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Required configuration is missing: ${name}`);
  }
  return String(value).trim();
}

function secret(name, env) {
  const file = env[`${name}_FILE`];
  if (file && String(file).trim()) {
    try {
      return required(`${name}_FILE`, readFileSync(String(file).trim(), 'utf8'));
    } catch (error) {
      throw new Error(`Could not read ${name}_FILE: ${error.code || 'invalid_file'}`);
    }
  }
  return required(name, env[name]);
}

function emailSet(value) {
  return new Set(String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
}

function booleanValue(name, value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function strictInteger(name, value, { fallback, min, max }) {
  const raw = value === undefined || value === '' ? String(fallback) : String(value);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function projectIdSet(value) {
  if (String(value || '').trim().toLowerCase() === 'all') return null;
  const rawIds = String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!rawIds.length || rawIds.some((id) => !/^\d+$/.test(id))) {
    throw new Error('VIKUNJA_ALLOWED_PROJECT_IDS must be a comma-separated list of positive project IDs');
  }
  const ids = rawIds.map((id) => Number(id));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error('VIKUNJA_ALLOWED_PROJECT_IDS must contain unique positive project IDs');
  }
  return new Set(ids);
}

function requiredPositiveInteger(name, value) {
  const raw = required(name, value);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}

function originSet(value) {
  const origins = String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const result = new Set();
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('MCP_ALLOWED_ORIGINS must contain valid HTTP(S) origins');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('MCP_ALLOWED_ORIGINS entries must be exact HTTP(S) origins without a path');
    }
    result.add(origin);
  }
  return result;
}

export function loadConfig(env = process.env) {
  const accessIssuer = required('CF_ACCESS_ISSUER', env.CF_ACCESS_ISSUER).replace(/\/$/, '');
  const allowedEmails = emailSet(required('CF_ACCESS_ALLOWED_EMAILS', env.CF_ACCESS_ALLOWED_EMAILS));
  const writeEnabled = booleanValue('MCP_WRITE_ENABLED', env.MCP_WRITE_ENABLED, false);
  const writeAllowedEmails = emailSet(env.MCP_WRITE_ALLOWED_EMAILS);

  if (writeEnabled && writeAllowedEmails.size === 0) {
    throw new Error('MCP_WRITE_ALLOWED_EMAILS is required when MCP_WRITE_ENABLED=true');
  }

  const ownerUserIdValue = env.VIKUNJA_MCP_OWNER_USER_ID;
  if (writeEnabled && (!ownerUserIdValue || !String(ownerUserIdValue).trim())) {
    throw new Error('VIKUNJA_MCP_OWNER_USER_ID is required when MCP_WRITE_ENABLED=true');
  }

  const pageSize = strictInteger('VIKUNJA_PAGE_SIZE', env.VIKUNJA_PAGE_SIZE, { fallback: 50, min: 1, max: 100 });
  const maxResults = strictInteger('VIKUNJA_MAX_RESULTS', env.VIKUNJA_MAX_RESULTS, { fallback: 1000, min: pageSize, max: 10000 });

  return {
    port: strictInteger('PORT', env.PORT, { fallback: 3000, min: 1, max: 65535 }),
    vikunjaBaseUrl: required('VIKUNJA_BASE_URL', env.VIKUNJA_BASE_URL).replace(/\/$/, ''),
    vikunjaApiToken: secret('VIKUNJA_MCP_API_TOKEN', env),
    allowedProjectIds: projectIdSet(required('VIKUNJA_ALLOWED_PROJECT_IDS', env.VIKUNJA_ALLOWED_PROJECT_IDS)),
    projectOwnerUserId: ownerUserIdValue && String(ownerUserIdValue).trim()
      ? requiredPositiveInteger('VIKUNJA_MCP_OWNER_USER_ID', ownerUserIdValue)
      : undefined,
    vikunjaRequestTimeoutMs: strictInteger('VIKUNJA_REQUEST_TIMEOUT_MS', env.VIKUNJA_REQUEST_TIMEOUT_MS, { fallback: 10000, min: 100, max: 120000 }),
    vikunjaPageSize: pageSize,
    vikunjaMaxPages: strictInteger('VIKUNJA_MAX_PAGES', env.VIKUNJA_MAX_PAGES, { fallback: 20, min: 1, max: 100 }),
    vikunjaMaxResults: maxResults,
    accessIssuer,
    accessAudience: required('CF_ACCESS_AUDIENCE', env.CF_ACCESS_AUDIENCE),
    accessJwksTimeoutMs: strictInteger('CF_ACCESS_JWKS_TIMEOUT_MS', env.CF_ACCESS_JWKS_TIMEOUT_MS, { fallback: 5000, min: 100, max: 120000 }),
    allowedEmails,
    allowedOrigins: originSet(env.MCP_ALLOWED_ORIGINS),
    writeEnabled,
    writeAllowedEmails,
  };
}
