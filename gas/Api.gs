/**
 * Api.gs — จุดเข้าใช้ของ Web app
 *  - POST จาก LINE (มี events) → Line.gs
 *  - POST จาก Dashboard บน GitHub Pages ({ action, token, ... }) → JSON
 * Deploy: Execute as = Me, Who has access = Anyone
 * ผู้ดูแลเข้า Dashboard ด้วย Gmail + รหัส OTP 6 หลักทางอีเมล
 */

const SESSION_SECONDS = 6 * 60 * 60;   // CacheService เก็บได้นานสุด 6 ชม.
const OTP_SECONDS = 10 * 60;

function doGet() {
  return json_({ ok: true, app: 'FireCheck', version: APP_VERSION });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }); }

  if (Array.isArray(body.events)) {                       // LINE webhook
    const key = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY');
    if (!key || !e.parameter || e.parameter.key !== key) return ContentService.createTextOutput('forbidden');
    handleLineWebhook_(body);
    return ContentService.createTextOutput('OK');
  }
  try {
    return json_({ ok: true, version: APP_VERSION, data: route_(body) });
  } catch (err) {
    return json_({ ok: false, version: APP_VERSION, error: String(err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function route_(b) {
  switch (b.action) {
    case 'ping': return { version: APP_VERSION, orgName: getSettings_().ORG_NAME };
    case 'otpRequest': return apiOtpRequest(b.email);
    case 'otpVerify': return apiOtpVerify(b.email, b.code);
    case 'logout': CacheService.getScriptCache().remove('tok_' + b.token); return true;
    case 'dashboard': return apiDashboard(b.token, b.roundId);
    case 'photo': return apiPhoto(b.token, b.rowId, b.kind);
    case 'review': return apiSubmitReview(b.token, b.p || {});
    case 'assignTank': return apiAssignTank(b.token, b.rowId, b.device, b.roundId);
    case 'pickSpots': return apiPickSpots(b.token, b.roundId);
    case 'submitSpot': return apiSubmitSpot(b.token, b.spotId, b.match, b.note, b.roundId);
    case 'staffList': return apiStaffList(b.token);
    case 'staffSave': return apiStaffSave(b.token, b.p || {});
    case 'staffKick': return apiStaffKick(b.token, b.staffId);
    case 'adminList': return apiAdminList(b.token);
    case 'adminSave': return apiAdminSave(b.token, b.p || {});
    default: throw new Error('ไม่รู้จักคำสั่ง ' + b.action);
  }
}

/* ---------- เข้าสู่ระบบ: Gmail + OTP ---------- */

function emailKey_(email) { return Utilities.base64EncodeWebSafe(String(email || '').trim().toLowerCase()).slice(0, 200); }

function findAdmin_(email) {
  email = String(email || '').trim().toLowerCase();
  return readObjects_(SH.ADM).filter(function (a) {
    return String(a.Email).trim().toLowerCase() === email && isActive_(a.Active);
  })[0] || null;
}

function apiOtpRequest(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('กรอกอีเมลให้ถูกต้อง');
  const cache = CacheService.getScriptCache();
  const k = emailKey_(email);
  const sends = Number(cache.get('otps_' + k) || 0);
  if (sends >= 3) throw new Error('ขอรหัสบ่อยเกินไป กรุณารอ 10 นาที');
  cache.put('otps_' + k, String(sends + 1), OTP_SECONDS);
  const a = findAdmin_(email);
  if (a) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    cache.put('otp_' + k, JSON.stringify({ h: hashPin_('otp:' + email + ':' + code), n: 0 }), OTP_SECONDS);
    const st = getSettings_();
    MailApp.sendEmail({
      to: email,
      subject: '[FireCheck] รหัสเข้าสู่ระบบ ' + code,
      body: 'รหัสเข้าสู่ระบบ Dashboard FireCheck · ' + st.ORG_NAME + '\n\n' + code +
        '\n\nใช้ได้ภายใน 10 นาที ถ้าไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร'
    });
  }
  // ตอบเหมือนกันทั้งกรณีมีและไม่มีสิทธิ์ เพื่อไม่เปิดเผยรายชื่อผู้ดูแล
  return { sent: true };
}

function apiOtpVerify(email, code) {
  email = String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const k = 'otp_' + emailKey_(email);
  const v = cache.get(k);
  if (!v) throw new Error('รหัสหมดอายุหรือยังไม่ได้ขอรหัส');
  const o = JSON.parse(v);
  if (o.n >= 5) { cache.remove(k); throw new Error('ใส่รหัสผิดหลายครั้ง กรุณาขอรหัสใหม่'); }
  if (o.h !== hashPin_('otp:' + email + ':' + String(code || '').trim())) {
    o.n++; cache.put(k, JSON.stringify(o), OTP_SECONDS);
    throw new Error('รหัสไม่ถูกต้อง');
  }
  cache.remove(k);
  const a = findAdmin_(email);
  if (!a) throw new Error('อีเมลนี้ไม่มีสิทธิ์เข้า Dashboard');
  const token = Utilities.getUuid();
  const u = { email: email, name: String(a.Name || email), role: String(a.Role || 'ENV').toUpperCase() };
  cache.put('tok_' + token, JSON.stringify(u), SESSION_SECONDS);
  return { token: token, user: u };
}

function auth_(token, need) {
  const v = token && CacheService.getScriptCache().get('tok_' + token);
  if (!v) throw new Error('SESSION_EXPIRED');
  const u = JSON.parse(v);
  if (need === 'edit' && u.role === 'VIEW') throw new Error('บัญชีนี้ดูได้อย่างเดียว');
  if (need === 'admin' && u.role !== 'ADMIN') throw new Error('เฉพาะผู้ดูแลระบบ (ADMIN)');
  return u;
}

/* ---------- ข้อมูล ---------- */

function apiDashboard(token, roundId) {
  const u = auth_(token);
  const raw = loadRaw_();
  const D = buildDashboard(raw, todayIso_(), raw.settings, roundId || null);
  D.user = u;
  D.version = APP_VERSION;
  return JSON.parse(JSON.stringify(D));
}

/** รูปบัตร (kind='card') หรือรูปจุดผิดปกติ (kind='defect') */
function apiPhoto(token, rowId, kind) {
  auth_(token);
  const insp = findRow_(SH.INSP, 'Row_ID', rowId);
  if (!insp) throw new Error('ไม่พบบันทึก');
  let file = null;
  if (kind === 'defect') {
    file = findPhotoFile_(insp.Defect_Photo);
  } else {
    const ai = findRow_(SH.AI, 'Row_ID', rowId);
    if (ai && ai.Photo_File_ID) { try { file = DriveApp.getFileById(String(ai.Photo_File_ID)); } catch (e) { file = null; } }
    if (!file) file = findPhotoFile_(insp.Card_Photo);
  }
  if (!file) throw new Error('ไม่พบไฟล์รูป');
  const b = file.getBlob();
  return 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/* ---------- ยืนยันผล ---------- */

/** p = { rowId, decision: 'confirm'|'correct'|'retake', found, items:{pin..mount}, note, roundId } */
function apiSubmitReview(token, p) {
  const u = auth_(token, 'edit');
  if (['confirm', 'correct', 'retake'].indexOf(p.decision) < 0) throw new Error('คำสั่งไม่ถูกต้อง');
  let device = '';
  withScriptLock_(function () {
    const ai = findRow_(SH.AI, 'Row_ID', p.rowId);
    if (!ai) throw new Error('ไม่พบผล AI ของรายการนี้');
    device = String(ai.Device_ID);
    const rec = {
      Review_ID: Utilities.getUuid(), Row_ID: String(p.rowId), Device_ID: device, Reviewer: u.name,
      Reviewed_At: nowIso_(), Decision: p.decision, Note: String(p.note || '').slice(0, 500)
    };
    if (p.decision === 'confirm') {
      rec.Found = ai.Found;
      Object.keys(ITEM_COLS).forEach(function (k) { rec[ITEM_COLS[k]] = ai[ITEM_COLS[k]]; });
      rec.Final_Result = ai.AI_Result;
    } else if (p.decision === 'correct') {
      const items = {};
      CARD_ITEM_KEYS.forEach(function (k) {
        const v = p.items && p.items[k];
        items[k] = ['ok', 'bad', 'blank'].indexOf(v) >= 0 ? v : 'blank';
        rec[ITEM_COLS[k]] = items[k];
      });
      rec.Found = ['found', 'not_found'].indexOf(p.found) >= 0 ? p.found : 'blank';
      rec.Final_Result = resultFromReview(rec.Found, items);
    } else {
      rec.Final_Result = 'unknown';
    }
    appendObjects_(SH.REV, [rec]);
  });
  if (p.decision === 'retake') notifyRetake_(String(p.rowId), device, String(p.note || ''));
  return apiDashboard(token, p.roundId);
}

/** ระบุรหัสถังให้รูปที่ AI อ่านรหัสไม่ได้ (หรือแก้รหัส) แล้วให้ AI อ่านใหม่ */
function apiAssignTank(token, rowId, device, roundId) {
  auth_(token, 'edit');
  device = normalizeTankId(device);
  if (!device || !loadTanks_().some(function (t) { return t.id === device; })) throw new Error('ไม่พบรหัสถังนี้ในทะเบียน');
  const i = findRow_(SH.INSP, 'Row_ID', rowId);
  const a = findRow_(SH.AI, 'Row_ID', rowId);
  if (!i || !a) throw new Error('ไม่พบบันทึก');
  setCells_(SH.INSP, i._row, { Device_ID: device });
  i.Device_ID = device;
  a.Status = 'PROCESSING';
  a.Attempts = 0;
  readCardNow_(a, i);
  return apiDashboard(token, roundId);
}

/* ---------- สุ่มตรวจซ้ำ ---------- */

function apiPickSpots(token, roundId) {
  const u = auth_(token, 'edit');
  withScriptLock_(function () {
    const raw = loadRaw_();
    const D = buildDashboard(raw, todayIso_(), raw.settings, roundId || null);
    const rid = D.round.id;
    const already = raw.spots.filter(function (s) { return s.roundId === rid; }).map(function (s) { return s.device; });
    const need = raw.settings.SPOT_CHECK_COUNT - already.length;
    if (need <= 0) throw new Error('รอบนี้สุ่มครบ ' + raw.settings.SPOT_CHECK_COUNT + ' ถังแล้ว');
    const pool = D.tanks.filter(function (t) { return t.capturedIso && already.indexOf(t.id) < 0; }).map(function (t) { return t.id; });
    if (!pool.length) throw new Error('ยังไม่มีถังที่ช่างส่งรูปบัตรในรอบนี้');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
    const now = nowIso_();
    appendObjects_(SH.SPOT, pool.slice(0, need).map(function (id) {
      return { Spot_ID: Utilities.getUuid(), Round_ID: rid, Device_ID: id, Selected_At: now, Selected_By: u.name };
    }));
  });
  return apiDashboard(token, roundId);
}

function apiSubmitSpot(token, spotId, match, note, roundId) {
  const u = auth_(token, 'edit');
  if (['match', 'mismatch'].indexOf(match) < 0) throw new Error('ค่าไม่ถูกต้อง');
  const s = findRow_(SH.SPOT, 'Spot_ID', spotId);
  if (!s) throw new Error('ไม่พบรายการสุ่มตรวจ');
  setCells_(SH.SPOT, s._row, { Checker: u.name, Checked_At: nowIso_(), Match: match, Note: String(note || '').slice(0, 500) });
  return apiDashboard(token, roundId);
}

/* ---------- ช่างผู้ตรวจ (LINE + PIN) ---------- */

function apiStaffList(token) {
  auth_(token);
  const devs = readObjects_(SH.DEV);
  const now = nowIso_();
  return readObjects_(SH.STAFF).map(function (s) {
    const mine = devs.filter(function (d) { return String(d.Staff_ID) === String(s.Staff_ID); }).map(function (d) {
      const exp = d.Expires_At ? isoOf_(d.Expires_At) : '';
      return { lineName: String(d.Line_Name || ''), loginAt: isoOf_(d.Login_At), lastSeen: isoOf_(d.Last_Seen_At), expires: exp, active: !exp || exp > now };
    });
    return { staffId: String(s.Staff_ID), name: String(s.Name), active: isActive_(s.Active), createdAt: isoOf_(s.Created_At), devices: mine };
  });
}

/** p = { staffId?, name, active?, newPin? } → คืน { list, pin? } */
function apiStaffSave(token, p) {
  auth_(token, 'admin');
  let pin = null;
  if (!p.staffId || p.newPin) {
    const r = staffUpsert_(p.name, p.staffId || null);
    pin = r.pin;
  } else {
    withScriptLock_(function () {
      const s = findRow_(SH.STAFF, 'Staff_ID', p.staffId);
      if (!s) throw new Error('ไม่พบช่าง');
      setCells_(SH.STAFF, s._row, { Name: String(p.name || s.Name).trim(), Active: p.active !== false });
      if (p.active === false) logoutStaffDevices_(p.staffId);
    });
  }
  return { list: apiStaffList(token), pin: pin };
}

function apiStaffKick(token, staffId) {
  auth_(token, 'admin');
  logoutStaffDevices_(staffId);
  return apiStaffList(token);
}

function logoutStaffDevices_(staffId) {
  readObjects_(SH.DEV).forEach(function (d) {
    if (String(d.Staff_ID) === String(staffId)) setCells_(SH.DEV, d._row, { Staff_ID: '', Staff_Name: '', Expires_At: '' });
  });
}

/* ---------- ผู้ดูแล Dashboard ---------- */

function apiAdminList(token) {
  auth_(token, 'admin');
  return readObjects_(SH.ADM).map(function (a) {
    return { email: String(a.Email).toLowerCase(), name: String(a.Name || ''), role: String(a.Role || 'ENV').toUpperCase(), active: isActive_(a.Active) };
  });
}

function apiAdminSave(token, p) {
  const u = auth_(token, 'admin');
  if (String(p.email || '').toLowerCase() === u.email && (p.active === false || String(p.role).toUpperCase() !== 'ADMIN')) {
    throw new Error('ลดสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้');
  }
  withScriptLock_(function () { adminUpsert_(p.email, p.name, p.role, p.active !== false); });
  return apiAdminList(token);
}
