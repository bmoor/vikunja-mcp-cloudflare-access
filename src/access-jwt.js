import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AccessDeniedError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class CloudflareAccessJwtValidator {
  constructor({ issuer, audience, allowedEmails, clockToleranceSeconds = 10, jwksTimeoutMs = 5000, jwks }) {
    this.issuer = issuer.replace(/\/$/, '');
    this.audience = audience;
    this.allowedEmails = allowedEmails;
    this.clockToleranceSeconds = clockToleranceSeconds;
    this.jwks = jwks || createRemoteJWKSet(new URL(`${this.issuer}/cdn-cgi/access/certs`), {
      timeoutDuration: jwksTimeoutMs,
    });
  }

  async validate(assertion) {
    if (!assertion) {
      throw new AccessDeniedError('missing_access_assertion');
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(assertion, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockToleranceSeconds,
      }));
    } catch {
      throw new AccessDeniedError('invalid_access_assertion');
    }

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email || !this.allowedEmails.has(email)) {
      throw new AccessDeniedError('access_identity_not_allowed');
    }

    return { email, subject: typeof payload.sub === 'string' ? payload.sub : undefined };
  }
}
