/**
 * AI.gs — อ่านรูปบัตรเช็คด้วย Gemini แล้วบันทึกลงชีต AI_Results
 * - รูปจาก LINE: อ่านทันทีตอนช่างส่ง (Line.gs เรียก readCardNow_)
 * - Trigger ทุก 10 นาที: อ่านรูปที่ค้าง/ลองใหม่เมื่อ Gemini ล่ม แล้วแจ้งผลกลับทาง LINE
 */

const MAX_RUN_MS = 4.5 * 60 * 1000;   // เผื่อเวลาจำกัด 6 นาทีของ Apps Script
const MAX_ATTEMPTS = 6;               // ลองอ่านซ้ำได้กี่ครั้งถ้ายังไม่พบรูปหรือเรียก AI ไม่สำเร็จ
const STALE_PROCESSING_MIN = 15;      // แถวที่ค้างสถานะ PROCESSING เกินนี้ ให้ trigger อ่านใหม่

function processNewInspections() {
  const runLock = LockService.getDocumentLock() || LockService.getUserLock();
  if (!runLock.tryLock(3000)) return;
  const started = Date.now();
  try {
    const st = getSettings_();
    const rounds = loadRounds_();
    const tanks = loadTanks_();
    const tankIds = tanks.map(function (t) { return t.id; });
    const insp = readObjects_(SH.INSP).filter(function (i) { return i.Row_ID; });
    const inspById = {};
    insp.forEach(function (i) { inspById[String(i.Row_ID)] = i; });

    // 1) จองแถวที่ต้องอ่าน (ล็อกสั้น ๆ เพื่อไม่ให้ชนกับ LINE ที่กำลังเพิ่มแถว)
    const now = nowIso_();
    const staleBefore = isoFromMs_(Date.now() - STALE_PROCESSING_MIN * 60000);
    let todo = [];
    withScriptLock_(function () {
      const known = {};
      const rows = readObjects_(SH.AI);
      rows.forEach(function (a) { known[String(a.Row_ID)] = true; });
      // แถวจากแหล่งอื่น (เช่น AppSheet เดิม) ที่ยังไม่มีใน AI_Results
      const fresh = insp.filter(function (i) { return !known[String(i.Row_ID)]; }).map(function (i) {
        return { Row_ID: String(i.Row_ID), Device_ID: String(i.Device_ID || '').trim().toUpperCase(), First_Seen_At: now, Status: 'NEW', Attempts: 0 };
      });
      if (fresh.length) {
        const start = appendObjects_(SH.AI, fresh);
        fresh.forEach(function (f, n) { f._row = start + n; rows.push(f); });
      }
      todo = rows.filter(function (r) {
        const s = String(r.Status);
        if (s === 'NEW') return true;
        if ((s === 'WAIT_PHOTO' || s === 'ERROR') && Number(r.Attempts) < MAX_ATTEMPTS) return true;
        if (s === 'PROCESSING') return !r.Claimed_At || isoOf_(r.Claimed_At, st.DATE_ORDER) < staleBefore;
        return false;
      });
      todo.forEach(function (r) { setCells_(SH.AI, r._row, { Status: 'PROCESSING', Claimed_At: now }); });
    });

    // 2) อ่านรูป
    const alerts = [];
    for (let n = 0; n < todo.length; n++) {
      const r = todo[n];
      const i = inspById[String(r.Row_ID)];
      if (Date.now() - started > MAX_RUN_MS || !i) { setCells_(SH.AI, r._row, { Status: r.Status === 'PROCESSING' ? 'NEW' : r.Status, Claimed_At: '' }); continue; }
      readOneCard_(r, i, st, rounds, tankIds, alerts);
      writeObject_(SH.AI, r._row, r);
      notifyLineResult_(r, i, st, tanks, rounds);
    }

    // 3) ธงที่ต้องดูหลายรายการ (รูปซ้ำ / เร็วเกินจริง)
    withScriptLock_(function () { recomputeCrossFlags_(st, tanks, inspById); });

    if (alerts.length && st.IMMEDIATE_ALERT) sendImmediateAlert_(alerts, st, tanks, rounds);
  } catch (e) {
    log_('ERROR', 'processNewInspections: ' + (e.stack || e));
  } finally {
    runLock.releaseLock();
  }
}

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** อ่านบัตรหนึ่งใบทันที (ใช้ตอนช่างส่งรูปทาง LINE) — คืนแถว AI ที่อัปเดตแล้ว */
function readCardNow_(r, i) {
  const st = getSettings_();
  const rounds = loadRounds_();
  const tanks = loadTanks_();
  const alerts = [];
  readOneCard_(r, i, st, rounds, tanks.map(function (t) { return t.id; }), alerts);
  if (r.Status === 'OK' || r.Status === 'NEED_TANK') r.Line_Notified = 'YES';  // ตอบกลับใน LINE ทันทีแล้ว
  writeObject_(SH.AI, r._row, r);
  if (alerts.length && st.IMMEDIATE_ALERT) {
    try { sendImmediateAlert_(alerts, st, tanks, rounds); } catch (e) { log_('WARN', 'alert: ' + e); }
  }
  return r;
}

/**
 * อ่านบัตร 1 ใบ แล้วเขียนค่าลงใน r (ยังไม่บันทึกลงชีต)
 * Device_ID: ถ้าช่างระบุไว้ (หรือมาจาก AppSheet) ใช้ค่านั้น ถ้าว่างใช้รหัสถังที่ AI อ่านได้
 */
function readOneCard_(r, i, st, rounds, tankIds, alerts) {
  r.Attempts = Number(r.Attempts || 0) + 1;
  r.Claimed_At = '';
  try {
    const hint = String(i.Device_ID || '').trim().toUpperCase();
    if (hint && tankIds.indexOf(hint) < 0) throw new Error('ไม่พบรหัสถัง ' + hint + ' ในชีต Tanks');
    const file = findPhotoFile_(i.Card_Photo);
    if (!file) {
      r.Status = 'WAIT_PHOTO';
      r.Error = 'ยังไม่พบไฟล์รูปใน Drive: ' + i.Card_Photo;
      return;
    }
    const blob = file.getBlob();
    r.Photo_File_ID = file.getId();
    r.Photo_Hash = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes()));

    const sentIso = isoOf_(i.Sent_At || i.Captured_At, st.DATE_ORDER);
    let cap = isoOf_(i.Captured_At, st.DATE_ORDER);
    const rd = roundForDate(rounds, cap || sentIso);
    const ai = callGemini_(blob, rd ? rd.label : '', st);

    r.Read_At = nowIso_();
    r.Tank_ID_Read = ai.tank_id_read;
    r.Corners = ai.corners_visible;
    r.Found = ai.found;
    Object.keys(ITEM_COLS).forEach(function (k) { r[ITEM_COLS[k]] = ai.items[k]; });
    r.Signed = ai.signed;
    r.Confidence = ai.confidence;
    r.Remark = ai.remark;
    r.Model = st.GEMINI_MODEL;

    const device = hint || (tankIds.indexOf(ai.tank_id_read) >= 0 ? ai.tank_id_read : '');
    if (!device) {
      r.Status = 'NEED_TANK';
      r.Error = ai.tank_id_read ? 'รหัสถัง ' + ai.tank_id_read + ' ไม่มีในทะเบียน — รอช่างพิมพ์รหัสถัง' : 'AI อ่านรหัสถังไม่ได้ — รอช่างพิมพ์รหัสถัง';
      return;
    }
    r.Device_ID = device;
    r.Round_ID = rd ? rd.id : '';

    // รูปจาก LINE ที่ไม่มีเวลาถ่ายใน EXIF → ใช้วันที่ที่ช่างเขียนบนบัตรเป็นวันตรวจ (ถ้าอยู่ในเดือนของรอบ)
    const insFields = { Device_ID: device };
    if (String(i.Time_Source) === 'SENT') {
      const c = cardDateIso(ai.written_day, ai.written_month, rd, sentIso);
      if (c) { cap = c + 'T00:00:00'; insFields.Captured_At = cap; insFields.Time_Source = 'CARD'; }
    }
    if (i._row) setCells_(SH.INSP, i._row, insFields);

    const ev = evaluateCard(ai, { selectedTank: hint, capturedIso: cap, roundLabel: rd ? rd.label : '', roundMonth: rd ? String(rd.inspectStart).slice(5, 7) : '', hasRound: !!rd });
    r.Status = 'OK';
    r.Written_Date = ev.writtenDate;
    r.AI_Result = ev.result;
    r.Flags = ev.flags.join(' | ');
    r.Inspect_Timing = inspectTiming(rd, cap);
    r.Submit_Timing = submitTiming(rd, isoOf_(r.First_Seen_At, st.DATE_ORDER) || sentIso);
    r.Review_Needed = needsReview(ev.result, ev.flags, splitFlags_(r.Cross_Flags), ai.confidence, st.CONFIDENCE_MIN) ? 'YES' : 'NO';
    r.Error = '';
    if (ev.result === 'broken' || ev.result === 'absent') alerts.push({ r: r, i: i });
  } catch (e) {
    r.Status = 'ERROR';
    r.Error = String(e.message || e).slice(0, 500);
    log_('ERROR', r.Row_ID + ' ' + (r.Device_ID || '?') + ': ' + r.Error);
  }
}

/**
 * หาไฟล์รูป: Drive file id (จาก LINE) หรือพาธของ AppSheet เช่น "Inspections_Images/abc.jpg"
 */
function findPhotoFile_(value) {
  const path = String(value || '').trim();
  if (!path) return null;
  const idMatch = path.match(/[-\w]{25,}/);
  if (idMatch && (/^https?:/.test(path) || path === idMatch[0])) {
    try { return DriveApp.getFileById(idMatch[0]); } catch (e) { /* ไม่ใช่ file id */ }
  }
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  const parents = DriveApp.getFileById(ss_().getId()).getParents();
  while (parents.hasNext()) {
    let folder = parents.next();
    for (let p = 0; p < parts.length && folder; p++) {
      const it = folder.getFoldersByName(parts[p]);
      folder = it.hasNext() ? it.next() : null;
    }
    if (folder) {
      const files = folder.getFilesByName(name);
      if (files.hasNext()) return files.next();
    }
  }
  const any = DriveApp.getFilesByName(name);
  return any.hasNext() ? any.next() : null;
}

/** เรียก Gemini ให้อ่านบัตร คืนค่าที่ผ่าน normalizeAi แล้ว (ลองซ้ำเมื่อ 429/503) */
function callGemini_(blob, roundLabel, st) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('ยังไม่ได้ใส่ GEMINI_API_KEY ใน Project Settings > Script Properties');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(st.GEMINI_MODEL) + ':generateContent';
  const parts = [
    { text: buildCardPrompt(roundLabel, st.CARD_COLUMNS) },
    { inlineData: { mimeType: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } }
  ];
  const configs = [
    { responseFormat: { text: { mimeType: 'application/json', schema: CARD_SCHEMA } } },
    { responseMimeType: 'application/json', responseJsonSchema: CARD_SCHEMA },
    { responseMimeType: 'application/json' }
  ];
  let lastError = '';
  for (let c = 0; c < configs.length; c++) {
    for (let retry = 0; retry < 2; retry++) {
      const res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: configs[c] })
      });
      const code = res.getResponseCode();
      const text = res.getContentText();
      if (code === 200) {
        const j = JSON.parse(text);
        const cand = j.candidates && j.candidates[0];
        const out = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
        if (!out) throw new Error('Gemini ไม่ส่งผลกลับ: ' + text.slice(0, 300));
        return normalizeAi(parseJsonLoose(out));
      }
      lastError = 'Gemini HTTP ' + code + ': ' + text.slice(0, 400);
      if (code === 429 || code === 503) { Utilities.sleep(2500); continue; }
      break;
    }
    if (lastError.indexOf('HTTP 400') < 0) break;
  }
  throw new Error(lastError);
}

/** คำนวณธงรูปซ้ำ/เร็วเกินจริงใหม่ทั้งหมด แล้วเขียนเฉพาะคอลัมน์ Cross_Flags และ Review_Needed */
function recomputeCrossFlags_(st, tanks, inspById) {
  const sh = sheet_(SH.AI);
  const last = sh.getLastRow();
  if (last < 2) return;
  const head = headOf_(SH.AI);
  const values = sh.getRange(2, 1, last - 1, head.length).getValues();
  const col = function (name) { return head.indexOf(name); };
  const tanksById = {};
  tanks.forEach(function (t) { tanksById[t.id] = { lat: t.lat, lng: t.lng }; });
  const records = values.filter(function (v) { return v[col('Row_ID')] && v[col('Status')] !== 'CANCELLED'; }).map(function (v) {
    const i = inspById[String(v[col('Row_ID')])];
    const ts = i ? String(i.Time_Source || 'APP') : 'APP';
    return {
      rowId: String(v[col('Row_ID')]), device: String(v[col('Device_ID')]),
      capturedIso: i ? isoOf_(i.Captured_At, st.DATE_ORDER) : '', inspector: i ? String(i.Inspector || '') : '',
      hash: String(v[col('Photo_Hash')] || ''), exactTime: ts === 'APP' || ts === 'EXIF'
    };
  });
  const cross = computeCrossFlags(records, tanksById, st);
  const crossCol = [], reviewCol = [];
  values.forEach(function (v) {
    const id = String(v[col('Row_ID')]);
    const cf = cross[id] || [];
    crossCol.push([cf.join(' | ')]);
    if (v[col('Status')] === 'OK') {
      const need = needsReview(String(v[col('AI_Result')]), splitFlags_(v[col('Flags')]), cf, Number(v[col('Confidence')]), st.CONFIDENCE_MIN);
      reviewCol.push([need ? 'YES' : 'NO']);
    } else {
      reviewCol.push([v[col('Review_Needed')]]);
    }
  });
  sh.getRange(2, col('Cross_Flags') + 1, values.length, 1).setValues(crossCol);
  sh.getRange(2, col('Review_Needed') + 1, values.length, 1).setValues(reviewCol);
}

function sendImmediateAlert_(alerts, st, tanks, rounds) {
  if (!st.ENV_EMAILS) return;
  const byId = {};
  tanks.forEach(function (t) { byId[t.id] = t; });
  const lines = alerts.map(function (a) {
    const t = byId[a.r.Device_ID] || {};
    const bad = Object.keys(ITEM_COLS).filter(function (k) { return a.r[ITEM_COLS[k]] === 'bad'; }).map(function (k) { return ITEM_TH[k]; });
    return '• ' + a.r.Device_ID + ' ' + (t.loc || '') + ' (โซน' + (t.zone || '') + ') — ' + RESULT_TH[a.r.AI_Result] +
      (bad.length ? ': ' + bad.join(', ') : '') + (a.i.Note ? ' · หมายเหตุช่าง: ' + a.i.Note : '') + (a.i.Inspector ? ' · ส่งโดย ' + a.i.Inspector : '');
  });
  MailApp.sendEmail({
    to: st.ENV_EMAILS,
    subject: '[FireCheck] AI พบถังไม่พร้อมใช้ ' + alerts.length + ' ถัง (รอทีม ENV ยืนยัน)',
    body: 'ผลจาก AI อ่านบัตรเช็ค ยังไม่ผ่านการยืนยัน\n\n' + lines.join('\n') +
      '\n\nเปิด Dashboard เพื่อดูรูปและยืนยันผล: ' + (st.DASHBOARD_URL || '(ยังไม่ได้ใส่ DASHBOARD_URL ในชีต Settings)')
  });
}

/** ทดสอบการเรียก Gemini กับรูปบัตรล่าสุดในชีต Inspections (ไม่บันทึกผล) */
function testGemini() {
  const ui = SpreadsheetApp.getUi();
  try {
    const st = getSettings_();
    const insp = readObjects_(SH.INSP).filter(function (i) { return i.Card_Photo; });
    if (!insp.length) { ui.alert('ยังไม่มีรูปบัตรในชีต Inspections\nให้ช่างลองส่งรูปบัตรตัวอย่างทาง LINE OA ก่อน'); return; }
    const i = insp[insp.length - 1];
    const file = findPhotoFile_(i.Card_Photo);
    if (!file) { ui.alert('หาไฟล์รูปไม่พบ: ' + i.Card_Photo); return; }
    const rounds = loadRounds_();
    const cap = isoOf_(i.Captured_At, st.DATE_ORDER);
    const rd = roundForDate(rounds, cap);
    const ai = callGemini_(file.getBlob(), rd ? rd.label : '', st);
    const ev = evaluateCard(ai, { selectedTank: String(i.Device_ID || '').toUpperCase(), capturedIso: cap, roundLabel: rd ? rd.label : '', roundMonth: rd ? String(rd.inspectStart).slice(5, 7) : '', hasRound: !!rd });
    ui.alert('Gemini อ่านได้ (' + st.GEMINI_MODEL + ')\n\n' + JSON.stringify(ai, null, 2) + '\n\nผล: ' + RESULT_TH[ev.result] + '\nธง: ' + (ev.flags.join('\n') || '-'));
  } catch (e) {
    ui.alert('ทดสอบไม่สำเร็จ\n\n' + (e.message || e));
  }
}
