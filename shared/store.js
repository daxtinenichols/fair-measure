/* Fair Measure business book: the one shared store every tool reads and writes.
   Everything lives in this browser's localStorage under "fm.v1.*" keys and never leaves
   the device unless the owner downloads a backup file. Changes made in one tab or tool
   reach the others through the "storage" event. */
(function () {
  "use strict";
  var FM = (window.FM = window.FM || {});
  var PREFIX = "fm.v1.";
  var COLLECTIONS = ["customers", "items", "documents", "costings", "staff", "shifts", "sites", "cash", "trips", "time"];
  var listeners = [];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      // Usually the browser's storage quota; a large logo is the common cause.
      throw new Error("Your browser is out of space for Fair Measure data. Try a smaller logo, or download a backup and remove old documents.");
    }
    emit(key);
  }
  function emit(key, external) { listeners.forEach(function (fn) { try { fn(key, !!external); } catch (e) { /* keep going */ } }); }

  function uid() {
    var a = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  var DEFAULT_PROFILE = {
    name: "", owner: "", email: "", phone: "", website: "",
    address: "", taxId: "", logo: "",
    currency: "USD", locale: "",
    taxLabel: "Sales tax", taxRate: 0,
    termsDays: 14, quoteValidDays: 30,
    paymentInstructions: "",
    accent: "#3d5876",
    invoicePrefix: "INV-", quotePrefix: "Q-",
    nextInvoice: 1, nextQuote: 1
  };

  var store = {
    collections: COLLECTIONS.slice(),
    uid: uid,

    all: function (col) { return read(col, []); },
    get: function (col, id) { return store.all(col).find(function (r) { return r.id === id; }) || null; },
    count: function (col, filter) { var a = store.all(col); return filter ? a.filter(filter).length : a.length; },

    // Insert or update by id; returns the saved record.
    put: function (col, rec) {
      var list = store.all(col);
      var now = new Date().toISOString();
      var copy = Object.assign({}, rec);
      if (!copy.id) { copy.id = uid(); copy.createdAt = now; }
      copy.updatedAt = now;
      var i = list.findIndex(function (r) { return r.id === copy.id; });
      if (i >= 0) list[i] = copy; else list.push(copy);
      write(col, list);
      return copy;
    },
    remove: function (col, id) {
      write(col, store.all(col).filter(function (r) { return r.id !== id; }));
    },

    profile: function () { return Object.assign({}, DEFAULT_PROFILE, read("profile", {})); },
    saveProfile: function (p) { write("profile", Object.assign(store.profile(), p)); },

    // Hands out the next document number and advances the counter.
    nextNumber: function (type) {
      var p = store.profile();
      var key = type === "quote" ? "nextQuote" : "nextInvoice";
      var prefix = type === "quote" ? p.quotePrefix : p.invoicePrefix;
      var n = Math.max(1, parseInt(p[key], 10) || 1);
      var patch = {}; patch[key] = n + 1;
      store.saveProfile(patch);
      return prefix + String(n).padStart(4, "0");
    },

    onChange: function (fn) { listeners.push(fn); },

    // One file that holds the whole business book, for backups and moving devices.
    exportAll: function () {
      var data = { app: "Fair Measure", version: 1, exportedAt: new Date().toISOString(), profile: read("profile", {}) };
      COLLECTIONS.forEach(function (c) { data[c] = store.all(c); });
      return data;
    },
    importAll: function (data, mode) {
      if (!data || data.app !== "Fair Measure" || typeof data.version !== "number") {
        throw new Error("That file isn't a Fair Measure backup.");
      }
      if (data.version > 1) throw new Error("That backup comes from a newer version of Fair Measure. Reload the page and try again.");
      COLLECTIONS.forEach(function (c) {
        var incoming = Array.isArray(data[c]) ? data[c].filter(function (r) { return r && typeof r.id === "string"; }) : [];
        if (mode === "merge") {
          var byId = {};
          store.all(c).forEach(function (r) { byId[r.id] = r; });
          incoming.forEach(function (r) { if (!byId[r.id] || (r.updatedAt || "") > (byId[r.id].updatedAt || "")) byId[r.id] = r; });
          write(c, Object.keys(byId).map(function (k) { return byId[k]; }));
        } else {
          write(c, incoming);
        }
      });
      if (data.profile && typeof data.profile === "object") {
        write("profile", mode === "merge" ? Object.assign(read("profile", {}), data.profile) : data.profile);
      }
    },
    eraseAll: function () {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(PREFIX) === 0) localStorage.removeItem(k); });
      emit("*");
    },
    raw: { read: read, write: write }
  };

  window.addEventListener("storage", function (e) {
    if (e.key && e.key.indexOf(PREFIX) === 0) emit(e.key.slice(PREFIX.length), true);
  });

  // Money is kept in whole cents to avoid floating-point surprises.
  var money = {
    toCents: function (v) {
      if (typeof v === "number") return Math.round(v * 100);
      var s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
      var n = parseFloat(s);
      return isFinite(n) ? Math.round(n * 100) : 0;
    },
    format: function (cents, currency, locale) {
      var p = currency ? null : store.profile();
      try {
        return new Intl.NumberFormat(locale || (p && p.locale) || undefined, { style: "currency", currency: currency || p.currency || "USD" }).format((cents || 0) / 100);
      } catch (e) { return ((cents || 0) / 100).toFixed(2); }
    },
    plain: function (cents) { return ((cents || 0) / 100).toFixed(2); }
  };

  // Downloads the whole business book as one JSON file and remembers when.
  var backup = {
    download: function () {
      var data = store.exportAll();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fair-measure-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      write("lastBackup", new Date().toISOString());
    },
    last: function () { return read("lastBackup", null); },
    // True when there's enough data to lose and no backup in the last two weeks.
    due: function () {
      var docs = store.count("documents") + store.count("customers");
      if (docs < 3) return false;
      var last = backup.last();
      return !last || (Date.now() - Date.parse(last)) > 14 * 86400000;
    }
  };

  FM.store = store;
  FM.money = money;
  FM.backup = backup;
})();
