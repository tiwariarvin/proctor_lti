import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bodyParser from 'body-parser';
import { nanoid } from 'nanoid';
import { config, redirectUri, loginInitiationUri } from './config.js';
import { verifyLtiLaunchToken } from './ltiJwt.js';
import { createOidcStateJwt, verifyOidcStateJwt } from './oidcState.js';

const app = express();
app.set('trust proxy', 1);
app.use(bodyParser.urlencoded({ extended: false }));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '..', 'public')));

function buildAuthRedirectUrl({
  loginHint,
  ltiMessageHint,
  targetLinkUri,
  clientId,
  state,
  nonce,
}) {
  const u = new URL(config.platformOidcAuthUrl);
  const p = u.searchParams;
  p.set('response_type', 'id_token');
  p.set('response_mode', 'form_post');
  p.set('prompt', 'none');
  p.set('scope', 'openid');
  p.set('client_id', clientId);
  p.set('redirect_uri', redirectUri());
  p.set('state', state);
  p.set('nonce', nonce);
  p.set('login_hint', loginHint);
  if (ltiMessageHint) p.set('lti_message_hint', ltiMessageHint);
  if (targetLinkUri) p.set('target_link_uri', targetLinkUri);
  return u.toString();
}

function renderShellPage({ testRunnerUrl, userName, deploymentId }) {
  const boot = {
    testRunnerUrl,
    userName,
    deploymentId,
    controlChannel: 'd2l-lti-test-runner-control',
  };

  const bootJson = JSON.stringify(boot)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Test runner (LTI)</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px;
      border-bottom: 1px solid #ccc; flex-wrap: wrap;
    }
    header h1 { font-size: 1rem; margin: 0; flex: 1 1 auto; }
    .btn {
      border: 1px solid #888; background: #f4f4f4; color: inherit; border-radius: 8px;
      padding: 8px 14px; font: inherit; cursor: pointer;
    }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn.primary { background: #1a5fb4; color: #fff; border-color: #174ea0; }
    .wrap { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
    iframe { flex: 1; width: 100%; border: 0; min-height: 0; }
    .overlay {
      position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.35); color: #fff; font-size: 1.25rem; letter-spacing: 0.02em;
    }
    .overlay.on { display: flex; }
    .banner { padding: 12px 14px; border-bottom: 1px solid #c9a227; background: #fff7d6; color: #3b3200; }
    .meta { font-size: 0.85rem; opacity: 0.85; }
  </style>
</head>
<body>
  <header>
    <h1>Test session</h1>
    <button class="btn primary" type="button" id="btn-play">Play</button>
    <button class="btn" type="button" id="btn-pause">Pause</button>
    <button class="btn" type="button" id="btn-stop">Stop</button>
    <span class="meta" id="status">Idle</span>
  </header>
  <div class="banner" id="no-url" hidden>
    No <code>test_runner_url</code> was provided on this launch. In Brightspace, add a custom parameter
    <code>test_runner_url</code> on the link/deployment, or set <code>DEFAULT_TEST_RUNNER_URL</code> in the tool server environment.
  </div>
  <div class="wrap">
    <iframe id="frame" title="Test runner" allow="fullscreen; autoplay; microphone; camera; display-capture"></iframe>
    <div class="overlay" id="overlay" aria-live="polite">Paused</div>
  </div>
  <script>
    window.__LTI_TEST_RUNNER__ = ${bootJson};
  </script>
  <script>
    (function () {
      var cfg = window.__LTI_TEST_RUNNER__ || {};
      var frame = document.getElementById('frame');
      var overlay = document.getElementById('overlay');
      var status = document.getElementById('status');
      var noUrl = document.getElementById('no-url');
      var channel = cfg.controlChannel || 'd2l-lti-test-runner-control';

      function post(action) {
        try {
          if (frame.contentWindow) {
            frame.contentWindow.postMessage({ channel: channel, action: action }, '*');
          }
        } catch (e) {}
      }

      function setStatus(t) { status.textContent = t; }

      var playing = false;
      var paused = false;

      function syncButtons() {
        document.getElementById('btn-play').disabled = playing && !paused;
        document.getElementById('btn-pause').disabled = !playing || paused;
        var hasFrame = !!(frame.getAttribute('src') || frame.srcdoc);
        document.getElementById('btn-stop').disabled = !hasFrame && !playing && !paused;
      }

      document.getElementById('btn-play').addEventListener('click', function () {
        var url = cfg.testRunnerUrl;
        if (!url) return;
        overlay.classList.remove('on');
        paused = false;
        if (!playing) {
          frame.removeAttribute('srcdoc');
          frame.src = url;
          playing = true;
          setStatus('Running');
          post('play');
        } else {
          frame.removeAttribute('srcdoc');
          setStatus('Running');
          post('resume');
        }
        syncButtons();
      });

      document.getElementById('btn-pause').addEventListener('click', function () {
        if (!playing) return;
        paused = true;
        overlay.classList.add('on');
        setStatus('Paused (interaction blocked)');
        post('pause');
        syncButtons();
      });

      document.getElementById('btn-stop').addEventListener('click', function () {
        post('stop');
        frame.removeAttribute('src');
        frame.srcdoc = '<!doctype html><title></title><body style="margin:0;display:flex;align-items:center;justify-content:center;font-family:system-ui">Stopped</body>';
        playing = false;
        paused = false;
        overlay.classList.remove('on');
        setStatus('Stopped');
        syncButtons();
      });

      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d || typeof d !== 'object') return;
        if (d.channel !== channel) return;
        if (d.action === 'paused') setStatus('Paused (runner reported)');
        if (d.action === 'playing') setStatus('Running');
        if (d.action === 'stopped') setStatus('Stopped');
      });

      if (!cfg.testRunnerUrl) {
        noUrl.hidden = false;
        setStatus('Missing URL');
      } else {
        setStatus('Idle — press Play');
      }
      syncButtons();
    })();
  </script>
</body>
</html>`;
}

async function handleLogin(req, res) {
  const q = { ...req.query, ...req.body };
  const iss = String(q.iss || '');
  const loginHint = String(q.login_hint || '');
  const targetLinkUri = String(q.target_link_uri || '');
  const ltiMessageHint = q.lti_message_hint != null ? String(q.lti_message_hint) : '';
  const clientId = String(q.client_id || '');

  if (!iss || !loginHint || !targetLinkUri || !clientId) {
    res.status(400).send('Missing OIDC parameters (iss, login_hint, target_link_uri, client_id).');
    return;
  }

  if (iss.replace(/\/$/, '') !== config.platformIssuer.replace(/\/$/, '')) {
    res.status(400).send('Unexpected issuer.');
    return;
  }

  if (clientId !== config.ltiClientId) {
    res.status(400).send('Unexpected client_id.');
    return;
  }

  const nonce = nanoid(32);
  let stateJwt;
  try {
    stateJwt = await createOidcStateJwt({
      nonce,
      iss,
      clientId,
      targetLinkUri,
      loginHint,
      ltiMessageHint,
    });
  } catch {
    res.status(500).send('Failed to create OIDC state.');
    return;
  }

  const redirectUrl = buildAuthRedirectUrl({
    loginHint,
    ltiMessageHint,
    targetLinkUri,
    clientId,
    state: stateJwt,
    nonce,
  });

  res.redirect(redirectUrl);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/lti/login', handleLogin);
app.post('/lti/login', handleLogin);

app.post('/lti/launch', async (req, res) => {
  const idToken = req.body?.id_token;
  const stateJwt = req.body?.state;

  if (typeof idToken !== 'string' || !idToken || typeof stateJwt !== 'string' || !stateJwt) {
    res.status(400).send('Missing id_token or state.');
    return;
  }

  let oidcCtx;
  try {
    oidcCtx = await verifyOidcStateJwt(stateJwt);
  } catch {
    res.status(400).send('Invalid or expired OIDC state.');
    return;
  }

  if (oidcCtx.iss.replace(/\/$/, '') !== config.platformIssuer.replace(/\/$/, '')) {
    res.status(400).send('Unexpected issuer in OIDC state.');
    return;
  }

  if (oidcCtx.clientId !== config.ltiClientId) {
    res.status(400).send('Unexpected client_id in OIDC state.');
    return;
  }

  try {
    const launch = await verifyLtiLaunchToken(idToken, oidcCtx.nonce);
    let ancestors = `'self' ${config.platformIssuer}`;
    try {
      ancestors += ` ${new URL(config.platformIssuer).origin}`;
    } catch {
      // ignore
    }
    res.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
    res
      .type('html')
      .send(
        renderShellPage({
          testRunnerUrl: launch.testRunnerUrl,
          userName: launch.user.name,
          deploymentId: launch.deploymentId,
        }),
      );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Launch failed';
    res.status(400).send(`LTI launch validation failed: ${msg}`);
  }
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>LTI tool</title>
  <p>OIDC Login initiation URL (register in Brightspace): <code>${loginInitiationUri()}</code></p>
  <p>Redirect / launch URL: <code>${redirectUri()}</code></p>`);
});

app.listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});
