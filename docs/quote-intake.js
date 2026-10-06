// Website quote intake configuration. Replace the email key before publishing; use the test widget key for practice hosts.
// Web3Forms sends to the inbox attached to its access key; visitors cannot choose a recipient.
export const QUOTE_CONFIG = Object.freeze({
  crmEndpoint: "https://detlings-crm.netlify.app/api/public/quote-requests",
  turnstileSiteKey: "0x4AAAAAAFO2QbS9b69Q0r6Y", // production widget, hostname detlingsdetailing.com
  web3formsAccessKey: "REPLACE_WITH_VERIFIED_WEB3FORMS_ACCESS_KEY",
  web3formsEndpoint: "https://api.web3forms.com/submit",
});

const PENDING_KEY = "detlings-quote-pending-v1";
const EMAIL_PREFIX = "detlings-quote-email-attempt-v1:";
const SERVICE_ORDER = ["Full Detail", "Interior", "Exterior"];
const VEHICLE_TYPES = ["Coupe/Sedan", "SUV (2 Rows)", "Truck", "SUV (3 Rows)", "Other (4+ Rows)"];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function safeStorage(storage) {
  return {
    get(key) { try { return storage.getItem(key); } catch { return null; } },
    set(key, value) { try { storage.setItem(key, value); } catch { /* Private browsing may block storage. */ } },
    remove(key) { try { storage.removeItem(key); } catch { /* The in-memory ID still works in this tab. */ } },
  };
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateQuoteValues(values) {
  const fields = [];
  for (const field of ["firstName", "lastName"]) {
    const value = clean(values[field]);
    if (value.length < 1 || value.length > 100 || CONTROL.test(value)) fields.push(field);
  }
  const phone = clean(values.phone);
  const digits = phone.replace(/\D/g, "");
  if (phone.length < 1 || phone.length > 30 || CONTROL.test(phone)
    || !(/^\d{10}$/.test(digits) || /^1\d{10}$/.test(digits))) fields.push("phone");
  const email = clean(values.email);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push("email");
  if (!Array.isArray(values.services) || values.services.length < 1 || values.services.length > 3
    || new Set(values.services).size !== values.services.length
    || values.services.some((service) => !SERVICE_ORDER.includes(service))) fields.push("services");
  if (!VEHICLE_TYPES.includes(values.vehicleType)) fields.push("vehicleType");
  if (typeof values.conditionNotes !== "string" || clean(values.conditionNotes).length > 2000) fields.push("conditionNotes");
  if (!/^\d{5}(?:-\d{4})?$/.test(clean(values.postalCode))) fields.push("postalCode");
  if (typeof values.nonMarketingAccepted !== "boolean" || typeof values.marketingAccepted !== "boolean") fields.push("consent");
  if (typeof values.nonMarketingText !== "string" || values.nonMarketingText.length > 1000
    || typeof values.marketingText !== "string" || values.marketingText.length > 1000) fields.push("consent");
  if (values.website !== "") fields.push("website");
  return [...new Set(fields)];
}

function canonicalPayload(values) {
  return {
    firstName: clean(values.firstName),
    lastName: clean(values.lastName),
    phone: clean(values.phone),
    email: clean(values.email),
    services: [...values.services].sort((a, b) => SERVICE_ORDER.indexOf(a) - SERVICE_ORDER.indexOf(b)),
    vehicleType: values.vehicleType,
    conditionNotes: clean(values.conditionNotes),
    postalCode: clean(values.postalCode),
    consentVersion: "website-quote-v1",
    nonMarketingConsent: { accepted: values.nonMarketingAccepted, text: values.nonMarketingText.replace(/\s+/g, " ").trim() },
    marketingConsent: { accepted: values.marketingAccepted, text: values.marketingText.replace(/\s+/g, " ").trim() },
    website: "",
  };
}

async function withTimeout(fetchImpl, url, options, timeoutMs, readBody = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, credentials: "omit" });
    return readBody ? { response, body: await response.json() } : response;
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmailCopy({ config, fetchImpl, storage, requestId, payload, timeoutMs }) {
  if (!config.web3formsAccessKey || config.web3formsAccessKey.startsWith("REPLACE_")) return;
  const marker = EMAIL_PREFIX + requestId;
  if (storage.get(marker)) return;
  storage.set(marker, "attempted");
  const copy = {
    access_key: config.web3formsAccessKey,
    subject: "New website quote request",
    from_name: "Detling's Detailing website",
    email: payload.email,
    first_name: payload.firstName,
    last_name: payload.lastName,
    phone: payload.phone,
    services: payload.services.join(", "),
    vehicle_type: payload.vehicleType,
    condition_notes: payload.conditionNotes,
    postal_code: payload.postalCode,
    request_reference: requestId,
  };
  try {
    await withTimeout(fetchImpl, config.web3formsEndpoint, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(copy),
    }, timeoutMs);
  } catch {
    // The CRM save is authoritative; a missed email does not ask for another save.
  }
}

export function createQuoteIntakeFlow({
  config,
  storage: storageSource,
  fetchImpl,
  getToken,
  fingerprint,
  randomUUID,
  redirect,
  crmTimeoutMs = 12_000,
  emailTimeoutMs = 5_000,
}) {
  const storage = safeStorage(storageSource);
  let inFlight = false;
  let memoryPending = null;

  async function submit(values) {
    if (inFlight) return { kind: "pending" };
    inFlight = true;
    try {
      const fields = validateQuoteValues(values);
      if (fields.length) return { kind: "invalid", fields };
      const canonical = canonicalPayload(values);
      const digest = await fingerprint(canonical);
      let pending = memoryPending;
      if (!pending) {
        try { pending = JSON.parse(storage.get(PENDING_KEY) ?? "null"); } catch { pending = null; }
      }
      if (!pending || pending.fingerprint !== digest || !UUID_V4.test(pending.requestId)) {
        pending = { fingerprint: digest, requestId: randomUUID() };
      }
      memoryPending = pending;
      storage.set(PENDING_KEY, JSON.stringify(pending));

      let token;
      try { token = await getToken(); } catch { return { kind: "bot_unavailable" }; }
      if (!token) return { kind: "bot_unavailable" };

      let response;
      let body;
      try {
        ({ response, body } = await withTimeout(fetchImpl, config.crmEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: pending.requestId, ...canonical, turnstileToken: token }),
        }, crmTimeoutMs, true));
      } catch {
        return { kind: "uncertain" };
      }

      if (response.status === 200 && body?.ok === true) {
        memoryPending = null;
        storage.remove(PENDING_KEY);
        await sendEmailCopy({ config, fetchImpl, storage, requestId: pending.requestId,
          payload: canonical, timeoutMs: emailTimeoutMs });
        redirect("/thanks.html");
        return { kind: "saved" };
      }
      if (response.status === 400 && body?.code === "invalid_request") {
        return { kind: "invalid", fields: Array.isArray(body.fields) ? body.fields : [] };
      }
      if (response.status === 403) {
        return { kind: body?.code === "bot_verification_failed" ? "bot_failed" : "origin_rejected" };
      }
      if (response.status === 409 && body?.code === "consent_version_conflict") return { kind: "refresh" };
      if (response.status === 409 && body?.code === "request_conflict") {
        memoryPending = null;
        storage.remove(PENDING_KEY);
        return { kind: "request_conflict" };
      }
      if (response.status === 413) return { kind: "too_large" };
      if (response.status === 415) return { kind: "wrong_format" };
      if (response.status === 429) {
        const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
        return { kind: "rate_limited", retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 60 };
      }
      if (response.status === 503) return { kind: "unavailable" };
      return { kind: "uncertain" };
    } finally {
      inFlight = false;
    }
  }
  return { submit };
}

async function browserFingerprint(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loadTurnstile() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => reject(new Error("bot script timed out")), 10_000);
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => { clearTimeout(timer); window.turnstile ? resolve(window.turnstile) : reject(new Error("bot script unavailable")); };
    script.onerror = () => { clearTimeout(timer); reject(new Error("bot script unavailable")); };
    document.head.append(script);
  });
}

function browserToken(turnstile, widgetId, pendingToken) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => fail(), 120_000);
    function finish(token) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingToken.current = null;
      resolve(token);
    }
    function fail() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingToken.current = null;
      reject(new Error("bot verification unavailable"));
    }
    pendingToken.current = { finish, fail };
    try {
      turnstile.reset(widgetId);
      turnstile.execute(widgetId);
    } catch { fail(); }
  });
}

function formValues(form) {
  const byId = (id) => form.querySelector(`#${id}`);
  return {
    firstName: byId("first_name").value,
    lastName: byId("last_name").value,
    phone: byId("phone").value,
    email: byId("email").value,
    services: [...form.querySelectorAll(".svc:checked")].map((input) => input.value),
    vehicleType: byId("vehicle_type").value,
    conditionNotes: byId("condition").value,
    postalCode: byId("postal_code").value,
    nonMarketingAccepted: byId("non_marketing_consent").checked,
    marketingAccepted: byId("marketing_consent").checked,
    nonMarketingText: byId("non_marketing_wording").textContent,
    marketingText: byId("marketing_wording").textContent,
    website: byId("website").value,
  };
}

const FIELD_IDS = {
  firstName: "first_name", lastName: "last_name", phone: "phone", email: "email",
  services: "service_first", vehicleType: "vehicle_type", conditionNotes: "condition",
  postalCode: "postal_code", nonMarketingConsent: "non_marketing_consent",
  marketingConsent: "marketing_consent", consentVersion: "non_marketing_consent",
};

const MESSAGES = {
  invalid: "Please check the highlighted details and try again.",
  bot_failed: "The security check did not finish. Please try again, or call, text or email us.",
  bot_unavailable: "The security check is unavailable. Please call, text or email us instead.",
  origin_rejected: "This form is unavailable from this address. Please call, text or email us.",
  refresh: "The form wording changed. Please refresh this page before trying again.",
  request_conflict: "Your request changed while sending. Please review the details and try again.",
  too_large: "The request is too long. Please shorten the notes and try again.",
  wrong_format: "This form could not be sent. Please refresh the page, or call, text or email us.",
  unavailable: "We could not save your request right now. Please try again, or call, text or email us.",
  uncertain: "We're not sure your request was received. You can safely try again with the same details, or call, text or email us.",
};

export async function startQuoteForm({ button, fallback, createFlow }) {
  fallback.hidden = true;
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const flow = await createFlow();
    button.disabled = false;
    button.textContent = "Submit request";
    return { ready: true, flow };
  } catch {
    fallback.hidden = false;
    return { ready: false };
  }
}

export async function initQuoteForm() {
  const form = document.getElementById("quote-form");
  if (!form) return;
  const button = document.getElementById("quote-submit");
  const summary = document.getElementById("quote-error-summary");
  const fallback = document.getElementById("quote-fallback");
  let ready = false;
  let pending = false;
  let flow;

  function showError(message, fieldNames = []) {
    summary.textContent = message;
    summary.hidden = false;
    for (const input of form.querySelectorAll('[aria-invalid="true"]')) input.removeAttribute("aria-invalid");
    const first = fieldNames.map((field) => form.querySelector(`#${FIELD_IDS[field] ?? field}`)).find(Boolean);
    if (first) {
      first.setAttribute("aria-invalid", "true");
      first.focus();
    } else summary.focus();
    fallback.hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ready || pending) return;
    pending = true;
    button.disabled = true;
    button.textContent = "Sending…";
    summary.hidden = true;
    try {
      const result = await flow.submit(formValues(form));
      if (result.kind === "saved") return;
      if (result.kind === "rate_limited") {
        const minutes = Math.ceil(result.retryAfterSeconds / 60);
        showError(`Too many requests right now. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} before trying again, or call, text or email us.`);
      } else {
        showError(MESSAGES[result.kind] ?? MESSAGES.uncertain, result.fields ?? []);
      }
    } finally {
      pending = false;
      button.textContent = "Submit request";
      button.disabled = !ready;
    }
  });

  const started = await startQuoteForm({ button, fallback, createFlow: async () => {
    if (!crypto?.randomUUID || !crypto?.subtle) throw new Error("browser security functions unavailable");
    const turnstile = await loadTurnstile();
    const pendingToken = { current: null };
    const widgetId = turnstile.render("#quote-turnstile", {
      sitekey: QUOTE_CONFIG.turnstileSiteKey,
      action: "quote_intake",
      appearance: "interaction-only",
      execution: "execute",
      "refresh-expired": "never",
      retry: "never",
      callback: (token) => pendingToken.current?.finish(token),
      "error-callback": () => pendingToken.current?.fail(),
      "expired-callback": () => pendingToken.current?.fail(),
      "timeout-callback": () => pendingToken.current?.fail(),
    });
    if (widgetId === undefined || widgetId === null) throw new Error("bot widget unavailable");
    return createQuoteIntakeFlow({
      config: QUOTE_CONFIG,
      storage: window.sessionStorage,
      fetchImpl: window.fetch.bind(window),
      getToken: () => browserToken(turnstile, widgetId, pendingToken),
      fingerprint: browserFingerprint,
      randomUUID: () => crypto.randomUUID(),
      redirect: (path) => window.location.assign(path),
    });
  } });
  ready = started.ready;
  flow = started.flow;
  if (!ready) {
    showError("The form cannot start right now. Please call, text or email us instead.");
  }
}

if (typeof document !== "undefined") void initQuoteForm();
