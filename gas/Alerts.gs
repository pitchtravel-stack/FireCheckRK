/**
 * Alerts.gs — อีเมลสรุปถึงทีม ENV (ช่างไม่ได้รับการแจ้งเตือน)
 * ทำงานทุกวันประมาณ 07:30 น. ส่งเฉพาะวันที่มีเรื่องต้องแจ้ง
 */

function dailyDigest() { sendDigest_(false); }
function sendDigestNow() { sendDigest_(true); }

function sendDigest_(force) {
  const st = getSettings_();
  if (!st.ENV_EMAILS) { log_('WARN', 'ยังไม่ได้ใส่ ENV_EMAILS ในชีต Settings'); return; }
  const raw = loadRaw_();
  const today = todayIso_();
  const D = buildDashboard(raw, today, st);
  if (!D.ok) { log_('WARN', D.message); return; }
  const R = D.round, S = D.summary;
  const dn = dayNum(today);
  const isMonday = Utilities.formatDate(new Date(), TZ, 'u') === '1';
  const sections = [];
  const listTanks = function (filter) {
    return D.tanks.filter(filter).map(function (t) { return '  - ' + t.id + ' ' + t.loc + ' (โซน' + t.zone + ')'; }).join('\n');
  };

  if (dn >= dayNum(R.inspectStart) && dn <= dayNum(R.submitBy) + 1) {
    if (dn === dayNum(R.inspectStart) + 7) {
      sections.push('ความคืบหน้ากลางรอบ ' + R.label + '\nถ่ายรูปบัตรแล้ว ' + S.inspected + '/' + S.total + ' ถัง\n' +
        D.zones.map(function (z) { return '  โซน' + z.zone + ' ' + z.inspected + '/' + z.total; }).join('\n'));
    }
    if (dn === dayNum(R.inspectEnd)) {
      const left = D.tanks.filter(function (t) { return t.inspect === 'pending'; });
      sections.push('วันนี้เป็นวันสุดท้ายของช่วงตรวจรอบ ' + R.label + (left.length ? '\nยังไม่มีรูปบัตร ' + left.length + ' ถัง:\n' + listTanks(function (t) { return t.inspect === 'pending'; }) : '\nถ่ายรูปบัตรครบทุกถังแล้ว'));
    }
    if (dn === dayNum(R.submitBy) + 1) {
      sections.push('ปิดรอบ ' + R.label + '\nตรวจตรงเวลา ' + S.ontime + ' · ตรวจช้า ' + S.late + ' · ไม่ได้ตรวจ ' + S.missing +
        '\nส่งข้อมูลตรงเวลา ' + S.submitOntime + ' · ส่งช้า ' + S.submitLate +
        '\nพร้อมใช้ ' + S.ready + ' · ชำรุด ' + S.broken + ' · ไม่อยู่ที่จุด ' + S.absent + ' · รอผล ' + S.unknown +
        '\nถึงเวลาสุ่มตรวจซ้ำ ' + st.SPOT_CHECK_COUNT + ' ถัง (กดสุ่มในหน้า Dashboard แท็บสุ่มตรวจ)');
    }
  }
  if (dn > dayNum(R.inspectEnd) && S.missing > 0 && isMonday) {
    sections.push('รอบ ' + R.label + ' เลยกำหนดแล้ว ยังไม่ได้ตรวจ ' + S.missing + ' ถัง:\n' + listTanks(function (t) { return t.inspect === 'missing'; }));
  }
  if (S.queuePending > 0) sections.push('รอทีม ENV ยืนยันผล AI ' + S.queuePending + ' รายการ' + (S.queueRetake ? ' · ขอให้ช่างถ่ายใหม่ ' + S.queueRetake + ' รายการ' : ''));

  const props = PropertiesService.getScriptProperties();
  const lastAt = props.getProperty('LAST_DIGEST_AT') || '';
  const newNotReady = raw.reviews.filter(function (r) {
    return r.reviewedIso > lastAt && (r.finalResult === 'broken' || r.finalResult === 'absent');
  });
  if (newNotReady.length) {
    const byId = {};
    raw.tanks.forEach(function (t) { byId[t.id] = t; });
    sections.push('ทีม ENV ยืนยันถังไม่พร้อมใช้ใหม่ ' + newNotReady.length + ' ถัง:\n' + newNotReady.map(function (r) {
      return '  - ' + r.device + ' ' + ((byId[r.device] || {}).loc || '') + ' — ' + RESULT_TH[r.finalResult] + (r.note ? ' · ' + r.note : '');
    }).join('\n'));
  }

  if (!sections.length && !force) return;
  const body = '[FireCheck] สรุปถังดับเพลิง ' + st.ORG_NAME + ' ' + thaiDate(today, true) + '\n' +
    'รอบ ' + R.label + ' · ช่วงตรวจ ' + thaiDate(R.inspectStart) + '–' + thaiDate(R.inspectEnd) + ' · ส่งภายใน ' + thaiDate(R.submitBy) + '\n\n' +
    (sections.length ? sections.join('\n\n') : 'ไม่มีเรื่องต้องแจ้งวันนี้') +
    '\n\nสภาพถังล่าสุด: พร้อมใช้ ' + S.ready + '/' + S.total + ' · ชำรุด ' + S.broken + ' · ไม่อยู่ที่จุด ' + S.absent +
    '\nเปิด Dashboard: ' + (st.DASHBOARD_URL || '(ยังไม่ได้ใส่ DASHBOARD_URL ในชีต Settings)');
  MailApp.sendEmail({ to: st.ENV_EMAILS, subject: '[FireCheck] สรุปถังดับเพลิง ' + thaiDate(today) + ' · รอบ ' + R.label, body: body });
  props.setProperty('LAST_DIGEST_AT', nowIso_());
}
