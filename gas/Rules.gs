/**
 * Rules.gs — กฎของระบบ (ฟังก์ชันล้วน ไม่เรียกบริการของ Google)
 * รอบตรวจ · ความตรงเวลา · แปลผลที่ AI อ่าน · ธงผิดปกติ · ต้องยืนยันหรือไม่
 */

var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var CARD_ITEM_KEYS = ['pin', 'lever', 'body', 'gauge', 'powder', 'mount'];
var ITEM_TH = {
  pin: 'สลักและสายฉีด', lever: 'คันบีบและข้อต่อ', body: 'สภาพตัวถัง',
  gauge: 'เกจวัดแรงดัน', powder: 'ผงเคมีไม่จับตัวแข็ง', mount: 'จุดติดตั้ง ป้าย ทางเข้าถึง'
};
var RESULT_TH = { ready: 'พร้อมใช้', broken: 'ชำรุด', absent: 'ไม่อยู่ที่จุด', unknown: 'รอผล', nodata: 'ไม่มีข้อมูล' };

/* ---------- วันที่ ---------- */
function pad2(n) { n = String(n == null ? '' : n).replace(/\D/g, ''); return n === '' ? '' : ('0' + n).slice(-2); }

/** 'yyyy-MM-dd...' → จำนวนวันนับจาก epoch (ไม่สนเวลา) */
function dayNum(iso) {
  var p = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5);
}
function isoFromDayNum(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
function addDays(iso, n) { return isoFromDayNum(dayNum(iso) + n); }

/** "3 ก.ย. 69" */
function thaiDate(iso, fullYear) {
  if (!iso) return '';
  var p = String(iso).slice(0, 10).split('-').map(Number);
  var y = p[0] + 543;
  return p[2] + ' ' + TH_MONTHS[p[1] - 1] + ' ' + (fullYear ? y : String(y).slice(2));
}

/**
 * แปลงข้อความวันที่เวลาเป็น 'yyyy-MM-ddTHH:mm:ss'
 * รองรับ ISO, d/M/yyyy และ M/d/yyyy (ตาม order = 'DMY' | 'MDY'), ปี พ.ศ. จะถูกแปลงเป็น ค.ศ.
 */
function parseDateTime(s, order) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  var y, mo, d, h = 0, mi = 0, se = 0;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0); }
  else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (!m) return '';
    if ((order || 'DMY') === 'MDY') { mo = +m[1]; d = +m[2]; } else { d = +m[1]; mo = +m[2]; }
    y = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
    if (m[7]) { var pm = m[7].toUpperCase() === 'PM'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  }
  if (y > 2400) y -= 543;
  return y + '-' + pad2(mo) + '-' + pad2(d) + 'T' + pad2(h) + ':' + pad2(mi) + ':' + pad2(se);
}

/* ---------- รอบตรวจ ---------- */

/** รหัสและชื่อรอบจากปี/เดือน ค.ศ. */
function roundIdOf(year, month) { return 'R' + (year + 543) + '-' + pad2(month); }
function roundLabelOf(year, month) { return TH_MONTHS[month - 1] + ' ' + String(year + 543).slice(2); }

/**
 * สร้างรายการรอบตรวจ count รอบ เริ่มจากเดือนที่เป็นรอบตัวแรกที่ >= startIso
 * settings: ROUND_MONTHS [9,12,3,6], INSPECT_START_DAY, INSPECT_END_DAY, SUBMIT_GRACE_DAYS
 */
function generateRounds(startIso, count, settings) {
  var months = settings.ROUND_MONTHS.slice().sort(function (a, b) { return a - b; });
  var y = +startIso.slice(0, 4), mo = +startIso.slice(5, 7);
  var out = [];
  var guard = 0;
  while (out.length < count && guard++ < 200) {
    if (months.indexOf(mo) >= 0) {
      var start = y + '-' + pad2(mo) + '-' + pad2(settings.INSPECT_START_DAY);
      var end = y + '-' + pad2(mo) + '-' + pad2(settings.INSPECT_END_DAY);
      out.push({
        id: roundIdOf(y, mo), label: roundLabelOf(y, mo),
        inspectStart: start, inspectEnd: end, submitBy: addDays(end, settings.SUBMIT_GRACE_DAYS)
      });
    }
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

/** รอบที่ครอบคลุมวันที่ (ตั้งแต่วันเริ่มรอบนี้ ถึงก่อนวันเริ่มรอบถัดไป) */
function roundForDate(rounds, iso) {
  if (!iso) return null;
  var d = String(iso).slice(0, 10), found = null;
  var sorted = rounds.slice().sort(function (a, b) { return a.inspectStart < b.inspectStart ? -1 : 1; });
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].inspectStart <= d) found = sorted[i]; else break;
  }
  return found;
}

/** ontime | late | outside */
function inspectTiming(round, capturedIso) {
  if (!round || !capturedIso) return 'outside';
  return String(capturedIso).slice(0, 10) <= round.inspectEnd ? 'ontime' : 'late';
}
function submitTiming(round, seenIso) {
  if (!round || !seenIso) return 'outside';
  return String(seenIso).slice(0, 10) <= round.submitBy ? 'ontime' : 'late';
}

/* ---------- พิกัด ---------- */
function parseLatLng(s) {
  var m = String(s == null ? '' : s).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}
function distanceM(lat1, lng1, lat2, lng2) {
  var k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(Math.pow((lat1 - lat2) * 110574, 2) + Math.pow((lng1 - lng2) * 111320 * k, 2));
}

/* ---------- AI ---------- */

var CARD_SCHEMA = {
  type: 'object',
  properties: {
    tank_id_read: { type: 'string', description: 'Tank ID printed large at top-left, e.g. FE001. Empty string if unreadable.' },
    corners_visible: { type: 'integer', description: 'How many of the 4 solid black corner squares are visible (0-4).' },
    found: { type: 'string', enum: ['found', 'not_found', 'blank', 'unclear'] },
    items: {
      type: 'object',
      properties: {
        pin: { type: 'string', enum: ['ok', 'bad', 'blank', 'unclear'] },
        lever: { type: 'string', enum: ['ok', 'bad', 'blank', 'unclear'] },
        body: { type: 'string', enum: ['ok', 'bad', 'blank', 'unclear'] },
        gauge: { type: 'string', enum: ['ok', 'bad', 'blank', 'unclear'] },
        powder: { type: 'string', enum: ['ok', 'bad', 'blank', 'unclear'] },
        mount: { type: 'string', enum: ['ok', 'bad', 'blank', 'unclear'] }
      },
      required: ['pin', 'lever', 'body', 'gauge', 'powder', 'mount']
    },
    written_day: { type: 'string', description: 'Handwritten day as 2 digits, empty string if blank/unreadable.' },
    written_month: { type: 'string', description: 'Handwritten month as 2 digits, empty string if blank/unreadable.' },
    signed: { type: 'boolean' },
    confidence: { type: 'number', description: '0 to 1' },
    remark: { type: 'string', description: 'Short note in Thai about anything unclear. Empty string if none.' }
  },
  required: ['tank_id_read', 'corners_visible', 'found', 'items', 'written_day', 'written_month', 'signed', 'confidence', 'remark']
};

function buildCardPrompt(roundLabel, cardColumns) {
  var cols = (cardColumns || []).join(' | ');
  var target = roundLabel
    ? 'Read ONLY the column whose header is "' + roundLabel + '". Ignore every other column.'
    : 'Read ONLY the right-most column that contains any handwriting. Ignore every other column.';
  return [
    'You are reading a photo of a Thai fire-extinguisher inspection card ("บัตรตรวจเช็คถังดับเพลิง").',
    'Layout: large tank ID (e.g. FE001) at top-left and a QR code at top-right. Solid black squares mark the 4 corners.',
    'The table header row has round columns from left to right: ' + cols + '.',
    'Rows in order:',
    '- "พบถังที่จุดติดตั้ง": two boxes per column, left = พบ (found), right = ไม่พบ (not found).',
    '- A grey sub-header "ปกติ | ผิด": in each check row below, the LEFT box is ปกติ (normal) and the RIGHT box is ผิด (abnormal).',
    '- 1 สลักและสายฉีด = pin; 2 คันบีบและข้อต่อ = lever; 3 สภาพตัวถัง = body; 4 เกจวัดแรงดัน = gauge (may be left blank when the tank has no gauge); 5 ผงเคมีไม่จับตัวแข็ง = powder; 6 จุดติดตั้ง ป้าย ทางเข้าถึง = mount.',
    '- "วันที่ตรวจ (วว/ดด)": four digit boxes, day then month.',
    '- "ลงชื่อผู้ตรวจ": signature cell.',
    target,
    'For each check row: "ok" if only the ปกติ box is marked; "bad" if only the ผิด box is marked; "blank" if neither is marked; "unclear" if both are marked, crossed out, covered by glare, or not clearly visible.',
    'found: "found" if only พบ is marked; "not_found" if only ไม่พบ is marked; "blank" if neither; "unclear" otherwise.',
    'signed: true only if there is handwriting in the signature cell of that column.',
    'confidence: your overall confidence (0-1) that every value is correct. Lower it for blur, glare, shadow, a cropped card, or messy marks.',
    'Never guess. Prefer "unclear" and a lower confidence over guessing.',
    'Answer with JSON only, following the schema.'
  ].join('\n');
}

/** ดึง JSON จากข้อความ (รองรับกรณีมี ```json ครอบ) */
function parseJsonLoose(text) {
  var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('AI ไม่ได้ตอบเป็น JSON');
  return JSON.parse(t.slice(a, b + 1));
}

/** ทำให้ผลจาก AI อยู่ในรูปแบบที่คาดไว้เสมอ */
function normalizeAi(ai) {
  ai = ai || {};
  var enumItem = ['ok', 'bad', 'blank', 'unclear'];
  var it = ai.items || {};
  var items = {};
  CARD_ITEM_KEYS.forEach(function (k) { items[k] = enumItem.indexOf(it[k]) >= 0 ? it[k] : 'unclear'; });
  var conf = Number(ai.confidence);
  return {
    tank_id_read: String(ai.tank_id_read || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    corners_visible: Math.max(0, Math.min(4, parseInt(ai.corners_visible, 10) || 0)),
    found: ['found', 'not_found', 'blank', 'unclear'].indexOf(ai.found) >= 0 ? ai.found : 'unclear',
    items: items,
    written_day: pad2(ai.written_day),
    written_month: pad2(ai.written_month),
    signed: ai.signed === true || ai.signed === 'true',
    confidence: isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
    remark: String(ai.remark || '').slice(0, 300)
  };
}

/**
 * แปลผลบัตร → { result: ready|broken|absent|unknown, flags: [], writtenDate: 'dd/mm' }
 * ctx: { selectedTank (ว่างได้ = ใช้รหัสที่ AI อ่าน), capturedIso, roundLabel, roundMonth, hasRound }
 */
function evaluateCard(ai, ctx) {
  var flags = [];
  var it = ai.items;
  if (!ctx.hasRound) flags.push('ถ่ายก่อนรอบตรวจแรกที่กำหนด');
  if (!ai.tank_id_read) flags.push('อ่านรหัสถังในรูปไม่ได้');
  else if (ctx.selectedTank && ai.tank_id_read !== ctx.selectedTank) flags.push('รหัสถังในรูป ' + ai.tank_id_read + ' ไม่ตรงกับที่ช่างระบุ ' + ctx.selectedTank);
  if (ai.corners_visible < 4) flags.push('เห็นมุมดำ ' + ai.corners_visible + '/4 มุม');

  var allBlank = ai.found === 'blank' && CARD_ITEM_KEYS.every(function (k) { return it[k] === 'blank'; });
  var result;
  if (allBlank) {
    result = 'unknown';
    flags.push('คอลัมน์รอบ' + (ctx.roundLabel ? ' ' + ctx.roundLabel : '') + ' บนบัตรว่าง');
  } else if (ai.found === 'not_found') {
    result = 'absent';
  } else {
    if (ai.found === 'blank') flags.push('ไม่ได้ทำเครื่องหมายช่องพบถัง');
    if (ai.found === 'unclear') flags.push('ช่องพบถังอ่านไม่ชัด');
    var bad = CARD_ITEM_KEYS.filter(function (k) { return it[k] === 'bad'; });
    var unclear = CARD_ITEM_KEYS.filter(function (k) { return it[k] === 'unclear'; });
    var blank = CARD_ITEM_KEYS.filter(function (k) { return it[k] === 'blank' && k !== 'gauge'; });
    unclear.forEach(function (k) { flags.push('ช่อง' + ITEM_TH[k] + 'อ่านไม่ชัด'); });
    blank.forEach(function (k) { flags.push('ช่อง' + ITEM_TH[k] + 'ว่าง'); });
    if (bad.length) result = 'broken';
    else if (unclear.length || blank.length || ai.found !== 'found') result = 'unknown';
    else result = 'ready';
  }

  var writtenDate = '';
  if (!allBlank) {
    if (ai.written_day && ai.written_month) {
      writtenDate = ai.written_day + '/' + ai.written_month;
      // เทียบกับ "เดือนของรอบตรวจ" เท่านั้น ไม่เทียบกับวันที่ถ่ายรูป
      // (ช่างอาจถ่ายบัตรใบเดิมซ้ำทีหลัง เช่น ถ่ายไม่ครบมุม แล้วกลับไปถ่ายใหม่)
      var rm = String(ctx.roundMonth || '');
      if (rm && ai.written_month !== rm) {
        flags.push('วันที่บนบัตร ' + writtenDate + ' ไม่อยู่ในเดือนของรอบ' + (ctx.roundLabel ? ' ' + ctx.roundLabel : ''));
      }
    } else {
      flags.push('ไม่ได้เขียนวันที่ หรืออ่านวันที่ไม่ได้');
    }
    if (!ai.signed) flags.push('ไม่พบลายมือชื่อผู้ตรวจ');
  }
  return { result: result, flags: flags, writtenDate: writtenDate };
}

/** ธงที่ต้องดูหลายรายการพร้อมกัน: รูปซ้ำ และถ่ายเร็วเกินกว่าเดินได้
 * records: [{rowId, device, capturedIso, inspector, hash, exactTime}]
 * exactTime === false = ไม่รู้เวลาถ่ายจริง (เช่น รูปจาก LINE ที่ไม่มี EXIF) → ไม่นำไปคิดความเร็ว
 * tanksById: { FE001: {lat, lng} }
 * return { rowId: [flag, ...] }
 */
function computeCrossFlags(records, tanksById, settings) {
  var out = {};
  function add(id, f) { (out[id] = out[id] || []).push(f); }
  var byHash = {};
  records.forEach(function (r) { if (r.hash) (byHash[r.hash] = byHash[r.hash] || []).push(r); });
  Object.keys(byHash).forEach(function (h) {
    var g = byHash[h];
    if (g.length < 2) return;
    g.forEach(function (r) {
      var others = g.filter(function (o) { return o.rowId !== r.rowId; }).map(function (o) { return o.device; });
      add(r.rowId, 'รูปซ้ำกับรูปที่ส่งของ ' + others.filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', '));
    });
  });
  var groups = {};
  records.forEach(function (r) {
    if (!r.capturedIso || r.exactTime === false) return;
    var k = (r.inspector || '') + '|' + String(r.capturedIso).slice(0, 10);
    (groups[k] = groups[k] || []).push(r);
  });
  Object.keys(groups).forEach(function (k) {
    var g = groups[k].slice().sort(function (a, b) { return a.capturedIso < b.capturedIso ? -1 : 1; });
    for (var i = 1; i < g.length; i++) {
      var a = g[i - 1], b = g[i];
      if (a.device === b.device) continue;
      var ta = tanksById[a.device], tb = tanksById[b.device];
      if (!ta || !tb || !isFinite(ta.lat) || !isFinite(tb.lat)) continue;
      var dist = distanceM(ta.lat, ta.lng, tb.lat, tb.lng);
      var secs = Math.max(1, (Date.parse(b.capturedIso + 'Z') - Date.parse(a.capturedIso + 'Z')) / 1000);
      if (dist >= settings.SPEED_MIN_DIST_M && dist / secs > settings.SPEED_MAX_MPS) {
        add(b.rowId, 'ถ่ายห่างจาก ' + a.device + ' เพียง ' + Math.round(secs) + ' วินาที แต่จุดติดตั้งห่างกัน ' + Math.round(dist) + ' ม.');
      }
    }
  });
  return out;
}

function needsReview(result, flags, crossFlags, confidence, minConfidence) {
  return result !== 'ready' || (flags && flags.length > 0) || (crossFlags && crossFlags.length > 0) || !(Number(confidence) >= minConfidence);
}

/** ผลจากการยืนยันของทีม ENV (ใช้เมื่อเลือก “แก้ไขผล”) */
function resultFromReview(found, items) {
  if (found === 'not_found') return 'absent';
  if (found !== 'found') return 'unknown';
  var vals = CARD_ITEM_KEYS.map(function (k) { return items[k]; });
  if (vals.indexOf('bad') >= 0) return 'broken';
  var missing = CARD_ITEM_KEYS.filter(function (k) { return k !== 'gauge' && items[k] !== 'ok'; });
  return missing.length ? 'unknown' : 'ready';
}

/* ---------- LINE ---------- */

/** "fe 12" / "FE-012" / "Fe012" → "FE012" ; ไม่ใช่รหัสถัง → '' */
function normalizeTankId(text) {
  var m = String(text == null ? '' : text).trim().match(/^fe\s*[-_ ]?\s*(\d{1,3})$/i);
  return m ? 'FE' + ('00' + m[1]).slice(-3) : '';
}

/** แยกคำสั่งที่ช่างพิมพ์ใน LINE → { cmd, value } */
function parseLineText(text) {
  var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  var low = t.toLowerCase();
  if (/^\d{6}$/.test(t)) return { cmd: 'pin', value: t };
  var tank = normalizeTankId(t);
  if (tank) return { cmd: 'tank', value: tank };
  if (/^(ออก|ออกจากระบบ|logout|log out)$/.test(low)) return { cmd: 'logout' };
  if (/^(รูปชำรุด|รูปจุดชำรุด|รูปผิดปกติ|ชำรุด)$/.test(t)) return { cmd: 'defect' };
  if (/^(ยกเลิก|ยกเลิกรูปล่าสุด|cancel)$/.test(low)) return { cmd: 'cancel' };
  if (/^(สถานะ|ความคืบหน้า|status)$/.test(low)) return { cmd: 'status' };
  if (/^(เมนู|วิธีใช้|ช่วยเหลือ|help|\?|menu)$/.test(low)) return { cmd: 'help' };
  return { cmd: 'note', value: t };
}

/**
 * วันที่เขียนบนบัตร (dd, mm) → 'yyyy-MM-dd' โดยใช้ปีของรอบตรวจ
 * ใช้ได้เฉพาะเมื่อเดือนตรงกับเดือนของรอบ วันที่มีจริง และไม่เกิน maxIso (วันที่ส่ง)
 */
function cardDateIso(day, month, round, maxIso) {
  if (!round || !day || !month) return '';
  var d = +day, m = +month;
  var y = +String(round.inspectStart).slice(0, 4), rm = +String(round.inspectStart).slice(5, 7);
  if (m !== rm || d < 1 || d > 31) return '';
  var iso = y + '-' + pad2(m) + '-' + pad2(d);
  if (isoFromDayNum(dayNum(iso)) !== iso) return '';
  if (maxIso && iso > String(maxIso).slice(0, 10)) return '';
  return iso;
}

/** อ่านเวลาถ่ายจาก EXIF ของ JPEG (bytes = array ของตัวเลข รองรับค่าติดลบแบบ GAS) → 'yyyy-MM-ddTHH:mm:ss' หรือ '' */
function exifDateTime(bytes) {
  try {
    var b = function (i) { return bytes[i] & 0xff; };
    if (!bytes || bytes.length < 12 || b(0) !== 0xFF || b(1) !== 0xD8) return '';
    var p = 2;
    while (p + 4 < bytes.length && p < 262144) {
      if (b(p) !== 0xFF) return '';
      var marker = b(p + 1), len = (b(p + 2) << 8) | b(p + 3);
      if (marker === 0xDA || marker === 0xD9) return '';
      if (marker === 0xE1 && b(p + 4) === 0x45 && b(p + 5) === 0x78 && b(p + 6) === 0x69 && b(p + 7) === 0x66) {
        var t = p + 10;
        var le = b(t) === 0x49;
        var u16 = function (o) { return le ? b(t + o) | (b(t + o + 1) << 8) : (b(t + o) << 8) | b(t + o + 1); };
        var u32 = function (o) { return le ? (b(t + o) | (b(t + o + 1) << 8) | (b(t + o + 2) << 16)) + b(t + o + 3) * 16777216 : b(t + o) * 16777216 + ((b(t + o + 1) << 16) | (b(t + o + 2) << 8) | b(t + o + 3)); };
        var readIfd = function (off, want) {
          var n = u16(off), found = {};
          for (var k = 0; k < n; k++) {
            var e = off + 2 + k * 12, tag = u16(e);
            if (want.indexOf(tag) >= 0) found[tag] = u32(e + 8);
          }
          return found;
        };
        var str = function (off) {
          var s = '';
          for (var k = 0; k < 19; k++) s += String.fromCharCode(b(t + off + k));
          return s;
        };
        var ifd0 = readIfd(u32(4), [0x8769, 0x0132]);
        var raw = '';
        if (ifd0[0x8769]) {
          var ex = readIfd(ifd0[0x8769], [0x9003, 0x9004]);
          if (ex[0x9003]) raw = str(ex[0x9003]); else if (ex[0x9004]) raw = str(ex[0x9004]);
        }
        if (!raw && ifd0[0x0132]) raw = str(ifd0[0x0132]);
        var m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (!m || m[1] === '0000') return '';
        return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
      }
      p += 2 + len;
    }
  } catch (e) { /* EXIF เสีย */ }
  return '';
}

if (typeof module !== 'undefined') {
  module.exports = {
    TH_MONTHS: TH_MONTHS, CARD_ITEM_KEYS: CARD_ITEM_KEYS, ITEM_TH: ITEM_TH, RESULT_TH: RESULT_TH, CARD_SCHEMA: CARD_SCHEMA,
    pad2: pad2, dayNum: dayNum, addDays: addDays, thaiDate: thaiDate, parseDateTime: parseDateTime,
    generateRounds: generateRounds, roundForDate: roundForDate, inspectTiming: inspectTiming, submitTiming: submitTiming,
    parseLatLng: parseLatLng, distanceM: distanceM, buildCardPrompt: buildCardPrompt, parseJsonLoose: parseJsonLoose,
    normalizeAi: normalizeAi, evaluateCard: evaluateCard, computeCrossFlags: computeCrossFlags, needsReview: needsReview,
    resultFromReview: resultFromReview, normalizeTankId: normalizeTankId, parseLineText: parseLineText,
    cardDateIso: cardDateIso, exifDateTime: exifDateTime
  };
}