/** ทดสอบเส้นทางหลัก: ช่างเข้าสู่ระบบด้วย PIN → ส่งรูปทาง LINE → AI อ่าน → ทีม ENV เข้า Dashboard ด้วย OTP */
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./gas-mock');
const { jpegWithExif } = require('./helpers');

const OK_CARD = { tank_id_read: 'FE012', corners_visible: 4, found: 'found', items: { pin: 'ok', lever: 'ok', body: 'ok', gauge: 'ok', powder: 'ok', mount: 'ok' }, written_day: '03', written_month: '12', signed: true, confidence: 0.95, remark: '' };

function lineEvent(env, ev) {
  ev.webhookEventId = ev.webhookEventId || Math.random().toString(36).slice(2);
  ev.source = ev.source || { type: 'user', userId: 'U1' };
  ev.replyToken = ev.replyToken || 'rt';
  const out = env.g('doPost')({ parameter: { key: env.props.LINE_WEBHOOK_KEY }, postData: { contents: JSON.stringify({ destination: 'X', events: [ev] }) } });
  const last = env.outbox.line[env.outbox.line.length - 1];
  return { out: out, reply: last ? last.body.messages[0].text : '' };
}
function api(env, body) { return JSON.parse(env.g('doPost')({ parameter: {}, postData: { contents: JSON.stringify(body) } }).text); }

function boot(opts) {
  const env = createEnv(opts);
  env.props.LINE_CHANNEL_ACCESS_TOKEN = 't';
  env.props.GEMINI_API_KEY = 'g';
  env.g('setup')();
  return env;
}

test('flow: PIN → รูป → ผลอ่าน → คำสั่งต่าง ๆ', () => {
  const env = boot({ jpeg: jpegWithExif('2026:12:03 09:15:30') });
  env.setGemini(() => OK_CARD);
  const s = env.g('staffUpsert_')('ช่างต้อม');
  assert.match(s.pin, /^\d{6}$/);

  // ยังไม่เข้าสู่ระบบ → รูปถูกพักไว้
  let r = lineEvent(env, { type: 'message', timestamp: Date.parse('2026-12-03T05:00:00Z'), message: { type: 'image', id: 'm0' } });
  assert.match(r.reply, /PIN/);
  assert.strictEqual(env.rows('Inspections').length, 0);

  // PIN ผิด
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: '000000' } });
  assert.match(r.reply, /ไม่ถูกต้อง/);

  // PIN ถูก → บันทึกรูปที่พักไว้
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: s.pin } });
  assert.match(r.reply, /เข้าสู่ระบบแล้ว: ช่างต้อม/);
  assert.match(r.reply, /1 รูป/);
  assert.strictEqual(env.rows('AI_Results')[0].Status, 'NEW');

  // ส่งรูปหลังเข้าสู่ระบบ → อ่านทันที
  r = lineEvent(env, { type: 'message', timestamp: Date.parse('2026-12-03T05:10:00Z'), message: { type: 'image', id: 'm1' } });
  assert.match(r.reply, /FE012/);
  assert.match(r.reply, /พร้อมใช้/);
  const ai = env.rows('AI_Results')[1];
  assert.strictEqual(ai.Status, 'OK');
  assert.strictEqual(ai.Device_ID, 'FE012');
  assert.strictEqual(ai.Round_ID, 'R2569-12');
  assert.strictEqual(ai.Inspect_Timing, 'ontime');
  const ins = env.rows('Inspections')[1];
  assert.strictEqual(ins.Time_Source, 'EXIF');
  assert.strictEqual(ins.Captured_At, '2026-12-03T09:15:30');
  assert.strictEqual(ins.Inspector, 'ช่างต้อม');

  // หมายเหตุ / ตำแหน่ง / รูปชำรุด
  lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'ป้ายหลุด' } });
  assert.strictEqual(env.rows('Inspections')[1].Note, 'ป้ายหลุด');
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'รูปชำรุด' } });
  assert.match(r.reply, /ส่งรูปจุดชำรุด/);
  lineEvent(env, { type: 'message', message: { type: 'image', id: 'm2' } });
  assert.ok(env.rows('Inspections')[1].Defect_Photo);
  assert.strictEqual(env.rows('Inspections').length, 2);

  // แก้รหัสถัง → AI อ่านใหม่และมีธงไม่ตรง
  const before = env.outbox.gemini;
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'fe13' } });
  assert.strictEqual(env.outbox.gemini, before + 1);
  assert.strictEqual(env.rows('AI_Results')[1].Device_ID, 'FE013');
  assert.match(r.reply, /ไม่ตรงกับที่ช่างระบุ/);

  // ยกเลิก
  lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'ยกเลิก' } });
  assert.strictEqual(env.rows('AI_Results')[1].Status, 'CANCELLED');

  // สถานะ
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'สถานะ' } });
  assert.match(r.reply, /ส่งรูปบัตรแล้ว/);

  // trigger อ่านรูปที่พักไว้ แล้ว push ผล
  const pushes = env.outbox.line.filter((x) => x.url.indexOf('/push') >= 0).length;
  env.g('processNewInspections')();
  assert.strictEqual(env.rows('AI_Results')[0].Status, 'OK');
  assert.strictEqual(env.rows('AI_Results')[0].Line_Notified, 'YES');
  assert.strictEqual(env.outbox.line.filter((x) => x.url.indexOf('/push') >= 0).length, pushes + 1);

  // ส่งซ้ำ event เดิม (redelivery) ไม่สร้างแถวใหม่
  const n = env.rows('Inspections').length;
  lineEvent(env, { webhookEventId: 'dup', type: 'message', message: { type: 'image', id: 'm9' } });
  lineEvent(env, { webhookEventId: 'dup', type: 'message', message: { type: 'image', id: 'm9' } });
  assert.strictEqual(env.rows('Inspections').length, n + 1);

  // ออกจากระบบ
  lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'ออกจากระบบ' } });
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'สถานะ' } });
  assert.match(r.reply, /PIN/);
});

test('flow: ไม่มี EXIF → ใช้วันที่บนบัตร, อ่านรหัสไม่ได้ → รอช่างพิมพ์', () => {
  const env = boot({});
  const s = env.g('staffUpsert_')('ช่างเอ');
  lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: s.pin } });

  // ส่งช้า (หลังวันสุดท้าย) แต่บัตรเขียนวันที่ 03/12 → ตรวจตรงเวลา ส่งช้า
  env.setGemini(() => OK_CARD);
  lineEvent(env, { type: 'message', timestamp: Date.parse('2026-12-20T03:00:00Z'), message: { type: 'image', id: 'a1' } });
  const ins = env.rows('Inspections')[0];
  assert.strictEqual(ins.Time_Source, 'CARD');
  assert.strictEqual(ins.Captured_At, '2026-12-03T00:00:00');
  const ai = env.rows('AI_Results')[0];
  assert.strictEqual(ai.Inspect_Timing, 'ontime');
  assert.strictEqual(ai.Submit_Timing, 'late');

  env.setGemini(() => Object.assign({}, OK_CARD, { tank_id_read: '' }));
  let r = lineEvent(env, { type: 'message', timestamp: Date.parse('2026-12-04T03:00:00Z'), message: { type: 'image', id: 'a2' } });
  assert.match(r.reply, /พิมพ์รหัสถัง/);
  assert.strictEqual(env.rows('AI_Results')[1].Status, 'NEED_TANK');
  r = lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: 'FE020' } });
  assert.strictEqual(env.rows('AI_Results')[1].Status, 'OK');
  assert.strictEqual(env.rows('AI_Results')[1].Device_ID, 'FE020');
});

test('Dashboard API: Gmail + OTP, ยืนยัน, ขอถ่ายใหม่แจ้ง LINE, จัดการช่าง', () => {
  const env = boot({});
  const s = env.g('staffUpsert_')('ช่างบี');
  lineEvent(env, { type: 'message', message: { type: 'text', id: 't', text: s.pin } });
  env.setGemini(() => Object.assign({}, OK_CARD, { items: Object.assign({}, OK_CARD.items, { gauge: 'bad' }) }));
  lineEvent(env, { type: 'message', timestamp: Date.parse('2026-12-03T03:00:00Z'), message: { type: 'image', id: 'b1' } });

  // OTP: อีเมลที่ไม่มีสิทธิ์ก็ตอบเหมือนกัน แต่ไม่ส่งอีเมล
  const mails = env.outbox.mail.length;
  assert.strictEqual(api(env, { action: 'otpRequest', email: 'nobody@gmail.com' }).ok, true);
  assert.strictEqual(env.outbox.mail.length, mails);
  assert.strictEqual(api(env, { action: 'otpRequest', email: 'Owner@gmail.com' }).ok, true);
  const mail = env.outbox.mail[env.outbox.mail.length - 1];
  const code = mail.subject.match(/(\d{6})/)[1];
  assert.strictEqual(api(env, { action: 'otpVerify', email: 'owner@gmail.com', code: '000000' }).ok, false);
  const v = api(env, { action: 'otpVerify', email: 'owner@gmail.com', code: code });
  assert.strictEqual(v.ok, true, v.error);
  const token = v.data.token;
  assert.strictEqual(v.data.user.role, 'ADMIN');

  let d = api(env, { action: 'dashboard', token: token });
  assert.strictEqual(d.ok, true, d.error);
  assert.strictEqual(d.data.version, d.version);
  assert.strictEqual(d.data.queue.pending.length, 1);
  const rowId = d.data.queue.pending[0].rowId;

  const pushes = env.outbox.line.filter((x) => x.url.indexOf('/push') >= 0).length;
  d = api(env, { action: 'review', token: token, p: { rowId: rowId, decision: 'retake', note: 'เกจไม่ชัด' } });
  assert.strictEqual(d.ok, true, d.error);
  const push = env.outbox.line.filter((x) => x.url.indexOf('/push') >= 0);
  assert.strictEqual(push.length, pushes + 1);
  assert.match(push[push.length - 1].body.messages[0].text, /เกจไม่ชัด/);

  const sl = api(env, { action: 'staffList', token: token });
  assert.strictEqual(sl.data[0].devices.length, 1);
  const np = api(env, { action: 'staffSave', token: token, p: { staffId: sl.data[0].staffId, name: 'ช่างบี', newPin: true } });
  assert.match(np.data.pin, /^\d{6}$/);
  assert.strictEqual(np.data.list[0].devices.length, 0);   // ออก PIN ใหม่ = ทุกเครื่องต้องเข้าสู่ระบบใหม่

  const ad = api(env, { action: 'adminSave', token: token, p: { email: 'env@gmail.com', name: 'ENV', role: 'VIEW' } });
  assert.strictEqual(ad.data.length, 2);
  assert.strictEqual(api(env, { action: 'adminSave', token: token, p: { email: 'owner@gmail.com', name: 'x', role: 'VIEW' } }).ok, false);
  assert.strictEqual(api(env, { action: 'dashboard', token: 'bad' }).error, 'SESSION_EXPIRED');
});

test('webhook ที่ไม่มี key ถูกปฏิเสธ', () => {
  const env = boot({});
  const out = env.g('doPost')({ parameter: {}, postData: { contents: JSON.stringify({ events: [] }) } });
  assert.strictEqual(out.text, 'forbidden');
});
