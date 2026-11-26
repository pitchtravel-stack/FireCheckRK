/**
 * Model.gs — รวมข้อมูลเป็นภาพรวมสำหรับ Dashboard / อีเมล (ฟังก์ชันล้วน)
 *
 * raw = {
 *   tanks:   [{id, loc, zone, type, size, lat, lng, active}]
 *   rounds:  [{id, label, inspectStart, inspectEnd, submitBy, note}]
 *   records: [{rowId, device, roundId, capturedIso, firstSeenIso, inspector, note, cardPhoto, defectPhoto, source, timeSource,
 *              status, error, tankRead, corners, found, items{}, writtenDate, signed, confidence, remark,
 *              aiResult, flags[], crossFlags[], inspectTiming, submitTiming, reviewNeeded, photoId}]
 *   reviews: [{reviewId, rowId, device, reviewer, reviewedIso, decision, found, items{}, finalResult, note}]
 *   spots:   [{spotId, roundId, device, selectedIso, selectedBy, checker, checkedIso, match, note}]
 * }
 */

var ZONE_ORDER = ['หน้า', 'กลาง', 'บ้านพัก', 'หลัง'];

function zoneIndex_(z) { var i = ZONE_ORDER.indexOf(z); return i < 0 ? 99 : i; }

/** ผลสุดท้ายของบันทึกหนึ่งรายการ หลังรวมการยืนยันของทีม ENV */
function finalizeRecord(rec, reviews) {
  var rs = reviews.filter(function (r) { return r.rowId === rec.rowId; })
    .sort(function (a, b) { return a.reviewedIso < b.reviewedIso ? -1 : 1; });
  var last = rs[rs.length - 1] || null;
  var out = {
    rowId: rec.rowId, device: rec.device, roundId: rec.roundId, capturedIso: rec.capturedIso,
    firstSeenIso: rec.firstSeenIso, inspector: rec.inspector, note: rec.note,
    aiResult: rec.aiResult, aiFound: rec.found, aiItems: rec.items, writtenDate: rec.writtenDate, signed: rec.signed,
    confidence: rec.confidence, remark: rec.remark, tankRead: rec.tankRead, corners: rec.corners,
    flags: (rec.flags || []).concat(rec.crossFlags || []),
    inspectTiming: rec.inspectTiming, submitTiming: rec.submitTiming,
    photoId: rec.photoId, hasDefectPhoto: !!rec.defectPhoto, status: rec.status, error: rec.error,
    source: rec.source || '', timeSource: rec.timeSource || '',
    review: last, found: rec.found, items: rec.items, result: rec.aiResult || 'unknown', reviewStatus: 'auto'
  };
  if (rec.status !== 'OK') {
    out.reviewStatus = rec.status === 'ERROR' ? 'error' : rec.status === 'NEED_TANK' ? 'needtank' : 'processing';
    out.result = 'unknown';
  } else if (last) {
    if (last.decision === 'confirm') { out.reviewStatus = 'confirmed'; }
    else if (last.decision === 'correct') {
      out.reviewStatus = 'corrected'; out.found = last.found; out.items = last.items; out.result = last.finalResult;
    } else if (last.decision === 'retake') { out.reviewStatus = 'retake'; out.result = 'unknown'; }
  } else {
    out.reviewStatus = rec.reviewNeeded ? 'pending' : 'auto';
  }
  return out;
}

/** สถานะของทุกถังในรอบที่ k (ดัชนีใน rounds ที่เรียงแล้ว) */
function tankStatesForRound_(rounds, k, tanks, finals, todayIso) {
  var R = rounds[k];
  var states = {};
  tanks.forEach(function (t) {
    var inRound = finals.filter(function (f) { return f.device === t.id && f.roundId === R.id; })
      .sort(function (a, b) { return a.capturedIso < b.capturedIso ? -1 : 1; });
    var first = inRound[0], last = inRound[inRound.length - 1];
    var s = { id: t.id, loc: t.loc, zone: t.zone, lat: t.lat, lng: t.lng, records: inRound.length, first: first || null, last: last || null };
    if (first) {
      s.inspect = first.inspectTiming === 'late' ? 'late' : 'ontime';
      s.submit = first.submitTiming === 'late' ? 'late' : 'ontime';
      s.result = last.result; s.carried = false;
    } else {
      s.inspect = todayIso < R.inspectStart ? 'notstarted' : (todayIso <= R.inspectEnd ? 'pending' : 'missing');
      s.submit = null;
      var prev = null;
      for (var j = k - 1; j >= 0 && !prev; j--) {
        var pr = finals.filter(function (f) { return f.device === t.id && f.roundId === rounds[j].id; })
          .sort(function (a, b) { return a.capturedIso < b.capturedIso ? -1 : 1; });
        if (pr.length) prev = pr[pr.length - 1];
      }
      s.result = prev ? prev.result : 'nodata';
      s.carried = !!prev;
      s.last = prev;
    }
    states[t.id] = s;
  });
  return states;
}

function countBy_(arr, fn) { var c = {}; arr.forEach(function (x) { var k = fn(x); c[k] = (c[k] || 0) + 1; }); return c; }

function buildDashboard(raw, todayIso, settings, roundId) {
  var rounds = raw.rounds.slice().sort(function (a, b) { return a.inspectStart < b.inspectStart ? -1 : 1; });
  var tanks = raw.tanks.filter(function (t) { return t.active !== false; })
    .sort(function (a, b) { return zoneIndex_(a.zone) - zoneIndex_(b.zone) || (a.id < b.id ? -1 : 1); });
  var finals = raw.records.map(function (r) { return finalizeRecord(r, raw.reviews); });

  var current = roundId ? rounds.filter(function (r) { return r.id === roundId; })[0] : roundForDate(rounds, todayIso);
  if (!current) current = rounds[0] || null;
  if (!current) return { ok: false, message: 'ยังไม่มีรอบตรวจในชีต Rounds' };
  var k = rounds.indexOf(current);
  var states = tankStatesForRound_(rounds, k, tanks, finals, todayIso);
  var list = tanks.map(function (t) { return states[t.id]; });

  // since: นับจากรอบแรกที่สถานะไม่พร้อมใช้ต่อเนื่องจนถึงรอบนี้
  list.forEach(function (s) {
    if (s.result !== 'broken' && s.result !== 'absent') return;
    var since = s.last ? s.last.capturedIso : null;
    for (var j = k; j >= 0; j--) {
      var recs = finals.filter(function (f) { return f.device === s.id && f.roundId === rounds[j].id; })
        .sort(function (a, b) { return a.capturedIso < b.capturedIso ? -1 : 1; });
      if (!recs.length) continue;
      var lr = recs[recs.length - 1];
      if (lr.result === s.result) since = recs.filter(function (x) { return x.result === s.result; })[0].capturedIso;
      else break;
    }
    s.since = since ? since.slice(0, 10) : null;
    s.openDays = s.since ? dayNum(todayIso) - dayNum(s.since) : null;
  });

  var cInspect = countBy_(list, function (s) { return s.inspect; });
  var cSubmit = countBy_(list.filter(function (s) { return s.submit; }), function (s) { return s.submit; });
  var cResult = countBy_(list, function (s) { return s.result; });

  var zones = ZONE_ORDER.map(function (z) {
    var zs = list.filter(function (s) { return s.zone === z; });
    var c = countBy_(zs, function (s) { return s.result; });
    return {
      zone: z, total: zs.length, ready: c.ready || 0, broken: c.broken || 0, absent: c.absent || 0,
      unknown: (c.unknown || 0) + (c.nodata || 0),
      inspected: zs.filter(function (s) { return s.first; }).length,
      firstDate: zs.filter(function (s) { return s.first; }).map(function (s) { return s.first.capturedIso.slice(0, 10); }).sort()[0] || null
    };
  }).filter(function (z) { return z.total > 0; });

  var itemFail = CARD_ITEM_KEYS.map(function (key) {
    return {
      key: key, label: ITEM_TH[key],
      count: list.filter(function (s) { return s.first && s.last && s.last.found === 'found' && s.last.items && s.last.items[key] === 'bad'; }).length
    };
  });
  itemFail.push({ key: 'absent', label: 'ไม่พบถังที่จุดติดตั้ง', count: list.filter(function (s) { return s.first && s.result === 'absent'; }).length });

  // คิวยืนยัน: รายการที่ยังรอยืนยัน (ทุกรอบ) + ขอถ่ายใหม่ที่ยังไม่มีรูปใหม่ + ที่ยืนยันแล้วในรอบนี้
  var tankById = {}; raw.tanks.forEach(function (t) { tankById[t.id] = t; });
  function withTank(f) {
    var t = tankById[f.device] || {};
    var o = JSON.parse(JSON.stringify(f)); o.loc = t.loc || ''; o.zone = t.zone || '';
    var rd = rounds.filter(function (r) { return r.id === f.roundId; })[0];
    o.roundLabel = rd ? rd.label : 'นอกรอบ';
    return o;
  }
  var newerExists = function (f) {
    return finals.some(function (g) { return g.device === f.device && g.roundId === f.roundId && g.capturedIso > f.capturedIso; });
  };
  var queue = {
    pending: finals.filter(function (f) { return f.reviewStatus === 'pending' && !newerExists(f); }),
    retake: finals.filter(function (f) { return f.reviewStatus === 'retake' && !newerExists(f); }),
    processing: finals.filter(function (f) { return f.reviewStatus === 'processing' || f.reviewStatus === 'error' || f.reviewStatus === 'needtank'; }),
    done: finals.filter(function (f) { return (f.reviewStatus === 'confirmed' || f.reviewStatus === 'corrected') && f.roundId === current.id; })
  };
  var rank = { broken: 0, absent: 1, unknown: 2, ready: 3 };
  Object.keys(queue).forEach(function (key) {
    queue[key] = queue[key].sort(function (a, b) {
      return (a.roundId === current.id ? 0 : 1) - (b.roundId === current.id ? 0 : 1) || (rank[a.result] - rank[b.result]) || (a.device < b.device ? -1 : 1);
    }).map(withTank);
  });

  var reviewed = finals.filter(function (f) { return f.roundId === current.id && (f.reviewStatus === 'confirmed' || f.reviewStatus === 'corrected'); });
  var corrected = reviewed.filter(function (f) { return f.reviewStatus === 'corrected'; }).length;

  var spots = raw.spots.filter(function (s) { return s.roundId === current.id; }).map(function (s) {
    var st = states[s.device] || {};
    var t = tankById[s.device] || {};
    return { spotId: s.spotId, device: s.device, loc: t.loc || '', zone: t.zone || '', selectedIso: s.selectedIso, checker: s.checker, checkedIso: s.checkedIso, match: s.match, note: s.note, systemResult: st.result || 'nodata' };
  });
  var spotDone = spots.filter(function (s) { return s.match; });

  // แนวโน้มรายรอบ (ถึงรอบนี้)
  var trend = [];
  for (var j = 0; j <= k; j++) {
    var stj = j === k ? states : tankStatesForRound_(rounds, j, tanks, finals, todayIso);
    var lj = tanks.map(function (t) { return stj[t.id]; });
    var ci = countBy_(lj, function (s) { return s.inspect; });
    var sj = raw.spots.filter(function (s) { return s.roundId === rounds[j].id && s.match; });
    trend.push({
      id: rounds[j].id, label: rounds[j].label, total: lj.length,
      inspected: (ci.ontime || 0) + (ci.late || 0), ontime: ci.ontime || 0, late: ci.late || 0, missing: ci.missing || 0,
      ready: lj.filter(function (s) { return s.result === 'ready'; }).length,
      spotChecked: sj.length, spotMatch: sj.filter(function (s) { return s.match === 'match'; }).length
    });
  }

  var tankRows = list.map(function (s) {
    var l = s.last;
    return {
      id: s.id, loc: s.loc, zone: s.zone, lat: s.lat, lng: s.lng,
      inspect: s.inspect, submit: s.submit, result: s.result, carried: s.carried, since: s.since || null, openDays: s.openDays,
      capturedIso: s.first ? s.first.capturedIso : null, firstSeenIso: s.first ? s.first.firstSeenIso : null,
      lastRowId: l ? l.rowId : null, reviewStatus: l && !s.carried ? l.reviewStatus : null,
      flags: l && !s.carried ? l.flags : [], note: l ? (l.note || '') : '',
      badItems: l && l.items ? CARD_ITEM_KEYS.filter(function (key) { return l.items[key] === 'bad'; }).map(function (key) { return ITEM_TH[key]; }) : []
    };
  });

  var n = tankRows.length;
  return {
    ok: true,
    today: todayIso,
    round: current,
    rounds: rounds.map(function (r) { return { id: r.id, label: r.label }; }),
    phase: todayIso < current.inspectStart ? 'notstarted' : todayIso <= current.inspectEnd ? 'inspecting' : todayIso <= current.submitBy ? 'submitting' : 'closed',
    daysLeft: dayNum(current.inspectEnd) - dayNum(todayIso),
    summary: {
      total: n,
      inspected: (cInspect.ontime || 0) + (cInspect.late || 0),
      ontime: cInspect.ontime || 0, late: cInspect.late || 0, missing: cInspect.missing || 0, pending: (cInspect.pending || 0) + (cInspect.notstarted || 0),
      submitOntime: cSubmit.ontime || 0, submitLate: cSubmit.late || 0,
      ready: cResult.ready || 0, broken: cResult.broken || 0, absent: cResult.absent || 0,
      unknown: (cResult.unknown || 0) + (cResult.nodata || 0),
      queuePending: queue.pending.length, queueRetake: queue.retake.length, processing: queue.processing.length,
      flagged: finals.filter(function (f) { return f.roundId === current.id && f.flags.length; }).length,
      reviewed: reviewed.length, corrected: corrected,
      spotTotal: spots.length, spotChecked: spotDone.length, spotMatch: spotDone.filter(function (s) { return s.match === 'match'; }).length
    },
    zones: zones,
    itemFail: itemFail,
    tanks: tankRows,
    queue: queue,
    spots: spots,
    trend: trend,
    settings: { confidenceMin: settings.CONFIDENCE_MIN, spotCount: settings.SPOT_CHECK_COUNT, cardColumns: settings.CARD_COLUMNS, orgName: settings.ORG_NAME }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { buildDashboard: buildDashboard, finalizeRecord: finalizeRecord, ZONE_ORDER: ZONE_ORDER };
}
