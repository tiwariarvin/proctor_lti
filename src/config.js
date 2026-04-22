import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: required('PUBLIC_BASE_URL').replace(/\/$/, ''),
  platformIssuer: required('PLATFORM_ISSUER').replace(/\/$/, ''),
  platformOidcAuthUrl: required('PLATFORM_OIDC_AUTH_URL'),
  platformJwksUri: required('PLATFORM_JWKS_URI'),
  ltiClientId: required('LTI_CLIENT_ID'),
  ltiTokenAudience: (process.env.LTI_TOKEN_AUDIENCE || '').trim() || null,
  allowedDeploymentIds: (process.env.ALLOWED_DEPLOYMENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  defaultTestRunnerUrl: (process.env.DEFAULT_TEST_RUNNER_URL || '').trim() || null,
  sessionSecret: required('SESSION_SECRET'),
};

export function redirectUri() {
  return `${config.publicBaseUrl}/lti/launch`;
}

export function loginInitiationUri() {
  return `${config.publicBaseUrl}/lti/login`;
}
