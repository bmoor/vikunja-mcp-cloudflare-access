import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { AccessDeniedError, CloudflareAccessJwtValidator } from '../src/access-jwt.js';

const issuer = 'https://team.cloudflareaccess.com';
const audience = 'access-audience';

async function signedAssertion({ email = 'owner@example.test', aud = audience, iss = issuer }) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const assertion = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject('access-subject')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { assertion, publicKey };
}

test('validates signature, issuer, audience and allowlisted email', async () => {
  const { assertion, publicKey } = await signedAssertion({});
  const validator = new CloudflareAccessJwtValidator({
    issuer,
    audience,
    allowedEmails: new Set(['owner@example.test']),
    jwks: publicKey,
  });
  const identity = await validator.validate(assertion);
  assert.equal(identity.email, 'owner@example.test');
  assert.equal(identity.subject, 'access-subject');
});

test('rejects a valid signature with the wrong audience', async () => {
  const { assertion, publicKey } = await signedAssertion({ aud: 'wrong-audience' });
  const validator = new CloudflareAccessJwtValidator({
    issuer,
    audience,
    allowedEmails: new Set(['owner@example.test']),
    jwks: publicKey,
  });
  await assert.rejects(validator.validate(assertion), AccessDeniedError);
});

test('rejects a signed token for a user outside the Access allowlist', async () => {
  const { assertion, publicKey } = await signedAssertion({ email: 'other@example.test' });
  const validator = new CloudflareAccessJwtValidator({
    issuer,
    audience,
    allowedEmails: new Set(['owner@example.test']),
    jwks: publicKey,
  });
  await assert.rejects(validator.validate(assertion), (error) => {
    assert.ok(error instanceof AccessDeniedError);
    assert.equal(error.code, 'access_identity_not_allowed');
    return true;
  });
});
