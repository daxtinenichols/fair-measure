/* Fair Measure Pro license.
   One license unlocks every tool. The key is checked with the store that sold it (a merchant
   of record, which handles sales tax) and the result is remembered on this device.
   This is a goodwill unlock, not DRM: we trust our customers. */
(function () {
  "use strict";
  var FM = (window.FM = window.FM || {});

  // Filled in once the store is set up. While checkoutUrl is empty, Pro shows "coming soon".
  var CONFIG = {
    provider: "polar",          // "polar" or "lemonsqueezy"
    organizationId: "ef5064c9-d81a-46af-9ba9-325eb2518d9a",  // Polar organization id
    checkoutUrl: "https://buy.polar.sh/polar_cl_gdVg4C9uSPMgkhVyhwQIQ1MbPqPt8T4S9neWq2qsFKD",
    verifyUrl: "",              // optional: our own small verify endpoint, if the store blocks browser calls
    price: "$49",
    recheckDays: 30
  };

  var LIMITS = { customers: 5, documents: 10, items: 15, costings: 10, staff: 5, cash: 30, trips: 30, time: 30, stock: 15 };
  var KEY = "license";

  function saved() { return FM.store.raw.read(KEY, null); }

  function call(key) {
    if (CONFIG.verifyUrl) {
      return fetch(CONFIG.verifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { return { ok: !!j.valid, reason: j.reason || "" }; });
    }
    if (CONFIG.provider === "lemonsqueezy") {
      var body = new URLSearchParams({ license_key: key, instance_name: "Fair Measure web" });
      return fetch("https://api.lemonsqueezy.com/v1/licenses/activate", { method: "POST", headers: { Accept: "application/json" }, body: body })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var ok = !!(j.activated || j.valid) && j.license_key && j.license_key.status !== "disabled" && j.license_key.status !== "expired";
          return { ok: ok, reason: j.error || "" };
        });
    }
    return fetch("https://api.polar.sh/v1/customer-portal/license-keys/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key, organization_id: CONFIG.organizationId })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok && j.status === "granted", reason: (j.detail && (j.detail.message || j.detail)) || "" }; });
    });
  }

  var license = {
    config: CONFIG,
    limits: LIMITS,
    available: function () { return !!CONFIG.checkoutUrl; },
    isPro: function () { var s = saved(); return !!(s && s.status === "active"); },
    maskedKey: function () { var s = saved(); return s ? "••••" + String(s.key).slice(-6) : ""; },

    // Returns {allowed, limit, used} for adding one more record to a collection.
    canAdd: function (col, used) {
      if (license.isPro()) return { allowed: true, limit: Infinity, used: used };
      var limit = LIMITS[col] == null ? Infinity : LIMITS[col];
      return { allowed: used < limit, limit: limit, used: used };
    },

    activate: function (key) {
      key = String(key || "").trim();
      if (key.length < 8) return Promise.reject(new Error("That doesn't look like a license key. Copy it from your receipt email."));
      if (!license.available()) return Promise.reject(new Error("Pro isn't on sale yet. Thank you for your patience."));
      return call(key).then(function (res) {
        if (!res.ok) throw new Error(res.reason ? "The store said: " + res.reason : "That key wasn't accepted. Check it against your receipt email.");
        FM.store.raw.write(KEY, { key: key, provider: CONFIG.provider, status: "active", checkedAt: new Date().toISOString() });
        return true;
      }, function () {
        throw new Error("We couldn't reach the store to check your key. Check your connection and try again.");
      });
    },
    deactivate: function () { FM.store.raw.write(KEY, null); },

    // Quietly re-checks an active key now and then. Being offline never takes Pro away;
    // only a clear "no" from the store does (for example after a refund).
    recheck: function () {
      var s = saved();
      if (!s || s.status !== "active" || !license.available()) return;
      var age = (Date.now() - Date.parse(s.checkedAt || 0)) / 86400000;
      if (age < CONFIG.recheckDays) return;
      call(s.key).then(function (res) {
        s.checkedAt = new Date().toISOString();
        if (!res.ok) s.status = "revoked";
        FM.store.raw.write(KEY, s);
      }, function () { /* offline: try again another day */ });
    }
  };

  FM.license = license;
  document.addEventListener("DOMContentLoaded", function () { setTimeout(license.recheck, 3000); });
})();
