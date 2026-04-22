import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config, redirectUri } from './config.js';

const DEPLOYMENT_CLAIM =
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id';
const MESSAGE_TYPE_CLAIM =
  'https://purl.imsglobal.org/spec/lti/claim/message_type';
const TARGET_LINK_CLAIM =
  'https://purl.imsglobal.org/spec/lti/claim/target_link_uri';
const CUSTOM_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/custom';
const VERSION_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/version';
const ROLES_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/roles';

let jwks;

function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(config.platformJwksUri));
  return jwks;
}

/**
 * @param {string} idToken
 * @param {string} nonce
 */
export async function verifyLtiLaunchToken(idToken, nonce) {
  const audience = config.ltiTokenAudience || config.ltiClientId;
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: config.platformIssuer,
    audience,
  });

  if (payload.nonce !== nonce) {
    throw new Error('Invalid nonce');
  }

  const deploymentId = payload[DEPLOYMENT_CLAIM];
  if (typeof deploymentId !== 'string' || !deploymentId) {
    throw new Error('Missing deployment_id claim');
  }

  if (
    config.allowedDeploymentIds.length &&
    !config.allowedDeploymentIds.includes(deploymentId)
  ) {
    throw new Error('Deployment not allowed');
  }

  const messageType = payload[MESSAGE_TYPE_CLAIM];
  if (messageType !== 'LtiResourceLinkRequest') {
    throw new Error(`Unsupported LTI message type: ${messageType}`);
  }

  const targetLinkUri = payload[TARGET_LINK_CLAIM];
  if (typeof targetLinkUri !== 'string' || !targetLinkUri) {
    throw new Error('Missing target_link_uri claim');
  }

  const expected = new URL(redirectUri());
  const actual = new URL(targetLinkUri);
  const norm = (p) => p.replace(/\/$/, '') || '/';
  if (
    actual.origin !== expected.origin ||
    norm(actual.pathname) !== norm(expected.pathname)
  ) {
    throw new Error('target_link_uri does not match this tool launch URL');
  }

  const custom =
    payload[CUSTOM_CLAIM] && typeof payload[CUSTOM_CLAIM] === 'object'
      ? payload[CUSTOM_CLAIM]
      : {};

  const testRunnerUrl =
    (typeof custom.test_runner_url === 'string' && custom.test_runner_url) ||
    (typeof custom.testRunnerUrl === 'string' && custom.testRunnerUrl) ||
    config.defaultTestRunnerUrl;

  return {
    deploymentId,
    messageType,
    targetLinkUri,
    version: payload[VERSION_CLAIM],
    roles: Array.isArray(payload[ROLES_CLAIM]) ? payload[ROLES_CLAIM] : [],
    user: {
      sub: typeof payload.sub === 'string' ? payload.sub : null,
      name: typeof payload.name === 'string' ? payload.name : null,
      email: typeof payload.email === 'string' ? payload.email : null,
    },
    testRunnerUrl,
    rawClaims: payload,
  };
}
