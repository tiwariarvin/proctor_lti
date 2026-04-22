# D2L test runner LTI wrapper

LTI 1.3 tool for **Brightspace (D2L)** that completes the OIDC launch flow and serves a small **wrapper** around an embedded test runner. Instructors configure which URL loads in the iframe; learners use **Play**, **Pause**, and **Stop** in the tool chrome.

## Prerequisites

- **Node.js 18 or newer** (includes `npm`). [Download Node.js LTS](https://nodejs.org/) or install with Windows Package Manager: `winget install OpenJS.NodeJS.LTS`
- A **public HTTPS URL** for the tool (for example a reverse proxy or tunnel such as ngrok). Brightspace must reach your `/lti/login` and `/lti/launch` endpoints over HTTPS.
- Brightspace admin access: **Settings (org)** → **Manage Extensibility** → **LTI Advantage** (names vary slightly by org).

## Quick start

1. Clone or copy this repository and open a terminal in the project root (`POC1`).

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your environment file from the example:

   ```bash
   copy .env.example .env
   ```

   On macOS or Linux:

   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your real values (see [Environment variables](#environment-variables)).

5. Start the server:

   ```bash
   npm start
   ```

   For development with auto-restart on file changes:

   ```bash
   npm run dev
   ```

6. Confirm the process is listening (default port **3000** unless you set `PORT`). Optional check:

   ```text
   GET {PUBLIC_BASE_URL}/health
   ```

   Expect JSON: `{"ok":true}`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port (default `3000`). Your reverse proxy should forward HTTPS traffic here. |
| `PUBLIC_BASE_URL` | Yes | Public base URL of **this tool**, no trailing slash, for example `https://lti-wrapper.example.com`. Used to build `/lti/login` and `/lti/launch` and to validate the `target_link_uri` claim. Must match what you register in Brightspace. |
| `PLATFORM_ISSUER` | Yes | Brightspace **Issuer** from the tool registration details (typically your instance base URL, no trailing slash). |
| `PLATFORM_OIDC_AUTH_URL` | Yes | Brightspace **OpenID Connect Authentication URL** (OIDC authorization endpoint). Often similar to `https://<host>/d2l/lti/authenticate`; copy the exact value from your registration. |
| `PLATFORM_JWKS_URI` | Yes | Brightspace **Keyset URL** (JWKS) used to verify platform `id_token` signatures. Often `https://<host>/d2l/.well-known/jwks`. |
| `LTI_CLIENT_ID` | Yes | **Client ID** Brightspace assigned to this tool registration. |
| `LTI_TOKEN_AUDIENCE` | No | If Brightspace lists a separate **OAuth2 Audience** for the `id_token`, set it here. If omitted, the tool uses `LTI_CLIENT_ID` as the expected audience. |
| `ALLOWED_DEPLOYMENT_IDS` | No | Comma-separated **Deployment IDs** the tool will accept. If empty, **any** deployment id in a valid `id_token` is accepted (fine for early testing; tighten for production). |
| `DEFAULT_TEST_RUNNER_URL` | No | Absolute HTTPS URL used when the launch does not supply `test_runner_url` via custom parameters. |
| `SESSION_SECRET` | Yes | Long random string used to sign short-lived OIDC **state** JWTs (HS256). Use a strong secret in production. |

See `.env.example` for a template.

## Brightspace: register the tool

1. In Brightspace: **Settings** → **Manage Extensibility** → **LTI Advantage** → **Register Tool** / **Manage Tools** (wording may vary).

2. Register a **standard** (or manual) LTI 1.3 tool and provide at least:

   | Brightspace field | Value |
   | --- | --- |
   | **Domain** | Hostname from your `PUBLIC_BASE_URL` (no path). |
   | **Target Link URI** | `{PUBLIC_BASE_URL}/lti/launch` |
   | **OpenID Connect Login URL** | `{PUBLIC_BASE_URL}/lti/login` |
   | **Redirect URLs** | `{PUBLIC_BASE_URL}/lti/launch` |

3. After registration, open the tool’s **registration details** in Brightspace and copy into `.env`:

   - Issuer → `PLATFORM_ISSUER`
   - OpenID Connect Authentication URL → `PLATFORM_OIDC_AUTH_URL`
   - Keyset URL → `PLATFORM_JWKS_URI`
   - Client ID → `LTI_CLIENT_ID`
   - OAuth2 Audience (if shown separately) → `LTI_TOKEN_AUDIENCE` (optional)

4. Create a **deployment** for the org or course, note the **Deployment ID**, and add it to `ALLOWED_DEPLOYMENT_IDS` when you want to restrict launches.

5. Add a **link** (or placement) that launches this tool in a course. On the link or deployment, add a **custom LTI parameter** so the iframe knows what to load:

   | Name | Example value |
   | --- | --- |
   | `test_runner_url` | `https://your-runner.example.com/path` |

   Use an absolute URL. If you omit this, set `DEFAULT_TEST_RUNNER_URL` in `.env` instead.

## How the launch flow works

1. The LMS sends the browser to **`/lti/login`** with standard OIDC parameters (`iss`, `login_hint`, `target_link_uri`, `client_id`, `lti_message_hint`, …).

2. The tool redirects the browser to Brightspace’s authentication URL with `response_type=id_token`, `response_mode=form_post`, and a signed **state** JWT (no cookies).

3. Brightspace POSTs to **`/lti/launch`** with `id_token` and `state`. The tool verifies **state**, then verifies the **`id_token`** with the platform JWKS, checks deployment (if configured), and checks that **`target_link_uri`** matches `{PUBLIC_BASE_URL}/lti/launch`.

4. The tool returns HTML with **Play / Pause / Stop** and an iframe whose `src` is set from the LTI custom claim **`test_runner_url`** (or `DEFAULT_TEST_RUNNER_URL`).

## Wrapper controls and optional `postMessage` API

- **Play**: sets the iframe `src` to the configured URL and sends `postMessage` `play`.
- **Pause**: blocks interaction with a full-page overlay and sends `postMessage` `pause` (does not freeze third-party timers inside cross-origin content).
- **Stop**: clears the iframe and sends `postMessage` `stop`.

Embedded pages may listen for:

```js
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.channel !== 'd2l-lti-test-runner-control') return;
  // d.action is one of: 'play', 'resume', 'pause', 'stop'
});
```

This repo includes a trivial demo page at **`/demo-runner.html`** (served as static content) for local testing of the message channel.

## Limitations

- **Embedding Brightspace’s own quiz UI** inside the iframe often fails because Brightspace sets framing restrictions (`X-Frame-Options` / CSP). This tool is intended for runners or content you control that **allow** being framed, or for URLs that are designed to be embedded.
- **Pause** cannot reliably pause timers or server-side state inside another origin’s app unless that app cooperates (for example via `postMessage`).

## Project layout

- `src/server.js` — Express app, OIDC login redirect, LTI launch, player HTML shell.
- `src/ltiJwt.js` — Validates the platform `id_token` (JWKS, audience, nonce, deployment, `target_link_uri`, resource link message type).
- `src/oidcState.js` — Signs and verifies the OIDC **state** JWT.
- `src/config.js` — Environment configuration.
- `public/demo-runner.html` — Demo listener for control messages.

## Troubleshooting

- **`npm` not found**: Install Node.js LTS and **open a new terminal** so `PATH` updates. On Windows you can run `"C:\Program Files\nodejs\npm.cmd" install` if `npm` is not on the path yet.
- **Launch fails with audience or issuer errors**: Compare `PLATFORM_ISSUER`, `LTI_CLIENT_ID`, and optional `LTI_TOKEN_AUDIENCE` with the registration details exactly (no accidental spaces).
- **`target_link_uri` mismatch**: `PUBLIC_BASE_URL` must match the scheme, host, port, and path prefix Brightspace sends for the launch URL (same origin and `/lti/launch` path as registered).
- **Deployment rejected**: Add the deployment GUID to `ALLOWED_DEPLOYMENT_IDS`, or clear that variable while testing.
