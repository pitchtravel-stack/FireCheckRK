/**
 * Line.gs — LINE OA สำหรับช่างผู้ตรวจ
 * ช่างพิมพ์ PIN 6 หลักครั้งแรกบนเครื่อง (บัญชี LINE) → ส่งรูปบัตรเช็ค → ระบบอ่านด้วย Gemini แล้วตอบผลทันที
 * Webhook: <web app /exec URL>?key=<LINE_WEBHOOK_KEY>   (ดูได้จากเมนู FireCheck > 4)
 */

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_DATA_API = 'https://api-data.line.me/v2/bot';
const RECENT_MIN = 30;        // คำสั่ง FE012 / รูปชำรุด / ยกเลิก / หมายเหตุ ใช้กับรูปที่ส่งภายในกี่นาที
const PIN_MAX_FAIL = 5;

function handleLineWebhook_(body) {
  (body.events || []).forEach(function (ev) {
    try {
      handleLineEvent_(ev);
    } catch (e) {
      log_('ERROR', 'LINE ' + (ev.type || '') + ': ' + (e.stack || e));
      try { if (ev.replyToken) lineReply_(ev.replyToken, [lineText_('ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง')]); } catch (x) { /* ignore */ }
    }
  });
}

function handleLineEvent_(ev) {
  const cache = CacheService.getScriptCache();
  if (ev.webhookEventId) {
    const k = 'ev_' + ev.webhookEventId;
    if (cache.get(k)) return;               // LINE ส่งซ้ำ (redelivery)
    cache.put(k, '1', 3600);
  }
  const src = ev.source || {};
  if (src.type !== 'user') {
    if (ev.type === 'message' && ev.replyToken) lineReply_(ev.replyToken, [lineText_('กรุณาส่งรูปบัตรในแชตส่วนตัวกับ FireCheck')]);
    return;
  }
  const uid = src.userId;
  if (ev.type === 'follow') { lineReply_(ev.replyToken, [lineText_(lineHelpText_(true), true)]); return; }
  if (ev.type !== 'message') return;
  const m = ev.message || {};
  if (m.type === 'text') return onLineText_(ev, uid, m.text);
  if (m.type === 'image') return onLineImage_(ev, uid, m);
  if (m.type === 'location') return onLineLocation_(ev, uid, m);
  lineReply_(ev.replyToken, [lineText_('ส่งได้เฉพาะรูปบัตรเช็ค หรือพิมพ์ "วิธีใช้"', true)]);
}

/* ---------- เข้าสู่ระบบด้วย PIN (ผูกกับบัญชี LINE ของเครื่องที่ใช้) ---------- */

function isActive_(v) { return !(v === false || String(v).toUpperCase() === 'FALSE'); }

function lineSession_(uid) {
  const dev = findRow_(SH.DEV, 'Line_User_ID', uid);
  if (!dev || !dev.Staff_ID) return { dev: dev, staff: null };
  const exp = dev.Expires_At ? isoOf_(dev.Expires_At) : '';
  if (exp && exp < nowIso_()) return { dev: dev, staff: null, expired: true };
  const staff = findRow_(SH.STAFF, 'Staff_ID', dev.Staff_ID);
  if (!staff || !isActive_(staff.Active)) return { dev: dev, staff: null };
  return { dev: dev, staff: staff };
}

function touchSession_(sess, st) {
  const f = { Last_Seen_At: nowIso_() };
  if (st.LINE_SESSION_HOURS > 0) f.Expires_At = isoPlusHours_(st.LINE_SESSION_HOURS);
  setCells_(SH.DEV, sess.dev._row, f);
}

function onLinePin_(ev, uid, pin, st) {
  const cache = CacheService.getScriptCache();
  const fk = 'pinfail_' + uid;
  const fails = Number(cache.get(fk) || 0);
  if (fails >= PIN_MAX_FAIL) { lineReply_(ev.replyToken, [lineText_('ใส่ PIN ผิดหลายครั้ง กรุณารอ 30 นาที หรือติดต่อทีม ENV')]); return; }
  const h = hashPin_(pin);
  const staff = readObjects_(SH.STAFF).filter(function (s) { return String(s.PIN_Hash) === h && isActive_(s.Active); })[0];
  if (!staff) {
    cache.put(fk, String(fails + 1), 1800);
    lineReply_(ev.replyToken, [lineText_('PIN ไม่ถูกต้อง (ลองได้อีก ' + (PIN_MAX_FAIL - fails - 1) + ' ครั้ง)')]);
    return;
  }
  cache.remove(fk);
  const now = nowIso_();
  const lineName = lineProfileName_(uid);
  withScriptLock_(function () {
    const dev = findRow_(SH.DEV, 'Line_User_ID', uid);
    const obj = {
      Line_User_ID: uid, Line_Name: lineName, Staff_ID: String(staff.Staff_ID), Staff_Name: String(staff.Name),
      Login_At: now, Expires_At: st.LINE_SESSION_HOURS > 0 ? isoPlusHours_(st.LINE_SESSION_HOURS) : '', Last_Seen_At: now
    };
    if (dev) writeObject_(SH.DEV, dev._row, obj); else appendObjects_(SH.DEV, [obj]);
  });

  // รูปที่ส่งมาก่อนเข้าสู่ระบบ → บันทึกไว้ให้ trigger อ่านแล้วแจ้งผลทีหลัง
  const pend = takePending_(uid);
  let saved = 0;
  if (pend.length) {
    const sess = lineSession_(uid);
    pend.forEach(function (p) {
      try { saveLinePhoto_(sess, uid, p.id, p.ts, '', 'NEW'); saved++; } catch (e) { log_('WARN', 'pending photo ' + p.id + ': ' + e); }
    });
  }
  lineReply_(ev.replyToken, [lineText_('เข้าสู่ระบบแล้ว: ' + staff.Name +
    (st.LINE_SESSION_HOURS > 0 ? '\n(หมดอายุเมื่อไม่ได้ใช้งาน ' + st.LINE_SESSION_HOURS + ' ชม.)' : '') +
    (saved ? '\n\nบันทึกรูปที่ส่งไว้ก่อนหน้า ' + saved + ' รูปแล้ว ระบบจะอ่านและแจ้งผลภายในประมาณ 10 นาที' : '\n\nส่งรูปบัตรเช็คได้เลย (ส่งทีละหลายรูปได้)'), true)]);
}

function addPending_(uid, msgId, ts) {
  const cache = CacheService.getScriptCache();
  const k = 'pend_' + uid;
  const list = JSON.parse(cache.get(k) || '[]');
  if (list.length < 20) list.push({ id: msgId, ts: ts });
  cache.put(k, JSON.stringify(list), 3600);
  return list.length;
}
function takePending_(uid) {
  const cache = CacheService.getScriptCache();
  const k = 'pend_' + uid;
  const list = JSON.parse(cache.get(k) || '[]');
  cache.remove(k);
  return list;
}

/* ---------- ข้อความ ---------- */

function onLineText_(ev, uid, text) {
  const st = getSettings_();
  const c = parseLineText(text);
  if (c.cmd === 'pin') return onLinePin_(ev, uid, c.value, st);
  if (c.cmd === 'help') return lineReply_(ev.replyToken, [lineText_(lineHelpText_(false), true)]);

  const sess = lineSession_(uid);
  if (!sess.staff) {
    return lineReply_(ev.replyToken, [lineText_(sess.expired ? 'หมดเวลาใช้งานบนเครื่องนี้ พิมพ์ PIN 6 หลักอีกครั้ง' : 'พิมพ์ PIN 6 หลักที่ได้รับจากทีม ENV เพื่อเข้าสู่ระบบบนเครื่องนี้')]);
  }
  touchSession_(sess, st);
  const cache = CacheService.getScriptCache();
  const recent = getRecent_(uid);

  if (c.cmd === 'logout') {
    setCells_(SH.DEV, sess.dev._row, { Staff_ID: '', Staff_Name: '', Expires_At: '' });
    return lineReply_(ev.replyToken, [lineText_('ออกจากระบบบนเครื่องนี้แล้ว\nคนต่อไปพิมพ์ PIN ของตัวเองเพื่อเข้าสู่ระบบ')]);
  }
  if (c.cmd === 'status') return lineReply_(ev.replyToken, [lineText_(lineStatusText_(sess), true)]);
  if (c.cmd === 'tank') return onLineTank_(ev, uid, sess, c.value, recent);

  if (!recent) {
    return lineReply_(ev.replyToken, [lineText_('ยังไม่มีรูปที่ส่งในช่วง ' + RECENT_MIN + ' นาทีนี้\nส่งรูปบัตรเช็ค หรือพิมพ์ "วิธีใช้"', true)]);
  }
  if (c.cmd === 'defect') {
    cache.put('defect_' + uid, recent.rowId, 900);
    return lineReply_(ev.replyToken, [lineText_('ส่งรูปจุดชำรุดของ ' + (recent.device || 'รูปล่าสุด') + ' ได้เลย (1 รูป)', true)]);
  }
  if (c.cmd === 'cancel') {
    const a = findRow_(SH.AI, 'Row_ID', recent.rowId);
    if (a) setCells_(SH.AI, a._row, { Status: 'CANCELLED', Error: 'ช่างยกเลิกทาง LINE ' + nowIso_() });
    clearRecent_(uid);
    return lineReply_(ev.replyToken, [lineText_('ยกเลิกรูป ' + (recent.device || '') + ' ล่าสุดแล้ว', true)]);
  }
  // ข้อความอื่น = หมายเหตุของรูปล่าสุด
  const i = findRow_(SH.INSP, 'Row_ID', recent.rowId);
  if (i) {
    const note = (String(i.Note || '') ? String(i.Note) + ' · ' : '') + c.value;
    setCells_(SH.INSP, i._row, { Note: note.slice(0, 500) });
  }
  lineReply_(ev.replyToken, [lineText_('บันทึกหมายเหตุของ ' + (recent.device || 'รูปล่าสุด') + ' แล้ว', true)]);
}

/** ช่างพิมพ์รหัสถัง: แก้/ระบุรหัสของรูปล่าสุด หรือจองไว้ใช้กับรูปถัดไป */
function onLineTank_(ev, uid, sess, tank, recent) {
  const tank0 = loadTanks_().filter(function (t) { return t.id === tank; })[0];
  if (!tank0) return lineReply_(ev.replyToken, [lineText_('ไม่พบรหัสถัง ' + tank + ' ในทะเบียน')]);
  if (recent) {
    const a = findRow_(SH.AI, 'Row_ID', recent.rowId);
    const i = findRow_(SH.INSP, 'Row_ID', recent.rowId);
    if (a && i) {
      if (String(a.Status) === 'OK' && String(a.Device_ID) === tank) {
        return lineReply_(ev.replyToken, [lineText_('รูปล่าสุดบันทึกเป็น ' + tank + ' อยู่แล้ว', true)]);
      }
      lineLoading_(uid);
      setCells_(SH.INSP, i._row, { Device_ID: tank });
      i.Device_ID = tank;
      a.Status = 'PROCESSING';
      a.Claimed_At = nowIso_();
      const r = readCardNow_(a, i);
      setRecent_(uid, r);
      return lineReply_(ev.replyToken, [lineText_(lineReceiptText_(r, i), true)]);
    }
  }
  CacheService.getScriptCache().put('hint_' + uid, tank, 900);
  lineReply_(ev.replyToken, [lineText_('ส่งรูปบัตร ' + tank + ' ' + tank0.loc + ' ได้เลย', true)]);
}

function onLineLocation_(ev, uid, m) {
  const sess = lineSession_(uid);
  const recent = sess.staff ? getRecent_(uid) : null;
  if (!recent) return lineReply_(ev.replyToken, [lineText_('ส่งตำแหน่งได้หลังส่งรูปบัตร (ภายใน ' + RECENT_MIN + ' นาที)')]);
  const i = findRow_(SH.INSP, 'Row_ID', recent.rowId);
  if (i) setCells_(SH.INSP, i._row, { GPS: m.latitude + ',' + m.longitude });
  lineReply_(ev.replyToken, [lineText_('บันทึกตำแหน่งของ ' + (recent.device || 'รูปล่าสุด') + ' แล้ว', true)]);
}

/* ---------- รูป ---------- */

function onLineImage_(ev, uid, m) {
  const st = getSettings_();
  const sess = lineSession_(uid);
  if (!sess.staff) {
    const n = addPending_(uid, m.id, ev.timestamp);
    if (n === 1 || !(m.imageSet && m.imageSet.index > 1)) {
      lineReply_(ev.replyToken, [lineText_((sess.expired ? 'หมดเวลาใช้งานบนเครื่องนี้' : 'ยังไม่ได้เข้าสู่ระบบบนเครื่องนี้') +
        '\nพิมพ์ PIN 6 หลัก แล้วระบบจะบันทึกรูปที่ส่งมา (' + n + ' รูป) ให้อัตโนมัติ')]);
    }
    return;
  }
  touchSession_(sess, st);
  const cache = CacheService.getScriptCache();

  const defectRow = cache.get('defect_' + uid);
  if (defectRow) {
    cache.remove('defect_' + uid);
    const i = findRow_(SH.INSP, 'Row_ID', defectRow);
    if (i) {
      const blob = lineContent_(m.id);
      blob.setName(Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '_defect_' + defectRow + '.jpg');
      const f = photoFolder_().createFile(blob);
      setCells_(SH.INSP, i._row, { Defect_Photo: f.getId() });
      return lineReply_(ev.replyToken, [lineText_('บันทึกรูปจุดชำรุดของ ' + (i.Device_ID || 'รูปล่าสุด') + ' แล้ว', true)]);
    }
  }

  lineLoading_(uid);
  const hint = cache.get('hint_' + uid) || '';
  if (hint) cache.remove('hint_' + uid);
  const rec = saveLinePhoto_(sess, uid, m.id, ev.timestamp, hint, 'PROCESSING');
  const r = readCardNow_(rec.ai, rec.insp);
  setRecent_(uid, r);
  lineReply_(ev.replyToken, [lineText_(lineReceiptText_(r, rec.insp), true)]);
}

/** บันทึกรูปลง Drive + เพิ่มแถวใน Inspections และ AI_Results คืน { insp, ai } */
function saveLinePhoto_(sess, uid, msgId, tsMs, hint, status) {
  const blob = lineContent_(msgId);
  const sent = isoFromMs_(tsMs || Date.now());
  let exif = exifDateTime(blob.getBytes());
  if (exif && (exif > isoFromMs_((tsMs || Date.now()) + 3600000) || dayNum(sent) - dayNum(exif) > 120)) exif = '';  // นาฬิกากล้องผิด
  const rowId = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  const ext = String(blob.getContentType() || '').indexOf('png') >= 0 ? 'png' : 'jpg';
  blob.setName(Utilities.formatDate(new Date(tsMs || Date.now()), TZ, 'yyyyMMdd_HHmmss') + '_' + (hint || 'card') + '_' + rowId + '.' + ext);
  const file = photoFolder_().createFile(blob);
  const insp = {
    Row_ID: rowId, Device_ID: hint || '', Card_Photo: file.getId(), Defect_Photo: '', Note: '',
    Captured_At: exif || sent, GPS: '', Inspector: String(sess.staff.Name),
    Source: 'LINE', Time_Source: exif ? 'EXIF' : 'SENT', Sent_At: sent, Line_User_ID: uid, Message_ID: msgId
  };
  const ai = {
    Row_ID: rowId, Device_ID: hint || '', Round_ID: '', First_Seen_At: sent, Status: status, Attempts: 0,
    Photo_File_ID: file.getId(), Claimed_At: status === 'PROCESSING' ? nowIso_() : '', Line_Notified: ''
  };
  withScriptLock_(function () {
    insp._row = appendObjects_(SH.INSP, [insp]);
    ai._row = appendObjects_(SH.AI, [ai]);
  });
  return { insp: insp, ai: ai };
}

function setRecent_(uid, r) {
  CacheService.getScriptCache().put('last_' + uid, JSON.stringify({ rowId: String(r.Row_ID), device: String(r.Device_ID || '') }), RECENT_MIN * 60);
}
function getRecent_(uid) { const v = CacheService.getScriptCache().get('last_' + uid); return v ? JSON.parse(v) : null; }
function clearRecent_(uid) { CacheService.getScriptCache().remove('last_' + uid); }

/* ---------- ข้อความตอบกลับ ---------- */

function lineReceiptText_(r, i) {
  const st = getSettings_();
  const tank = loadTanks_().filter(function (t) { return t.id === r.Device_ID; })[0] || {};
  const s = String(r.Status);
  if (s === 'NEED_TANK') {
    return '📷 ได้รับรูปแล้ว แต่' + (r.Tank_ID_Read ? 'รหัสถังที่อ่านได้ (' + r.Tank_ID_Read + ') ไม่มีในทะเบียน' : 'อ่านรหัสถังบนบัตรไม่ได้') +
      '\nพิมพ์รหัสถังที่อยู่บนบัตร เช่น FE012';
  }
  if (s !== 'OK') {
    return '📷 ได้รับรูปแล้ว แต่ระบบอ่านไม่สำเร็จตอนนี้\nระบบจะลองอ่านใหม่อัตโนมัติและแจ้งผลทีหลัง ไม่ต้องส่งซ้ำ';
  }
  const icon = { ready: '✅', broken: '🔧', absent: '❌', unknown: '❔' }[r.AI_Result] || '❔';
  const bad = CARD_ITEM_KEYS.filter(function (k) { return r[ITEM_COLS[k]] === 'bad'; }).map(function (k) { return ITEM_TH[k]; });
  const rd = loadRounds_().filter(function (x) { return x.id === r.Round_ID; })[0];
  const lines = [
    icon + ' ' + r.Device_ID + ' ' + (tank.loc || ''),
    'ผลที่ AI อ่านได้: ' + (RESULT_TH[r.AI_Result] || r.AI_Result) + (bad.length ? ' — ' + bad.join(', ') : ''),
    (rd ? 'รอบ ' + rd.label : 'ไม่อยู่ในรอบตรวจ') + (r.Written_Date ? ' · วันที่บนบัตร ' + r.Written_Date : '')
  ];
  const hints = [];
  if (Number(r.Corners) < 4) hints.push('เห็นมุมดำ ' + r.Corners + '/4 — ถ่ายใหม่ให้เห็นครบ 4 มุมจะอ่านแม่นขึ้น');
  if (!(Number(r.Confidence) >= st.CONFIDENCE_MIN)) hints.push('รูปไม่ค่อยชัด ทีม ENV จะดูรูปอีกครั้ง');
  splitFlags_(r.Flags).filter(function (f) { return f.indexOf('ไม่ตรงกับที่ช่างระบุ') >= 0; }).forEach(function (f) { hints.push(f); });
  if (hints.length) lines.push('', '• ' + hints.join('\n• '));
  lines.push('');
  if (r.AI_Result === 'broken') lines.push('มีรูปจุดชำรุด? พิมพ์ "รูปชำรุด" แล้วส่งรูป');
  lines.push('ผิดถัง พิมพ์รหัส เช่น FE012 · ส่งผิดพิมพ์ "ยกเลิก" · พิมพ์ข้อความอื่น = หมายเหตุ');
  return lines.join('\n');
}

function lineStatusText_(sess) {
  const raw = loadRaw_();
  const D = buildDashboard(raw, todayIso_(), raw.settings);
  if (!D.ok) return D.message;
  const R = D.round, S = D.summary;
  const mine = raw.records.filter(function (r) { return r.roundId === R.id && r.inspector === String(sess.staff.Name); }).length;
  const left = D.tanks.filter(function (t) { return t.inspect === 'pending' || t.inspect === 'missing' || t.inspect === 'notstarted'; });
  const byZone = {};
  left.forEach(function (t) { (byZone[t.zone] = byZone[t.zone] || []).push(t.id); });
  return 'รอบ ' + R.label + ' · ตรวจ ' + thaiDate(R.inspectStart) + '–' + thaiDate(R.inspectEnd) + ' · ส่งภายใน ' + thaiDate(R.submitBy) +
    '\nส่งรูปบัตรแล้ว ' + S.inspected + '/' + S.total + ' ถัง (ของคุณ ' + mine + ' รูป)' +
    (left.length ? '\n\nยังไม่มีรูป ' + left.length + ' ถัง:\n' + Object.keys(byZone).map(function (z) { return 'โซน' + z + ': ' + byZone[z].join(', '); }).join('\n') : '\n\nครบทุกถังแล้ว 👍');
}

function lineHelpText_(welcome) {
  return (welcome ? 'ยินดีต้อนรับสู่ FireCheck\n' : '') +
    'ส่งรูปบัตรเช็คถังดับเพลิง (v' + APP_VERSION + ')\n\n' +
    '1) พิมพ์ PIN 6 หลัก (ครั้งแรกบนเครื่องนี้)\n' +
    '2) ถ่ายรูปบัตรให้เห็นครบ 4 มุมดำ แล้วส่งมา ส่งทีละหลายรูปได้\n' +
    '3) ระบบตอบผลที่อ่านได้ทันที\n\n' +
    'ไม่มีเน็ตตอนตรวจ: ถ่ายรูปเก็บไว้ แล้วเลือกจากอัลบั้มส่งตอนมี Wi-Fi\n\n' +
    'คำสั่ง\n' +
    '• FE012 — ระบุ/แก้รหัสถังของรูปล่าสุด\n' +
    '• รูปชำรุด — ส่งรูปจุดชำรุดของรูปล่าสุด\n' +
    '• ยกเลิก — ยกเลิกรูปล่าสุด\n' +
    '• สถานะ — ความคืบหน้ารอบนี้\n' +
    '• ออกจากระบบ — เมื่อใช้เครื่องร่วมกับคนอื่น\n' +
    '• พิมพ์ข้อความอื่นหลังส่งรูป = หมายเหตุ';
}

/** แจ้งผลทาง LINE เมื่อ trigger อ่านรูปที่ค้างเสร็จ */
function notifyLineResult_(r, i, st) {
  if (!st.LINE_PUSH_RESULT || String(i.Source) !== 'LINE' || !i.Line_User_ID || r.Line_Notified === 'YES') return;
  const s = String(r.Status);
  const final = s === 'OK' || s === 'NEED_TANK' || ((s === 'ERROR' || s === 'WAIT_PHOTO') && Number(r.Attempts) >= MAX_ATTEMPTS);
  if (!final) return;
  try {
    const text = s === 'ERROR' || s === 'WAIT_PHOTO'
      ? 'ระบบอ่านรูปที่ส่งเมื่อ ' + thaiDate(isoOf_(i.Sent_At)) + ' ' + String(isoOf_(i.Sent_At)).slice(11, 16) + ' ไม่สำเร็จ ทีม ENV จะตรวจดูรูปเอง'
      : 'ผลอ่านรูปที่ส่งเมื่อ ' + thaiDate(isoOf_(i.Sent_At)) + ' ' + String(isoOf_(i.Sent_At)).slice(11, 16) + '\n' + lineReceiptText_(r, i);
    linePush_(String(i.Line_User_ID), [lineText_(text)]);
    if (s === 'OK' || s === 'NEED_TANK') setRecent_(String(i.Line_User_ID), r);
    r.Line_Notified = 'YES';
    setCells_(SH.AI, r._row, { Line_Notified: 'YES' });
  } catch (e) { log_('WARN', 'push result ' + r.Row_ID + ': ' + e); }
}

/** ทีม ENV ขอให้ถ่ายใหม่ → แจ้งช่างที่ส่งรูปนั้น */
function notifyRetake_(rowId, deviceId, note) {
  const st = getSettings_();
  if (!st.LINE_NOTIFY_RETAKE) return false;
  const i = findRow_(SH.INSP, 'Row_ID', rowId);
  if (!i || !i.Line_User_ID) return false;
  const tank = loadTanks_().filter(function (t) { return t.id === deviceId; })[0] || {};
  try {
    linePush_(String(i.Line_User_ID), [lineText_('📢 ทีม ENV ขอให้ถ่ายบัตร ' + deviceId + ' ' + (tank.loc || '') + ' ใหม่' +
      (note ? '\nเหตุผล: ' + note : '') + '\n\nถ่ายให้เห็นครบ 4 มุมดำ แล้วส่งมาที่นี่', true)]);
    return true;
  } catch (e) { log_('WARN', 'retake push: ' + e); return false; }
}

/* ---------- LINE Messaging API ---------- */

function lineToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!t) throw new Error('ยังไม่ได้ใส่ LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  return t;
}
function lineCall_(url, payload, method) {
  const opt = { method: method || 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + lineToken_() } };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('LINE HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  return res;
}
function lineReply_(token, messages) {
  if (!token) return;
  lineCall_(LINE_API + '/message/reply', { replyToken: token, messages: messages });
}
function linePush_(to, messages) { lineCall_(LINE_API + '/message/push', { to: to, messages: messages }); }
function lineContent_(messageId) {
  const res = lineCall_(LINE_DATA_API + '/message/' + encodeURIComponent(messageId) + '/content', null, 'get');
  return res.getBlob();
}
function lineLoading_(uid) {
  try { lineCall_(LINE_API + '/chat/loading/start', { chatId: uid, loadingSeconds: 30 }); } catch (e) { /* ไม่สำคัญ */ }
}
function lineProfileName_(uid) {
  try { return JSON.parse(lineCall_(LINE_API + '/profile/' + encodeURIComponent(uid), null, 'get').getContentText()).displayName || ''; }
  catch (e) { return ''; }
}
/** ข้อความ + ปุ่มลัด (ถ่ายรูป / อัลบั้ม / สถานะ / วิธีใช้) */
function lineText_(text, withQuick) {
  const m = { type: 'text', text: String(text).slice(0, 4900) };
  if (withQuick) {
    m.quickReply = {
      items: [
        { type: 'action', action: { type: 'camera', label: 'ถ่ายรูปบัตร' } },
        { type: 'action', action: { type: 'cameraRoll', label: 'เลือกจากอัลบั้ม' } },
        { type: 'action', action: { type: 'message', label: 'สถานะ', text: 'สถานะ' } },
        { type: 'action', action: { type: 'message', label: 'วิธีใช้', text: 'วิธีใช้' } }
      ]
    };
  }
  return m;
}
