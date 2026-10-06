// Owned browser contexts only. Fixtures bypass probes; product operations use real IndexedDB.
export async function probeProgress(context, { prefix, readFlag, quotaFlag, readSessionKey } = {}) {
  await context.addInitScript(({ prefix, readFlag, quotaFlag, readSessionKey }) => {
    const open = IDBFactory.prototype.open, transact = IDBDatabase.prototype.transaction;
    const create = IDBDatabase.prototype.createObjectStore;
    const get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add, remove = IDBObjectStore.prototype.delete;
    const legacyGet = Storage.prototype.getItem, legacySet = Storage.prototype.setItem, legacyRemove = Storage.prototype.removeItem;
    window[`${prefix}Writes`] = 0; window.__progressPuts = 0; window.__progressTransactions = 0;
    window.__progressTrace = []; window.__progressLegacyWrites = 0;
    const note = (kind, extra = {}) => { if (window.__progressTrace.length < 500) window.__progressTrace.push({ kind, time: performance.timeOrigin + performance.now(), ...extra }); };
    const blocked = () => window[readFlag] || (readSessionKey && sessionStorage.getItem(readSessionKey) === '1');
    const owned = (table) => table.name === 'progress' && table.transaction.db.name === 'cw.progress';
    IDBFactory.prototype.open = function (...args) {
      if (args[0] === 'cw.progress' && window.__progressOpenBlocked) throw new DOMException('blocked', 'SecurityError');
      if (args[0] === 'cw.progress' && window.__progressBlockedUpgrade) return open.call(this, 'cw.progress', 2);
      return open.apply(this, args);
    };
    IDBDatabase.prototype.createObjectStore = function (...args) {
      if (this.name === 'cw.progress' && window.__progressUpgradeFailure) throw new DOMException('upgrade', 'QuotaExceededError');
      return create.apply(this, args);
    };
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transact.apply(this, args);
      if (this.name === 'cw.progress' && args[1] === 'readwrite') {
        const id = ++window.__progressTransactions; note('queued', { id });
        tx.addEventListener('complete', () => note('commit', { id }));
        tx.addEventListener('abort', () => note('abort', { id }));
      }
      return tx;
    };
    IDBObjectStore.prototype.get = function (...args) {
      if (owned(this) && blocked()) throw new DOMException('blocked read', 'SecurityError');
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (!owned(this)) return put.apply(this, args);
      if (window[quotaFlag]) throw new DOMException('quota', 'QuotaExceededError');
      window.__progressPuts++; note('put');
      const request = window.__progressRequestFailure ? add.apply(this, args) : put.apply(this, args), tx = this.transaction;
      if (window.__progressRequestFailure) request.addEventListener('error', () => { window.__progressFailureName = request.error.name; });
      tx.addEventListener('complete', () => { window[`${prefix}Writes`]++; });
      if (window.__progressAbortPut) request.addEventListener('success', () => tx.abort());
      return request;
    };
    Storage.prototype.getItem = function (key) {
      if (key === 'cw.progress' && (blocked() || window.__progressLegacyBlocked)) throw new DOMException('blocked legacy', 'SecurityError');
      return legacyGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cw.progress') window.__progressLegacyWrites++;
      return legacySet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) { if (key === 'cw.progress') window.__progressLegacyWrites++; return legacyRemove.call(this, key); };
    async function database() {
      return new Promise((resolve, reject) => {
        const request = open.call(indexedDB, 'cw.progress', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('progress');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    async function record(action, value) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = transact.call(db, 'progress', ['read', 'raw', 'presence'].includes(action) ? 'readonly' : 'readwrite'), table = tx.objectStore('progress');
        let raw, present;
        const request = ['read', 'raw'].includes(action) ? get.call(table, 'cw.progress') : action === 'presence' ? table.count('cw.progress') : action === 'put' ? put.call(table, value, 'cw.progress') : remove.call(table, 'cw.progress');
        request.onsuccess = () => { raw = request.result; };
        if (action === 'raw') { const exists = table.count('cw.progress'); exists.onsuccess = () => { present = exists.result; }; }
        tx.oncomplete = () => { db.close(); resolve(action === 'raw' ? { raw, present } : raw); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      });
    }
    window.__progressFixture = {
      legacy: (value) => value === null ? legacyRemove.call(localStorage, 'cw.progress') : legacySet.call(localStorage, 'cw.progress', value),
      legacyRaw: () => legacyGet.call(localStorage, 'cw.progress'),
      resetDatabase: () => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('cw.progress');
        const timer = setTimeout(() => reject(new Error('database cleanup blocked by a leaked connection')), 10000);
        request.onsuccess = () => { clearTimeout(timer); resolve(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error('database cleanup blocked by a leaked connection')); };
      }),
      async blockUpgrade() { window.__progressBlockingConnection = await database(); },
      releaseUpgrade() { window.__progressBlockingConnection.close(); },
      record: () => record('read'), seed: (value) => record('put', value), clear: () => record('delete'),
      present: () => record('presence'),
      async raw() { const value = await record('raw'); return value.present === 0 ? legacyGet.call(localStorage, 'cw.progress') : value.raw; },
      async hold() {
        const db = await database();
        const tx = transact.call(db, 'progress', 'readwrite'), table = tx.objectStore('progress');
        window.__saveHolding = false; window.__saveReleaseRequested = false; window.__saveQueueBase = window.__progressTransactions;
        window.__saveHold = new Promise((resolve, reject) => {
          tx.oncomplete = () => { db.close(); window.__saveHolding = false; resolve(); };
          tx.onabort = () => { db.close(); window.__saveHolding = false; reject(tx.error); };
        });
        // Real outstanding requests keep the transaction alive; no await/timer inside it.
        const pump = () => {
          const request = get.call(table, 'cw.progress');
          request.onsuccess = () => { window.__saveHolding = true; window.__saveHeldRaw = request.result;
            if (!window.__saveReleaseRequested) pump(); };
        };
        pump();
      },
      async release() { window.__saveReleaseRequested = true; await window.__saveHold; },
    };
  }, { prefix, readFlag, quotaFlag, readSessionKey });
}
export const progressRaw = (page) => page.evaluate(() => window.__progressFixture.raw());
export const seedProgress = (page, raw) => page.evaluate((value) => window.__progressFixture.seed(value), raw);
export async function holdProgressTransaction(page) {
  await page.evaluate(() => window.__progressFixture.hold());
  await page.waitForFunction(() => window.__saveHolding);
}
export const releaseProgressTransaction = (page) => page.evaluate(() => window.__progressFixture.release());
