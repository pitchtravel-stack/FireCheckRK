/**
 * Config.gs — ตั้งค่าระบบ สร้างชีต เมนู และตัวช่วยอ่าน/เขียนชีต
 * FireCheck · ระบบตรวจถังดับเพลิงด้วยบัตรเช็ค + AI (ส่งรูปผ่าน LINE OA)
 */

const APP_VERSION = '2.1.0';
const TZ = 'Asia/Bangkok';

const SH = {
  TANKS: 'Tanks', INSP: 'Inspections', AI: 'AI_Results', REV: 'Reviews', SPOT: 'Spot_Checks',
  ROUNDS: 'Rounds', SET: 'Settings', STAFF: 'Staff', DEV: 'Line_Devices', ADM: 'Admins', LOG: 'Log'
};

const HEAD = {
  Tanks: ['Device_ID', 'Location', 'Zone', 'Type', 'Size', 'Ref_Lat', 'Ref_Lng', 'QR_Code', 'Active', 'Note'],
  Inspections: ['Row_ID', 'Device_ID', 'Card_Photo', 'Defect_Photo', 'Note', 'Captured_At', 'GPS', 'Inspector',
    'Source', 'Time_Source', 'Sent_At', 'Line_User_ID', 'Message_ID'],
  AI_Results: ['Row_ID', 'Device_ID', 'Round_ID', 'First_Seen_At', 'Read_At', 'Status', 'Attempts', 'Tank_ID_Read', 'Corners',
    'Found', 'Pin', 'Lever', 'Body', 'Gauge', 'Powder', 'Mount', 'Written_Date', 'Signed', 'Confidence', 'Remark',
    'AI_Result', 'Flags', 'Cross_Flags', 'Inspect_Timing', 'Submit_Timing', 'Review_Needed', 'Photo_File_ID', 'Photo_Hash',
    'Model', 'Error', 'Claimed_At', 'Line_Notified'],
  Reviews: ['Review_ID', 'Row_ID', 'Device_ID', 'Reviewer', 'Reviewed_At', 'Decision', 'Found', 'Pin', 'Lever', 'Body',
    'Gauge', 'Powder', 'Mount', 'Final_Result', 'Note'],
  Spot_Checks: ['Spot_ID', 'Round_ID', 'Device_ID', 'Selected_At', 'Selected_By', 'Checker', 'Checked_At', 'Match', 'Note'],
  Rounds: ['Round_ID', 'Label', 'Inspect_Start', 'Inspect_End', 'Submit_By', 'Note'],
  Settings: ['Key', 'Value', 'Description'],
  Staff: ['Staff_ID', 'Name', 'PIN_Hash', 'Active', 'Created_At', 'Note'],
  Line_Devices: ['Line_User_ID', 'Line_Name', 'Staff_ID', 'Staff_Name', 'Login_At', 'Expires_At', 'Last_Seen_At'],
  Admins: ['Email', 'Name', 'Role', 'Active', 'Created_At'],
  Log: ['Time', 'Level', 'Message']
};

const ITEM_COLS = { pin: 'Pin', lever: 'Lever', body: 'Body', gauge: 'Gauge', powder: 'Powder', mount: 'Mount' };

const DEFAULT_SETTINGS = [
  ['ORG_NAME', 'โรงพยาบาลร้องกวาง', 'ชื่อหน่วยงานที่แสดงในหน้าเว็บและอีเมล'],
  ['ROUND_MONTHS', '9,12,3,6', 'เดือนที่เป็นรอบตรวจ (ใช้ตอนสร้างรอบใหม่)'],
  ['INSPECT_START_DAY', '1', 'วันแรกของช่วงตรวจ'],
  ['INSPECT_END_DAY', '15', 'วันสุดท้ายของช่วงตรวจ'],
  ['SUBMIT_GRACE_DAYS', '2', 'ส่งข้อมูลได้ถึงกี่วันหลังวันสุดท้ายของช่วงตรวจ'],
  ['CARD_COLUMNS', 'ก.ย. 69|ธ.ค. 69|มี.ค. 70|มิ.ย. 70', 'หัวคอลัมน์บนบัตรชุดที่ใช้อยู่ เรียงซ้ายไปขวา คั่นด้วย |'],
  ['CONFIDENCE_MIN', '0.8', 'ถ้า AI มั่นใจต่ำกว่านี้ ต้องให้ทีม ENV ยืนยัน'],
  ['SPEED_MAX_MPS', '2', 'ความเร็วเดินสูงสุดที่ถือว่าเป็นไปได้ (เมตร/วินาที) ใช้เฉพาะรูปที่มีเวลาถ่ายจริง'],
  ['SPEED_MIN_DIST_M', '30', 'ตรวจความเร็วเฉพาะถังที่ห่างกันเกินกี่เมตร'],
  ['SPOT_CHECK_COUNT', '5', 'จำนวนถังที่สุ่มตรวจซ้ำต่อรอบ'],
  ['ENV_EMAILS', '', 'อีเมลทีม ENV ที่รับการแจ้งเตือน คั่นด้วย ,'],
  ['IMMEDIATE_ALERT', 'TRUE', 'ส่งอีเมลทันทีเมื่อ AI พบถังชำรุดหรือไม่อยู่ที่จุด (TRUE/FALSE)'],
  ['GEMINI_MODEL', 'gemini-3.8-flash', 'ชื่อโมเดล Gemini ตรวจรายชื่อล่าสุดที่ ai.google.dev/gemini-api/docs/models'],
  ['GEMINI_FALLBACK_MODEL', '', 'โมเดลสำรองเมื่อโมเดลหลักไม่ว่าง (HTTP 503/429) ใส่ได้หลายชื่อคั่นด้วย , — ว่าง = ไม่ใช้'],
  ['DATE_ORDER', 'DMY', 'ลำดับวันที่ถ้าเซลล์เป็นข้อความ: DMY (วัน/เดือน/ปี) หรือ MDY'],
  ['DASHBOARD_URL', '', 'ลิงก์ Dashboard บน GitHub Pages (ใส่ในอีเมลแจ้งเตือน)'],
  ['LINE_SESSION_HOURS', '12', 'ช่างเข้าสู่ระบบด้วย PIN แล้วใช้ได้กี่ชั่วโมงหลังใช้งานล่าสุด (0 = ไม่หมดอายุจนกว่าจะพิมพ์ "ออกจากระบบ")'],
  ['LINE_PUSH_RESULT', 'TRUE', 'ส่งผลอ่านทาง LINE เมื่อระบบอ่านรูปทีหลัง (ใช้โควตาข้อความ push)'],
  ['LINE_NOTIFY_RETAKE', 'TRUE', 'แจ้งช่างทาง LINE เมื่อทีม ENV กด "ขอให้ช่างถ่ายใหม่"']
];

/** ถังดับเพลิง 54 ถัง จากทะเบียนเดิม (พิกัดอ้างอิงจากการตรวจครั้งแรก) */
const SEED_TANKS = [
  ["FE001", "หน้าทางเข้ากายภาพ", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306115, 100.290655],
  ["FE002", "ประตูหลังกายภาพ", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306307, 100.290482],
  ["FE003", "หน้าไตเทียม", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306375, 100.290432],
  ["FE004", "ที่เก็บถังออกซิเจน", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306579, 100.290686],
  ["FE005", "หน้าlab", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306383, 100.290717],
  ["FE006", "หน้าห้องฟัน", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.30638, 100.291171],
  ["FE007", "หน้าห้องร้องเข็ม", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306817, 100.291053],
  ["FE008", "โรงครัว", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.307075, 100.291002],
  ["FE009", "ซักฟอก", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.307124, 100.290996],
  ["FE010", "จ่ายกลาง", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307332, 100.29107],
  ["FE011", "บ้านพัก 323/7", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307043, 100.291013],
  ["FE012", "แฟลตเก่าชั้น 2 ซ้ายบันได", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307424, 100.29159],
  ["FE013", "แฟลตเก่าชั้น 2 ขวาบันได", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307298, 100.291584],
  ["FE014", "แฟลตเก่าชั้น 3 ซ้ายบันได", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307366, 100.291622],
  ["FE015", "แฟลตเก่าชั้น 3 ขวาบันได", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307299, 100.291585],
  ["FE016", "แฟลตเก่าชั้น 1", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307292, 100.291515],
  ["FE017", "บ้าน 323/16 หน้าแฟลตเก่า", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307191, 100.291551],
  ["FE018", "บ้าน 323/2 บ้านเก่าพี่หวาน", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307007, 100.291679],
  ["FE019", "หน้าห้องพักยานยนต์", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.307006, 100.291837],
  ["FE020", "บ้าน 323/1 บ้านหมอเปิ้ล", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307115, 100.291891],
  ["FE021", "แผนไทย", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306795, 100.29178],
  ["FE022", "บ้านพักนักศึกษาหัวมุมเข้าคลังยา", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.306974, 100.290911],
  ["FE023", "ห้องพักแม่บ้าน", "หลัง", "เคมีแห้ง", "15 ปอนด์", 18.306967, 100.290819],
  ["FE024", "คลังพัสดุ", "หลัง", "เคมีแห้ง", "15 ปอนด์", 18.307258, 100.290538],
  ["FE025", "ในคลังยา", "หลัง", "เคมีแห้ง", "15 ปอนด์", 18.307404, 100.290676],
  ["FE026", "โรงไฟฟ้า", "หลัง", "เคมีแห้ง", "15 ปอนด์", 18.30784, 100.290303],
  ["FE027", "ศูนย์ช่าง", "หลัง", "เคมีแห้ง", "15 ปอนด์", 18.307655, 100.29028],
  ["FE028", "แฟลตใหม่ ชั้น 1", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.30733, 100.290233],
  ["FE029", "แฟลตใหม่ ชั้น 2", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307297, 100.290254],
  ["FE030", "แฟลตใหม่ ชั้น 3", "บ้านพัก", "เคมีแห้ง", "15 ปอนด์", 18.307345, 100.29023],
  ["FE031", "โรงขยะ", "หลัง", "เคมีแห้ง", "15 ปอนด์", 18.307294, 100.289905],
  ["FE032", "Ward ชั้น 1 หน้าห้องพิเศษ 3", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306771, 100.290506],
  ["FE033", "Ward ชั้น 1 เตียง 17", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306861, 100.290627],
  ["FE034", "Ward ชั้น 1 ทางขึ้นชั้น 2", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306894, 100.290617],
  ["FE035", "Ward ชั้น 2 หน้าบันได", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.307032, 100.29073],
  ["FE036", "Ward ชั้น 2 หน้าห้องพิเศษ 5", "กลาง", "เคมีแห้ง", "15 ปอนด์", 18.306753, 100.290537],
  ["FE037", "ตึกพงษ์พิสุทธิ์ หน้าห้องตรวจสุขภาพ", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306324, 100.290798],
  ["FE038", "ER ประตูหน้า (ซ้าย)", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306148, 100.290904],
  ["FE039", "ER ประตูหน้า (ขวา)", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.30621, 100.290883],
  ["FE040", "OPD ประตูเข้า OPD ด้านหน้า", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306427, 100.291176],
  ["FE041", "OPD ในห้องยานอก", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306433, 100.291181],
  ["FE042", "OPD ประตูห้องยานอกด้านใน", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306444, 100.291163],
  ["FE043", "OPD ห้องกินข้าวพยาบาล", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306455, 100.290983],
  ["FE044", "OPD ห้องคุมไฟชั้น 1", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306445, 100.290998],
  ["FE045", "OPD หน้าลิฟท์ชั้น 1", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306453, 100.291002],
  ["FE046", "OPD เสาจุดวัดความดัน", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306436, 100.29114],
  ["FE047", "OPD ในห้องเวชระเบียน", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306369, 100.291018],
  ["FE048", "ตึก OPD ชั้น 2 ในห้องประชุมใหญ่", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306428, 100.290966],
  ["FE049", "ตึก OPD ชั้น 2 หน้าห้องประชุมเล็ก", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306486, 100.291077],
  ["FE050", "ตึก OPD ชั้น 2 หน้าห้องการเงิน", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.30649, 100.291229],
  ["FE051", "ตึก OPD ชั้น 2 ในห้อง ผอ.", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306461, 100.291139],
  ["FE052", "ตึก OPD ชั้น 2 ห้องคุณภาพ", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306435, 100.290997],
  ["FE053", "ตึก OPD ชั้น 2 ห้องอาหาร", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306457, 100.291024],
  ["FE054", "ตึก OPD ชั้น 2 ตู้คุมไฟ", "หน้า", "เคมีแห้ง", "15 ปอนด์", 18.306431, 100.290963]
];

/* ================= เมนู ================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('FireCheck')
    .addItem('1) ตั้งค่าเริ่มต้น / อัปเกรดชีตเป็น v' + APP_VERSION, 'setup')
    .addItem('2) ทดสอบ Gemini กับรูปบัตรล่าสุด', 'testGemini')
    .addItem('3) ติดตั้งการทำงานอัตโนมัติ (Trigger)', 'installTriggers')
    .addItem('4) ดู Webhook URL สำหรับ LINE OA', 'showLineSetup')
    .addSeparator()
    .addItem('เพิ่มช่างผู้ตรวจ / ออก PIN ใหม่', 'addStaffPrompt')
    .addItem('เพิ่มผู้ดูแล Dashboard (Gmail)', 'addAdminPrompt')
    .addItem('อ่านรูปที่ค้างอยู่ตอนนี้', 'processNewInspections')
    .addItem('ส่งอีเมลสรุปถึงทีม ENV ตอนนี้', 'sendDigestNow')
    .addItem('สร้างรอบตรวจเพิ่มอีก 4 รอบ', 'extendRounds')
    .addToUi();
}

/* ================= ตั้งค่าเริ่มต้น / อัปเกรด ================= */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('PIN_SALT')) props.setProperty('PIN_SALT', Utilities.getUuid());
  if (!props.getProperty('LINE_WEBHOOK_KEY')) props.setProperty('LINE_WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, ''));

  Object.keys(HEAD).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    ensureHeaders_(sh, HEAD[name]);
  });
  // เก็บคอลัมน์วันที่เป็นข้อความ เพื่อไม่ให้ Sheets แปลงรูปแบบเอง
  textCols_(SH.AI, ['First_Seen_At', 'Read_At', 'Claimed_At']);
  textCols_(SH.INSP, ['Captured_At', 'Sent_At', 'Row_ID']);
  textCols_(SH.REV, ['Reviewed_At']);
  textCols_(SH.SPOT, ['Selected_At', 'Checked_At']);
  textCols_(SH.ROUNDS, ['Inspect_Start', 'Inspect_End', 'Submit_By']);
  textCols_(SH.DEV, ['Login_At', 'Expires_At', 'Last_Seen_At']);

  const setSh = sheet_(SH.SET);
  const haveKeys = readObjects_(SH.SET).map(function (r) { return String(r.Key).trim(); });
  const missing = DEFAULT_SETTINGS.filter(function (r) { return haveKeys.indexOf(r[0]) < 0; });
  if (missing.length) setSh.getRange(setSh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);

  const tankSh = sheet_(SH.TANKS);
  if (tankSh.getLastRow() < 2) {
    tankSh.getRange(2, 1, SEED_TANKS.length, HEAD.Tanks.length).setValues(SEED_TANKS.map(function (t) {
      return [t[0], t[1], t[2], t[3], t[4], t[5], t[6], 'FIRECHECK:' + t[0], true, ''];
    }));
  }
  const roundSh = sheet_(SH.ROUNDS);
  if (roundSh.getLastRow() < 2) {
    const st = getSettings_();
    const rounds = generateRounds('2026-09-01', 8, st);
    roundSh.getRange(2, 1, rounds.length, HEAD.Rounds.length).setValues(rounds.map(function (r, i) {
      return [r.id, r.label, r.inspectStart, r.inspectEnd, r.submitBy, i === 0 ? 'รอบแรกของระบบบัตรเช็ค ปรับวันได้ในแถวนี้' : ''];
    }));
  }
  // ผู้ดูแลคนแรก = เจ้าของสคริปต์
  if (!readObjects_(SH.ADM).length) {
    const me = Session.getEffectiveUser().getEmail();
    if (me) appendObjects_(SH.ADM, [{ Email: me.toLowerCase(), Name: me.split('@')[0], Role: 'ADMIN', Active: true, Created_At: nowIso_() }]);
  }
  photoFolder_();
  protectSheets_();
  log_('INFO', 'setup v' + APP_VERSION + ' เสร็จ');
  SpreadsheetApp.getUi().alert('ตั้งค่า FireCheck v' + APP_VERSION + ' เสร็จแล้ว\n\nขั้นต่อไป:\n' +
    '• Script Properties: ใส่ GEMINI_API_KEY และ LINE_CHANNEL_ACCESS_TOKEN\n' +
    '• Deploy เป็น Web app (Execute as: Me · Who has access: Anyone)\n' +
    '• เมนู FireCheck > 4) ดู Webhook URL แล้วนำไปใส่ใน LINE Developers\n' +
    '• เมนู เพิ่มช่างผู้ตรวจ เพื่อออก PIN ให้ช่าง\n' +
    '• ชีต Admins: เพิ่ม Gmail ทีม ENV ที่เข้า Dashboard');
}

/** เพิ่มหัวคอลัมน์ที่ยังไม่มี (ต่อท้าย) — ใช้ได้ทั้งชีตใหม่และชีตเดิมจาก v1 */
function ensureHeaders_(sh, head) {
  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8eef5');
    sh.setFrozenRows(1);
    return;
  }
  const cur = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const add = head.filter(function (h) { return cur.indexOf(h) < 0; });
  if (add.length) {
    sh.getRange(1, cur.length + 1, 1, add.length).setValues([add]).setFontWeight('bold').setBackground('#e8eef5');
  }
}
function textCols_(name, cols) {
  const head = headOf_(name);
  cols.forEach(function (c) {
    const i = head.indexOf(c);
    if (i >= 0) sheet_(name).getRange(2, i + 1, 2000, 1).setNumberFormat('@');
  });
}

/** โฟลเดอร์เก็บรูปจาก LINE (อยู่ข้างไฟล์ Sheet) */
function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const file = DriveApp.getFileById(ss_().getId());
  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder('FireCheck_LINE_Photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/** ล็อกชีตที่ระบบเขียนเอง ให้แก้ได้เฉพาะเจ้าของ */
function protectSheets_() {
  [SH.AI, SH.REV, SH.SPOT, SH.STAFF, SH.DEV, SH.ADM, SH.LOG, SH.INSP].forEach(function (name) {
    const sh = sheet_(name);
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
    const p = sh.protect().setDescription('FireCheck: ระบบเขียนเอง');
    try {
      p.addEditor(Session.getEffectiveUser());
      p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== Session.getEffectiveUser().getEmail(); }));
      if (p.canDomainEdit()) p.setDomainEdit(false);
    } catch (e) { p.setWarningOnly(true); }
  });
}

function extendRounds() {
  const rounds = loadRounds_();
  const st = getSettings_();
  const last = rounds[rounds.length - 1];
  const from = last ? addDays(last.inspectStart.slice(0, 8) + '28', 7) : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-01');
  const next = generateRounds(from.slice(0, 8) + '01', 4, st).filter(function (r) { return !rounds.some(function (x) { return x.id === r.id; }); });
  if (!next.length) return;
  appendObjects_(SH.ROUNDS, next.map(function (r) {
    return { Round_ID: r.id, Label: r.label, Inspect_Start: r.inspectStart, Inspect_End: r.inspectEnd, Submit_By: r.submitBy, Note: '' };
  }));
}

function installTriggers() {
  const handlers = ['processNewInspections', 'dailyDigest'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processNewInspections').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(7).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  SpreadsheetApp.getUi().alert('ติดตั้งแล้ว: อ่านรูปที่ค้างทุก 10 นาที และส่งสรุปถึงทีม ENV ทุกวันประมาณ 07:30 น.');
}

function showLineSetup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const url = ScriptApp.getService().getUrl();
  if (!url) { ui.alert('ยังไม่ได้ Deploy เป็น Web app\nDeploy > New deployment > Web app (Execute as: Me · Anyone) แล้วกลับมาเปิดเมนูนี้ใหม่'); return; }
  const exec = url.replace(/\/dev$/, '/exec');
  ui.alert('ตั้งค่า LINE OA',
    'Webhook URL (ใส่ใน LINE Developers > Messaging API > Webhook settings แล้วเปิด Use webhook):\n\n' +
    exec + '?key=' + props.getProperty('LINE_WEBHOOK_KEY') +
    '\n\nAPI URL สำหรับ Dashboard (ใส่ในไฟล์ docs/config.js บน GitHub):\n\n' + exec +
    '\n\nLINE_CHANNEL_ACCESS_TOKEN: ' + (props.getProperty('LINE_CHANNEL_ACCESS_TOKEN') ? 'ใส่แล้ว' : 'ยังไม่ได้ใส่') +
    '\nGEMINI_API_KEY: ' + (props.getProperty('GEMINI_API_KEY') ? 'ใส่แล้ว' : 'ยังไม่ได้ใส่'),
    ui.ButtonSet.OK);
}

/* ================= ช่าง (PIN) และผู้ดูแล (Gmail) ================= */

function hashPin_(pin) {
  const salt = PropertiesService.getScriptProperties().getProperty('PIN_SALT') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(pin), Utilities.Charset.UTF_8);
  return hex_(bytes);
}
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

/** สุ่ม PIN 6 หลักที่ไม่ซ้ำกับช่างคนอื่น */
function newUniquePin_(exceptStaffId) {
  const used = {};
  readObjects_(SH.STAFF).forEach(function (s) { if (String(s.Staff_ID) !== String(exceptStaffId)) used[String(s.PIN_Hash)] = true; });
  for (let n = 0; n < 50; n++) {
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    if (/^(\d)\1+$/.test(pin) || pin === '123456') continue;
    if (!used[hashPin_(pin)]) return pin;
  }
  throw new Error('สุ่ม PIN ไม่สำเร็จ ลองใหม่');
}

/** เพิ่มช่างหรือออก PIN ใหม่ คืน { staffId, name, pin } */
function staffUpsert_(name, staffId) {
  name = String(name || '').trim();
  if (!name) throw new Error('ใส่ชื่อช่าง');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const list = readObjects_(SH.STAFF);
    let s = staffId ? list.filter(function (x) { return String(x.Staff_ID) === String(staffId); })[0]
      : list.filter(function (x) { return String(x.Name).trim() === name; })[0];
    const pin = newUniquePin_(s ? s.Staff_ID : '');
    if (s) {
      s.Name = name; s.PIN_Hash = hashPin_(pin); s.Active = true;
      writeObject_(SH.STAFF, s._row, s);
      logoutStaffDevices_(s.Staff_ID);
    } else {
      s = { Staff_ID: 'S' + Utilities.getUuid().slice(0, 6).toUpperCase(), Name: name, PIN_Hash: hashPin_(pin), Active: true, Created_At: nowIso_(), Note: '' };
      appendObjects_(SH.STAFF, [s]);
    }
    return { staffId: String(s.Staff_ID), name: name, pin: pin };
  } finally {
    lock.releaseLock();
  }
}

function addStaffPrompt() {
  const ui = SpreadsheetApp.getUi();
  const n = ui.prompt('เพิ่มช่างผู้ตรวจ / ออก PIN ใหม่', 'ชื่อช่าง (ถ้ามีชื่อนี้อยู่แล้ว ระบบจะออก PIN ใหม่และให้ทุกเครื่องเข้าสู่ระบบใหม่)', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK || !n.getResponseText().trim()) return;
  const r = staffUpsert_(n.getResponseText());
  ui.alert('PIN ของ ' + r.name + ' คือ  ' + r.pin + '\n\nแจ้งช่างให้เพิ่มเพื่อน LINE OA แล้วพิมพ์ PIN นี้ในแชต\n(ระบบเก็บเฉพาะค่าแฮช จะดู PIN ย้อนหลังไม่ได้)');
}

function addAdminPrompt() {
  const ui = SpreadsheetApp.getUi();
  const e = ui.prompt('เพิ่มผู้ดูแล Dashboard', 'Gmail ของผู้ดูแล', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  const email = e.getResponseText().trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.alert('อีเมลไม่ถูกต้อง'); return; }
  const n = ui.prompt('ชื่อที่แสดง', 'เช่น K.กาญจนา', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const r = ui.prompt('สิทธิ์', 'พิมพ์ ADMIN (จัดการผู้ใช้ได้), ENV (ยืนยันผล/สุ่มตรวจ) หรือ VIEW (ดูอย่างเดียว)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  adminUpsert_(email, n.getResponseText().trim() || email, r.getResponseText(), true);
  ui.alert('บันทึกแล้ว: ' + email);
}

function adminUpsert_(email, name, role, active) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('อีเมลไม่ถูกต้อง');
  role = String(role || 'ENV').trim().toUpperCase();
  if (['ADMIN', 'ENV', 'VIEW'].indexOf(role) < 0) role = 'ENV';
  const ex = readObjects_(SH.ADM).filter(function (a) { return String(a.Email).trim().toLowerCase() === email; })[0];
  const obj = { Email: email, Name: String(name || email).trim(), Role: role, Active: active !== false, Created_At: ex ? ex.Created_At : nowIso_() };
  if (ex) writeObject_(SH.ADM, ex._row, obj); else appendObjects_(SH.ADM, [obj]);
}

/* ================= อ่าน/เขียนชีต ================= */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('ไม่พบชีต ' + name + ' — รันเมนู FireCheck > ตั้งค่าเริ่มต้น');
  return s;
}
/** หัวคอลัมน์จริงของชีต (รองรับชีตเดิมที่เพิ่มคอลัมน์ต่อท้าย) */
function headOf_(name) {
  const s = sheet_(name);
  const n = s.getLastColumn();
  return n ? s.getRange(1, 1, 1, n).getValues()[0].map(String) : HEAD[name].slice();
}
function readObjects_(name) {
  const s = sheet_(name);
  const last = s.getLastRow();
  if (last < 2) return [];
  const values = s.getRange(1, 1, last, s.getLastColumn()).getValues();
  const head = values.shift().map(String);
  const out = [];
  values.forEach(function (r, i) {
    if (!r.some(function (c) { return c !== '' && c !== null; })) return;
    const o = { _row: i + 2 };
    head.forEach(function (h, j) { if (h) o[h] = r[j]; });
    out.push(o);
  });
  return out;
}
function rowOf_(head, o) { return head.map(function (k) { return !k || o[k] === undefined || o[k] === null ? '' : o[k]; }); }
/** เพิ่มแถว คืนเลขแถวแรกที่เขียน */
function appendObjects_(name, objs) {
  if (!objs.length) return 0;
  const s = sheet_(name), h = headOf_(name);
  const start = s.getLastRow() + 1;
  s.getRange(start, 1, objs.length, h.length).setValues(objs.map(function (o) { return rowOf_(h, o); }));
  return start;
}
function writeObject_(name, rowIndex, obj) {
  const s = sheet_(name), h = headOf_(name);
  const cur = s.getRange(rowIndex, 1, 1, h.length).getValues()[0];
  const row = h.map(function (k, j) { return !k || obj[k] === undefined ? cur[j] : (obj[k] === null ? '' : obj[k]); });
  s.getRange(rowIndex, 1, 1, h.length).setValues([row]);
}
/** เขียนเฉพาะบางเซลล์ของแถว */
function setCells_(name, rowIndex, fields) {
  const s = sheet_(name), h = headOf_(name);
  Object.keys(fields).forEach(function (k) {
    const j = h.indexOf(k);
    if (j >= 0) s.getRange(rowIndex, j + 1).setValue(fields[k] === null || fields[k] === undefined ? '' : fields[k]);
  });
}
function findRow_(name, key, value) {
  return readObjects_(name).filter(function (o) { return String(o[key]) === String(value); })[0] || null;
}

function getSettings_() {
  const o = {};
  DEFAULT_SETTINGS.forEach(function (r) { o[r[0]] = r[1]; });
  try {
    readObjects_(SH.SET).forEach(function (r) { if (r.Key) o[String(r.Key).trim()] = String(r.Value).trim(); });
  } catch (e) { /* ยังไม่มีชีต Settings */ }
  o.ROUND_MONTHS = String(o.ROUND_MONTHS).split(/[,\s]+/).map(Number).filter(Boolean);
  ['INSPECT_START_DAY', 'INSPECT_END_DAY', 'SUBMIT_GRACE_DAYS', 'CONFIDENCE_MIN', 'SPEED_MAX_MPS', 'SPEED_MIN_DIST_M', 'SPOT_CHECK_COUNT', 'LINE_SESSION_HOURS']
    .forEach(function (k) { o[k] = Number(o[k]); });
  o.CARD_COLUMNS = String(o.CARD_COLUMNS).split('|').map(function (s) { return s.trim(); }).filter(Boolean);
  ['IMMEDIATE_ALERT', 'LINE_PUSH_RESULT', 'LINE_NOTIFY_RETAKE'].forEach(function (k) { o[k] = String(o[k]).toUpperCase() === 'TRUE'; });
  return o;
}

function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function isoFromMs_(ms) { return Utilities.formatDate(new Date(ms), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function isoPlusHours_(h) { return isoFromMs_(Date.now() + h * 3600 * 1000); }

/** ค่าในเซลล์ → 'yyyy-MM-ddTHH:mm:ss' */
function isoOf_(v, order) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return parseDateTime(v, order);
}

function log_(level, msg) {
  try { appendObjects_(SH.LOG, [{ Time: nowIso_(), Level: level, Message: String(msg).slice(0, 4000) }]); } catch (e) { console.log(level, msg); }
}

/* ================= โหลดข้อมูลเป็นรูปแบบกลาง ================= */

function loadRounds_() {
  const st = getSettings_();
  return readObjects_(SH.ROUNDS).filter(function (r) { return r.Round_ID; }).map(function (r) {
    return {
      id: String(r.Round_ID), label: String(r.Label),
      inspectStart: isoOf_(r.Inspect_Start, st.DATE_ORDER).slice(0, 10),
      inspectEnd: isoOf_(r.Inspect_End, st.DATE_ORDER).slice(0, 10),
      submitBy: isoOf_(r.Submit_By, st.DATE_ORDER).slice(0, 10),
      note: String(r.Note || '')
    };
  }).sort(function (a, b) { return a.inspectStart < b.inspectStart ? -1 : 1; });
}

function loadTanks_() {
  return readObjects_(SH.TANKS).filter(function (t) { return t.Device_ID; }).map(function (t) {
    return {
      id: String(t.Device_ID).trim().toUpperCase(), loc: String(t.Location), zone: String(t.Zone),
      type: String(t.Type), size: String(t.Size), lat: Number(t.Ref_Lat), lng: Number(t.Ref_Lng),
      active: !(t.Active === false || String(t.Active).toUpperCase() === 'FALSE')
    };
  });
}

function splitFlags_(s) { return String(s || '').split(' | ').map(function (x) { return x.trim(); }).filter(Boolean); }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function loadRaw_() {
  const st = getSettings_();
  const insp = {};
  readObjects_(SH.INSP).forEach(function (i) { if (i.Row_ID) insp[String(i.Row_ID)] = i; });
  const records = readObjects_(SH.AI).filter(function (a) {
    return a.Row_ID && insp[String(a.Row_ID)] && String(a.Status) !== 'CANCELLED';
  }).map(function (a) {
    const i = insp[String(a.Row_ID)];
    const items = {};
    Object.keys(ITEM_COLS).forEach(function (k) { items[k] = String(a[ITEM_COLS[k]] || ''); });
    return {
      rowId: String(a.Row_ID), device: String(a.Device_ID || ''), roundId: String(a.Round_ID || ''),
      capturedIso: isoOf_(i.Captured_At, st.DATE_ORDER), firstSeenIso: isoOf_(a.First_Seen_At, st.DATE_ORDER),
      inspector: String(i.Inspector || ''), note: String(i.Note || ''), cardPhoto: String(i.Card_Photo || ''), defectPhoto: String(i.Defect_Photo || ''),
      source: String(i.Source || 'APPSHEET'), timeSource: String(i.Time_Source || 'APP'),
      status: String(a.Status || ''), error: String(a.Error || ''), tankRead: String(a.Tank_ID_Read || ''), corners: Number(a.Corners || 0),
      found: String(a.Found || ''), items: items, writtenDate: String(a.Written_Date || ''),
      signed: isTrue_(a.Signed), confidence: Number(a.Confidence || 0), remark: String(a.Remark || ''),
      aiResult: String(a.AI_Result || ''), flags: splitFlags_(a.Flags), crossFlags: splitFlags_(a.Cross_Flags),
      inspectTiming: String(a.Inspect_Timing || ''), submitTiming: String(a.Submit_Timing || ''),
      reviewNeeded: String(a.Review_Needed).toUpperCase() === 'YES', photoId: String(a.Photo_File_ID || '')
    };
  });
  const reviews = readObjects_(SH.REV).filter(function (r) { return r.Row_ID; }).map(function (r) {
    const items = {};
    Object.keys(ITEM_COLS).forEach(function (k) { items[k] = String(r[ITEM_COLS[k]] || ''); });
    return {
      reviewId: String(r.Review_ID), rowId: String(r.Row_ID), device: String(r.Device_ID), reviewer: String(r.Reviewer),
      reviewedIso: isoOf_(r.Reviewed_At, st.DATE_ORDER), decision: String(r.Decision), found: String(r.Found || ''), items: items,
      finalResult: String(r.Final_Result || ''), note: String(r.Note || '')
    };
  });
  const spots = readObjects_(SH.SPOT).filter(function (s) { return s.Spot_ID; }).map(function (s) {
    return {
      spotId: String(s.Spot_ID), roundId: String(s.Round_ID), device: String(s.Device_ID),
      selectedIso: isoOf_(s.Selected_At, st.DATE_ORDER), selectedBy: String(s.Selected_By || ''), checker: String(s.Checker || ''),
      checkedIso: s.Checked_At ? isoOf_(s.Checked_At, st.DATE_ORDER) : '', match: String(s.Match || ''), note: String(s.Note || ''), _row: s._row
    };
  });
  return { tanks: loadTanks_(), rounds: loadRounds_(), records: records, reviews: reviews, spots: spots, settings: st };
}
