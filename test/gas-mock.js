/**
 * จำลองบริการของ Google Apps Script แบบย่อ เพื่อทดสอบ flow ของ LINE / API บนเครื่อง (node)
 * ไม่ได้เลียนแบบครบทุกอย่าง — พอสำหรับเส้นทางหลักของ FireCheck
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function formatDate(d, tz, fmt) {
  const t = new Date(d.getTime() + 7 * 3600 * 1000); // Asia/Bangkok
  const map = {
    yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()), u: String(t.getUTCDay() || 7)
  };
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|u/g, function (m, lit) { return lit !== undefined ? lit : map[m]; });
}
function signed(buf) { return Array.from(buf).map(function (b) { return b > 127 ? b - 256 : b; }); }

function makeBlob(bytes, type, name) {
  let n = name || 'blob';
  return {
    getBytes: function () { return bytes.slice(); }, getContentType: function () { return type; },
    setName: function (x) { n = x; return this; }, getName: function () { return n; }
  };
}

function createEnv(opts) {
  opts = opts || {};
  const sheets = {};
  const files = {};
  const outbox = { line: [], mail: [], gemini: 0 };
  const cache = {};
  const props = { SHEET_ID: 'SHEET1' };
  let geminiReply = opts.geminiReply || function () { return {}; };

  function makeSheet(name) {
    const data = [];
    const sh = {
      _data: data,
      getName: function () { return name; },
      getLastRow: function () { let n = data.length; while (n && data[n - 1].every(function (c) { return c === '' || c == null; })) n--; return n; },
      getLastColumn: function () { return data.reduce(function (m, r) { let k = r.length; while (k && (r[k - 1] === '' || r[k - 1] == null)) k--; return Math.max(m, k); }, 0); },
      getRange: function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        const ensure = function () { while (data.length < r + nr - 1) data.push([]); };
        const rg = {
          getValues: function () {
            const out = [];
            for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); }
            return out;
          },
          setValues: function (v) { ensure(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; return rg; },
          setValue: function (v) { ensure(); data[r - 1][c - 1] = v; return rg; },
          setNumberFormat: function () { return rg; }, setFontWeight: function () { return rg; }, setBackground: function () { return rg; }
        };
        return rg;
      },
      setFrozenRows: function () {}, autoResizeColumns: function () {},
      getProtections: function () { return []; },
      protect: function () { return { setDescription: function () { return this; }, addEditor: function () {}, removeEditors: function () {}, getEditors: function () { return []; }, canDomainEdit: function () { return false; }, setWarningOnly: function () {} }; },
      appendRow: function (row) { data.push(row.slice()); }
    };
    return sh;
  }
  const ss = {
    getId: function () { return 'SHEET1'; },
    getSheetByName: function (n) { return sheets[n] || null; },
    insertSheet: function (n) { sheets[n] = makeSheet(n); return sheets[n]; },
    setSpreadsheetTimeZone: function () {}
  };
  const folder = {
    getId: function () { return 'FOLDER1'; },
    createFolder: function () { return folder; },
    createFile: function (blob) {
      const id = 'F' + crypto.randomBytes(14).toString('hex');
      files[id] = blob;
      return { getId: function () { return id; }, getBlob: function () { return blob; } };
    }
  };

  const ctx = {
    console: console, JSON: JSON, Math: Math, Date: Date, Number: Number, String: String, Array: Array, Object: Object, RegExp: RegExp, Error: Error, isFinite: isFinite, parseInt: parseInt,
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return ss; }, openById: function () { return ss; },
      ProtectionType: { SHEET: 'SHEET' },
      getUi: function () { return { alert: function () {}, ButtonSet: {}, Button: {} }; }
    },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = v; } }; } },
    CacheService: { getScriptCache: function () { return { get: function (k) { return cache[k] === undefined ? null : cache[k]; }, put: function (k, v) { cache[k] = String(v); }, remove: function (k) { delete cache[k]; } }; } },
    LockService: (function () { const l = { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {} }; return { getScriptLock: function () { return l; }, getDocumentLock: function () { return l; }, getUserLock: function () { return l; } }; })(),
    Session: { getEffectiveUser: function () { return { getEmail: function () { return 'owner@gmail.com'; } }; } },
    Utilities: {
      formatDate: formatDate,
      getUuid: function () { return crypto.randomUUID(); },
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function (alg, data) { return signed(crypto.createHash(alg).update(Array.isArray(data) ? Buffer.from(data.map(function (b) { return b & 255; })) : Buffer.from(String(data), 'utf8')).digest()); },
      base64Encode: function (b) { return Buffer.from(b.map(function (x) { return x & 255; })).toString('base64'); },
      base64EncodeWebSafe: function (s) { return Buffer.from(String(s)).toString('base64url'); },
      sleep: function () {}
    },
    DriveApp: {
      getFileById: function (id) {
        if (id === 'SHEET1') return { getParents: function () { let done = false; return { hasNext: function () { return !done; }, next: function () { done = true; return folder; } }; } };
        if (!files[id]) throw new Error('no file');
        return { getId: function () { return id; }, getBlob: function () { return files[id]; } };
      },
      getFolderById: function () { return folder; }, getRootFolder: function () { return folder; },
      getFilesByName: function () { return { hasNext: function () { return false; } }; }
    },
    UrlFetchApp: {
      fetch: function (url, o) {
        const res = function (code, body, blob) { return { getResponseCode: function () { return code; }, getContentText: function () { return typeof body === 'string' ? body : JSON.stringify(body); }, getBlob: function () { return blob; } }; };
        if (url.indexOf('generativelanguage') >= 0) {
          outbox.gemini++;
          return res(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply()) }] } }] });
        }
        if (url.indexOf('/content') >= 0) return res(200, '', makeBlob(opts.jpeg || [0xFF, 0xD8, 0xFF, 0xD9, 1, 2, 3], 'image/jpeg'));
        if (url.indexOf('/profile/') >= 0) return res(200, { displayName: 'ช่างทดสอบ' });
        if (url.indexOf('/message/') >= 0) outbox.line.push({ url: url, body: JSON.parse(o.payload) });
        return res(200, {});
      }
    },
    MailApp: { sendEmail: function (m) { outbox.mail.push(m); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { text: t, setMimeType: function () { return this; } }; } },
    ScriptApp: { getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/X/exec'; } }; } }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'gas');
  const order = ['Config.gs', 'Rules.gs', 'Model.gs', 'AI.gs', 'Line.gs', 'Api.gs', 'Alerts.gs'];
  // const/let ระดับบนสุดของไฟล์ .gs ใช้ร่วมกันได้ใน GAS — ใน vm ต้องรวมเป็นสคริปต์เดียว
  const src = order.map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8').replace(/^if \(typeof module !== 'undefined'\) \{/m, 'if (false) {'); }).join('\n;\n');
  vm.runInContext(src + '\n;this.__g = function (n) { return eval(n); };', ctx);
  return {
    ctx: ctx, sheets: sheets, outbox: outbox, cache: cache, props: props, files: files,
    g: function (n) { return ctx.__g(n); },
    setGemini: function (fn) { geminiReply = fn; },
    rows: function (name) {
      const d = sheets[name]._data; const h = d[0];
      return d.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c != null; }); }).map(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i] === undefined ? '' : r[i]; }); return o; });
    }
  };
}

module.exports = { createEnv: createEnv, formatDate: formatDate };
