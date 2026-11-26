const test = require('node:test');
const assert = require('node:assert');
const R = require('../gas/Rules.gs');
const { jpegWithExif } = require('./helpers');

test('normalizeTankId', () => {
  assert.strictEqual(R.normalizeTankId('fe 12'), 'FE012');
  assert.strictEqual(R.normalizeTankId('FE-054'), 'FE054');
  assert.strictEqual(R.normalizeTankId('Fe1'), 'FE001');
  assert.strictEqual(R.normalizeTankId('FE0123'), '');
  assert.strictEqual(R.normalizeTankId('ถัง FE012'), '');
});

test('parseLineText', () => {
  assert.deepStrictEqual(R.parseLineText(' 123456 '), { cmd: 'pin', value: '123456' });
  assert.strictEqual(R.parseLineText('fe12').cmd, 'tank');
  assert.strictEqual(R.parseLineText('ยกเลิก').cmd, 'cancel');
  assert.strictEqual(R.parseLineText('รูปชำรุด').cmd, 'defect');
  assert.strictEqual(R.parseLineText('สถานะ').cmd, 'status');
  assert.strictEqual(R.parseLineText('ออกจากระบบ').cmd, 'logout');
  assert.strictEqual(R.parseLineText('วิธีใช้').cmd, 'help');
  assert.deepStrictEqual(R.parseLineText('ซ่อมแล้ว FE 7'), { cmd: 'fix', value: 'FE007' });
  assert.deepStrictEqual(R.parseLineText('ติดตั้งแล้ว'), { cmd: 'fix', value: '' });
  assert.deepStrictEqual(R.parseLineText('สายฉีดแตก'), { cmd: 'note', value: 'สายฉีดแตก' });
});

test('cardDateIso', () => {
  const rd = { inspectStart: '2026-12-01' };
  assert.strictEqual(R.cardDateIso('03', '12', rd, '2026-12-20T10:00:00'), '2026-12-03');
  assert.strictEqual(R.cardDateIso('03', '11', rd, '2026-12-20'), '');     // เดือนไม่ตรงรอบ
  assert.strictEqual(R.cardDateIso('31', '12', rd, '2026-12-20'), '');     // ล่วงหน้าวันส่ง
  assert.strictEqual(R.cardDateIso('31', '09', { inspectStart: '2026-09-01' }, '2026-10-20'), ''); // ไม่มีวันที่ 31 ก.ย.
});

test('exifDateTime', () => {
  assert.strictEqual(R.exifDateTime(jpegWithExif('2026:12:03 09:15:30')), '2026-12-03T09:15:30');
  assert.strictEqual(R.exifDateTime([0xFF - 256, 0xD8 - 256, 0xFF - 256, 0xD9 - 256]), '');
  assert.strictEqual(R.exifDateTime([1, 2, 3]), '');
});

test('evaluateCard ไม่ระบุถัง = ไม่มีธงรหัสไม่ตรง', () => {
  const ai = R.normalizeAi({ tank_id_read: 'FE012', corners_visible: 4, found: 'found', items: { pin: 'ok', lever: 'ok', body: 'ok', gauge: 'ok', powder: 'ok', mount: 'ok' }, written_day: '3', written_month: '12', signed: true, confidence: 0.95 });
  const ev = R.evaluateCard(ai, { selectedTank: '', roundLabel: 'ธ.ค. 69', roundMonth: '12', hasRound: true });
  assert.strictEqual(ev.result, 'ready');
  assert.deepStrictEqual(ev.flags, []);
  const ev2 = R.evaluateCard(ai, { selectedTank: 'FE013', roundLabel: 'ธ.ค. 69', roundMonth: '12', hasRound: true });
  assert.ok(ev2.flags.some((f) => f.indexOf('ไม่ตรง') >= 0));
});

test('computeCrossFlags ข้ามการคิดความเร็วเมื่อไม่รู้เวลาถ่ายจริง', () => {
  const tanks = { FE001: { lat: 18.306115, lng: 100.290655 }, FE031: { lat: 18.307294, lng: 100.289905 } };
  const st = { SPEED_MAX_MPS: 2, SPEED_MIN_DIST_M: 30 };
  const recs = [
    { rowId: 'a', device: 'FE001', capturedIso: '2026-12-03T09:00:00', inspector: 'x', hash: '1', exactTime: true },
    { rowId: 'b', device: 'FE031', capturedIso: '2026-12-03T09:00:10', inspector: 'x', hash: '2', exactTime: true }
  ];
  assert.ok(R.computeCrossFlags(recs, tanks, st).b);
  recs.forEach((r) => { r.exactTime = false; });
  assert.strictEqual(R.computeCrossFlags(recs, tanks, st).b, undefined);
});

