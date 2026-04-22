import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const encoder = new TextEncoder();

function getSecretKey() {
  return encoder.encode(config.sessionSecret);
}

export async function createOidcStateJwt({
  nonce,
  iss,
  clientId,
  targetLinkUri,
  loginHint,
  ltiMessageHint,
}) {
  const jwt = await new SignJWT({
    platformIss: iss,
    clientId,
    targetLinkUri,
    loginHint,
    ltiMessageHint,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('d2l-lti-test-runner-wrapper')
    .setSubject(nonce)
    .setAudience('lti-oidc-state')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSecretKey());

  return jwt;
}

/**
 * @param {string} stateJwt
 */
export async function verifyOidcStateJwt(stateJwt) {
  const { payload } = await jwtVerify(stateJwt, getSecretKey(), {
    audience: 'lti-oidc-state',
    issuer: 'd2l-lti-test-runner-wrapper',
  });

  const nonce = typeof payload.sub === 'string' ? payload.sub : '';
  const iss = typeof payload.platformIss === 'string' ? payload.platformIss : '';
  const clientId = typeof payload.clientId === 'string' ? payload.clientId : '';
  const targetLinkUri =
    typeof payload.targetLinkUri === 'string' ? payload.targetLinkUri : '';
  const loginHint = typeof payload.loginHint === 'string' ? payload.loginHint : '';
  const ltiMessageHint =
    typeof payload.ltiMessageHint === 'string' ? payload.ltiMessageHint : '';

  if (!nonce) throw new Error('Invalid OIDC state: missing nonce');
  if (!iss || !clientId || !targetLinkUri) {
    throw new Error('Invalid OIDC state: missing fields');
  }

  return {
    nonce,
    iss,
    clientId,
    targetLinkUri,
    loginHint,
    ltiMessageHint,
  };
}
