import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const quotePath = fileURLToPath(new URL("../docs/quote.html", import.meta.url));
const scriptPath = fileURLToPath(new URL("../docs/quote-intake.js", import.meta.url));
const quoteHtml = readFileSync(quotePath, "utf8");
const nonMarketingText = "By checking this box, I consent to receive non-marketing text messages from Detling's Detailing LLC at the phone number provided. Message frequency varies, message & data rates may apply. Text HELP for assistance, reply STOP to opt out.";
const marketingText = "By checking this box, I consent to receive marketing and promotional messages including special offers, discounts, new service updates among others, from Detling's Detailing LLC at the phone number provided. Frequency may vary. Message & data rates may apply. Text HELP for assistance, reply STOP to opt out.";

function values(nonMarketing = false, marketing = false) {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: "513-444-9924",
    email: "ada@example.test",
    services: ["Full Detail", "Interior"],
    vehicleType: "SUV (2 Rows)",
    conditionNotes: "Pet hair",
    postalCode: "45202",
    nonMarketingAccepted: nonMarketing,
    marketingAccepted: marketing,
    nonMarketingText,
    marketingText,
    website: "",
  };
}

async function loadFlow() {
  assert.ok(existsSync(scriptPath), "the website must include its quote intake script");
  return import(new URL("../docs/quote-intake.js", import.meta.url));
}

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

const fingerprint = (payload) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");

function harness(module, overrides = {}) {
  const calls = { crm: [], email: [], token: 0, redirects: [] };
  const storage = makeStorage();
  let serial = 0;
  const config = {
    crmEndpoint: "http://127.0.0.1:3000/api/public/quote-requests",
    turnstileSiteKey: "1x00000000000000000000AA",
    web3formsAccessKey: "local-stub-key",
    web3formsEndpoint: "http://127.0.0.1:9911/web3forms-stub",
  };
  const fetchImpl = async (url, options) => {
    if (url === config.crmEndpoint) {
      calls.crm.push(JSON.parse(options.body));
      return new Response('{"ok":true}', { status: 200 });
    }
    calls.email.push(JSON.parse(options.body));
    return new Response('{"success":true}', { status: 200 });
  };
  const flow = module.createQuoteIntakeFlow({
    config,
    storage,
    fetchImpl: overrides.fetchImpl ?? fetchImpl,
    getToken: overrides.getToken ?? (async () => { calls.token += 1; return `proof-${calls.token}`; }),
    fingerprint: async (payload) => fingerprint(payload),
    randomUUID: () => `e8a1b4b4-9a83-4ce6-8d59-${String(++serial).padStart(12, "0")}`,
    redirect: (path) => calls.redirects.push(path),
  });
  return { calls, storage, flow, config };
}

test("the page cannot submit natively and shows a contact fallback if scripts fail", () => {
  assert.doesNotMatch(quoteHtml, /<form[^>]+method=["']POST["']/i);
  assert.doesNotMatch(quoteHtml, /<form[^>]+action=["']https:\/\/api\.web3forms\.com/i);
  assert.match(quoteHtml, /id=["']quote-fallback["'][^>]+hidden/i);
  assert.match(quoteHtml, /<script[^>]+src=["']\/quote-intake\.js["']/i);
  assert.match(quoteHtml, /href=["']tel:\+15134449924["']/);
  assert.match(quoteHtml, /contact@detlingsdetailing\.com/);
});

test("the contact fallback stays hidden after startup and appears if startup fails", async () => {
  const module = await loadFlow();
  const button = { disabled: true, textContent: "Loading…" };
  const fallback = { hidden: true };

  const started = await module.startQuoteForm({ button, fallback, createFlow: async () => ({ submit: async () => ({ kind: "saved" }) }) });
  assert.equal(started.ready, true);
  assert.equal(fallback.hidden, true);

  const failed = await module.startQuoteForm({ button, fallback, createFlow: async () => { throw new Error("Turnstile failed"); } });
  assert.equal(failed.ready, false);
  assert.equal(fallback.hidden, false);
});

test("all four consent combinations send explicit answers, exact text and only schema fields", async () => {
  const module = await loadFlow();
  for (const [nonMarketing, marketing] of [[false, false], [true, false], [false, true], [true, true]]) {
    const { flow, calls } = harness(module);
    assert.deepEqual(await flow.submit(values(nonMarketing, marketing)), { kind: "saved" });
    assert.equal(calls.crm.length, 1);
    const payload = calls.crm[0];
    assert.deepEqual(Object.keys(payload).sort(), [
      "conditionNotes", "consentVersion", "email", "firstName", "lastName",
      "marketingConsent", "nonMarketingConsent", "phone", "postalCode",
      "requestId", "services", "turnstileToken", "vehicleType", "website",
    ]);
    assert.equal(payload.consentVersion, "website-quote-v1");
    assert.deepEqual(payload.nonMarketingConsent, { accepted: nonMarketing, text: nonMarketingText });
    assert.deepEqual(payload.marketingConsent, { accepted: marketing, text: marketingText });
    assert.equal(payload.website, "");
    assert.equal(calls.email.length, 1);
    assert.equal(calls.email[0].request_reference, payload.requestId);
    assert.ok(!JSON.stringify(calls.email[0]).includes("proof-"));
    assert.deepEqual(calls.redirects, ["/thanks.html"]);
  }
});

test("a double click starts one CRM request and an uncertain retry reuses its ID", async () => {
  const module = await loadFlow();
  const storage = makeStorage();
  const seen = new Map();
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let first = true;
  const flow = module.createQuoteIntakeFlow({
    config: {
      crmEndpoint: "http://local/crm", turnstileSiteKey: "1x00000000000000000000AA",
      web3formsAccessKey: "stub", web3formsEndpoint: "http://local/email",
    },
    storage,
    fingerprint: async (payload) => fingerprint(payload),
    randomUUID: () => "e8a1b4b4-9a83-4ce6-8d59-52de57a3360e",
    getToken: async () => `proof-${calls.length + 1}`,
    redirect: () => {},
    fetchImpl: async (url, options) => {
      if (url.endsWith("/email")) return new Response('{"success":true}', { status: 200 });
      const body = JSON.parse(options.body);
      calls.push(body);
      if (!seen.has(body.requestId)) seen.set(body.requestId, body);
      if (first) {
        first = false;
        await gate;
        throw new TypeError("simulated lost response");
      }
      return new Response('{"ok":true}', { status: 200 });
    },
  });
  const pending = flow.submit(values());
  assert.deepEqual(await flow.submit(values()), { kind: "pending" });
  release();
  assert.deepEqual(await pending, { kind: "uncertain" });
  assert.deepEqual(await flow.submit(values()), { kind: "saved" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.notEqual(calls[0].turnstileToken, calls[1].turnstileToken);
  assert.equal(seen.size, 1, "a lost response and retry must create one logical lead");
});

test("a changed payload replaces its ID; 429 and 503 never send email", async () => {
  const module = await loadFlow();
  const { flow, calls, config } = harness(module, {
    fetchImpl: async (url, options) => {
      if (url === config.crmEndpoint) {
        const body = JSON.parse(options.body);
        calls.crm.push(body);
        return new Response(JSON.stringify({ ok: false, code: calls.crm.length === 1 ? "rate_limited" : "temporarily_unavailable" }), {
          status: calls.crm.length === 1 ? 429 : 503,
          headers: calls.crm.length === 1 ? { "retry-after": "42" } : {},
        });
      }
      calls.email.push(JSON.parse(options.body));
      return new Response('{"success":true}', { status: 200 });
    },
  });
  assert.deepEqual(await flow.submit(values()), { kind: "rate_limited", retryAfterSeconds: 42 });
  assert.deepEqual(await flow.submit({ ...values(), conditionNotes: "Changed" }), { kind: "unavailable" });
  assert.notEqual(calls.crm[0].requestId, calls.crm[1].requestId);
  assert.equal(calls.email.length, 0);
});

test("email failure or timeout still redirects, but a failed CRM save never sends email", async () => {
  const module = await loadFlow();
  for (const emailMode of ["rejected", "blocked"]) {
    const calls = { crm: 0, email: 0, redirects: [] };
    const flow = module.createQuoteIntakeFlow({
      config: { crmEndpoint: "http://local/crm", turnstileSiteKey: "1x00000000000000000000AA", web3formsAccessKey: "stub", web3formsEndpoint: "http://local/email" },
      storage: makeStorage(), fingerprint: async () => "hash", randomUUID: () => "e8a1b4b4-9a83-4ce6-8d59-52de57a3360e",
      emailTimeoutMs: 20,
      getToken: async () => "proof", redirect: (path) => calls.redirects.push(path),
      fetchImpl: async (url, options) => {
        if (url.endsWith("/crm")) {
          calls.crm += 1;
          return new Response('{"ok":true}', { status: 200 });
        }
        calls.email += 1;
        if (emailMode === "rejected") throw new TypeError("blocked email copy");
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
      },
    });
    assert.deepEqual(await flow.submit(values()), { kind: "saved" });
    assert.deepEqual(calls.redirects, ["/thanks.html"]);
    assert.equal(calls.email, 1);
  }
  const blocked = harness(module, { fetchImpl: async () => new Response('{"ok":false,"code":"temporarily_unavailable"}', { status: 503 }) });
  assert.deepEqual(await blocked.flow.submit(values()), { kind: "unavailable" });
  assert.equal(blocked.calls.email.length, 0);
  assert.deepEqual(blocked.calls.redirects, []);
});
