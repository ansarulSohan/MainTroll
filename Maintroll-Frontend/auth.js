/* MainTroll sign-in with Amazon Cognito managed login (OAuth 2.0 authorization code + PKCE).

   Fill in AUTH_CONFIG after creating the user pool (see docs/cognito-auth.md).
   Leave domain or clientId empty to turn sign-in off.

   The page must be served from http://localhost or https://. The exact page URL
   (origin + path, for example http://localhost:5500/index.html) must be listed in the
   app client's "Allowed callback URLs" and "Allowed sign-out URLs".
*/
"use strict";

const AUTH_CONFIG = {
  domain: "https://eu-north-1etrtsxq1h.auth.eu-north-1.amazoncognito.com",    // Cognito domain, e.g. "https://eu-north-1abc123.auth.eu-north-1.amazoncognito.com"
  clientId: "6408a8subi3bm69mc8potsln24",  // App client ID (public client, no secret)
  scopes: "openid email"
};

const Auth = (() => {
  const TOKENS_KEY = "maintroll-auth";
  const PKCE_KEY = "maintroll-auth-pkce";
  const enabled = Boolean(AUTH_CONFIG.domain && AUTH_CONFIG.clientId);
  const base = AUTH_CONFIG.domain.replace(/\/$/, "");
  const redirectUri = location.origin + location.pathname;
  let tokens = null;
  let user = null;

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomString = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

  function decodeJwt(jwt) {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), c => c.charCodeAt(0))));
  }

  const storage = {
    get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
    set(key, v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } },
    remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } }
  };

  function setTokens(t) {
    tokens = t;
    if (t) storage.set(TOKENS_KEY, t); else storage.remove(TOKENS_KEY);
    user = null;
    if (t && t.id_token) {
      const c = decodeJwt(t.id_token);
      user = {
        name: c.name || c.given_name || c.email || c["cognito:username"] || "User",
        email: c.email || "",
        groups: c["cognito:groups"] || []
      };
    }
  }

  async function tokenRequest(params) {
    const res = await fetch(base + "/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: AUTH_CONFIG.clientId, ...params })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Sign-in failed: " + (body.error_description || body.error || res.status));
    return { ...body, expires_at: Date.now() + body.expires_in * 1000 };
  }

  /* Send the browser to the Cognito login page. Never resolves: the page navigates away. */
  async function login() {
    const verifier = randomString(32);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const state = randomString(16);
    storage.set(PKCE_KEY, { verifier, state, hash: location.hash });
    console.info("[auth] Redirecting to Cognito. This exact URL must be in the app client's Allowed callback URLs:", redirectUri);
    location.assign(base + "/oauth2/authorize?" + new URLSearchParams({
      response_type: "code",
      client_id: AUTH_CONFIG.clientId,
      redirect_uri: redirectUri,
      scope: AUTH_CONFIG.scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    }));
    return new Promise(() => {});
  }

  /* Cognito redirects back with ?code=...&state=... (or ?error=...). */
  async function handleCallback() {
    const params = new URLSearchParams(location.search);
    if (!params.has("code") && !params.has("error")) return false;
    const saved = storage.get(PKCE_KEY);
    storage.remove(PKCE_KEY);
    history.replaceState(null, "", redirectUri + (saved?.hash || ""));
    if (params.has("error")) throw new Error("Sign-in failed: " + (params.get("error_description") || params.get("error")));
    // A login this page did not start (e.g. "View login page" in the AWS console) can't be
    // verified. Ignore the code; init() then starts a fresh login, which Cognito completes
    // without asking again because the user already has a Cognito session.
    if (!saved || saved.state !== params.get("state")) return false;
    setTokens(await tokenRequest({
      grant_type: "authorization_code",
      code: params.get("code"),
      redirect_uri: redirectUri,
      code_verifier: saved.verifier
    }));
    return true;
  }

  /* Parallel API calls that all get a 401 share one refresh, so a rotated refresh
     token is never used twice. */
  let refreshing = null;
  function refresh() {
    if (!tokens?.refresh_token) return Promise.resolve(false);
    if (!refreshing) {
      const current = tokens.refresh_token;
      refreshing = tokenRequest({ grant_type: "refresh_token", refresh_token: current })
        .then(t => { setTokens({ ...t, refresh_token: t.refresh_token || current }); return true; })
        .catch(err => { console.warn("[auth] Token refresh failed:", err.message); setTokens(null); return false; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  return {
    enabled,
    get user() { return user; },

    /* Call once on page load. Finishes a login redirect, or starts one if not signed in. */
    async init() {
      if (!enabled) return;
      const stored = storage.get(TOKENS_KEY);
      if (stored) setTokens(stored);
      if (await handleCallback()) return;
      if (!tokens) await login();
    },

    /* A valid access token for the API (refreshes or re-logs in when needed). */
    async getToken() {
      if (!enabled) return null;
      if (tokens && Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
      if (await refresh()) return tokens.access_token;
      return login();
    },

    /* After a 401: try a refresh once, otherwise go back to the login page. */
    async recover() {
      if (await refresh()) return;
      await login();
    },

    logout() {
      setTokens(null);
      if (!enabled) return;
      location.assign(base + "/logout?" + new URLSearchParams({
        client_id: AUTH_CONFIG.clientId,
        logout_uri: redirectUri
      }));
    }
  };
})();
