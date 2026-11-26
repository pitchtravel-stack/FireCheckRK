# FireCheck v2 — ตรวจถังดับเพลิงด้วยบัตรเช็ค + AI ผ่าน LINE OA

ช่างถ่ายรูปบัตรเช็คที่ถัง แล้วส่งในแชต LINE OA ระบบใช้ Gemini อ่านบัตรและตอบผลกลับทันที ทีม ENV ดูผล ยืนยัน และสุ่มตรวจซ้ำผ่าน Dashboard บน GitHub Pages

```
ช่าง ──LINE OA──▶ Apps Script (Web app) ──▶ Google Sheet + Drive (รูป)
  ▲  PIN 6 หลัก/เครื่อง      │  Gemini อ่านบัตร
  └──── ตอบผลทันที ◀──────────┘
ทีม ENV ──GitHub Pages (docs/)──▶ Apps Script API  (Gmail + OTP ทางอีเมล)
```

| ผู้ใช้ | เข้าใช้งานอย่างไร |
|---|---|
| ช่างผู้ตรวจ | เพิ่มเพื่อน LINE OA → พิมพ์ PIN 6 หลักครั้งแรกบนเครื่องที่ใช้ → ส่งรูปบัตร |
| ทีม ENV / ผู้บริหาร | เปิด Dashboard → กรอก Gmail → ใส่รหัส OTP ที่ได้ทางอีเมล |

## โครงสร้าง

```
gas/            โค้ด Apps Script (ผูกกับ Google Sheet)
  Config.gs     ชีต เมนู ตั้งค่า ตัวช่วยอ่าน/เขียน  (APP_VERSION อยู่ที่นี่)
  Rules.gs      กฎล้วน: รอบตรวจ ตรงเวลา แปลผลบัตร ธง คำสั่ง LINE อ่าน EXIF
  AI.gs         เรียก Gemini, trigger อ่านรูปที่ค้างทุก 10 นาที
  Line.gs       LINE webhook: PIN, รับรูป, คำสั่ง, ตอบผล
  Api.gs        doGet/doPost: แยก LINE กับ API ของ Dashboard, Gmail + OTP
  Model.gs      รวมข้อมูลเป็นภาพรวม Dashboard
  Alerts.gs     อีเมลสรุปรายวันถึงทีม ENV
docs/           Dashboard (GitHub Pages) — index.html + config.js
test/           ทดสอบด้วย node (มีตัวจำลองบริการ Google สำหรับ flow LINE/API)
```

## ติดตั้ง

### 1) LINE OA
1. [LINE Developers](https://developers.line.biz/console/) → สร้าง Provider → สร้าง **Messaging API channel** (จะได้ LINE OA มาด้วย)
2. แท็บ Messaging API → **Channel access token (long-lived)** → Issue แล้วคัดลอกไว้
3. [LINE OA Manager](https://manager.line.biz/) → ตั้งค่าการตอบกลับ: ปิด **ข้อความตอบกลับอัตโนมัติ** และ **ข้อความทักทาย** · เปิด **Webhook**

### 2) Apps Script
1. เปิดไฟล์ Google Sheet ของ FireCheck → ส่วนขยาย → Apps Script
2. นำไฟล์ใน `gas/` ไปวาง (หรือใช้ `clasp push` ดูหัวข้อด้านล่าง) และ **ลบ `WebApp.gs` กับ `Dashboard.html` ของ v1 ออก**
3. Project Settings → Script Properties เพิ่ม
   - `GEMINI_API_KEY`
   - `LINE_CHANNEL_ACCESS_TOKEN`
4. กลับไปที่ Sheet → เมนู **FireCheck → 1) ตั้งค่าเริ่มต้น / อัปเกรดชีต** (อนุญาตสิทธิ์ตามที่ถาม)
5. Deploy → New deployment → Web app · **Execute as: Me** · **Who has access: Anyone**
6. เมนู **FireCheck → 4) ดู Webhook URL** → นำ URL ที่มี `?key=` ไปใส่ใน LINE Developers → Webhook URL → เปิด **Use webhook**
   (ปุ่ม Verify ของ LINE อาจขึ้น error เพราะ Apps Script ตอบแบบ redirect — ให้ทดลองส่งข้อความจริงในแชตแทน)
7. เมนู **FireCheck → 3) ติดตั้งการทำงานอัตโนมัติ**

### 3) Dashboard บน GitHub Pages
1. แก้ `docs/config.js` ใส่ API URL (ลงท้าย `/exec`) จากเมนูข้อ 4
2. GitHub → Settings → Pages → Source: **Deploy from a branch** → `main` / `/docs`
3. นำลิงก์ Pages ไปใส่ในชีต Settings ช่อง `DASHBOARD_URL` (ใช้ในอีเมลแจ้งเตือน)

GitHub Pages ฟรีต้องเป็น repo สาธารณะ — ใน repo ไม่มีรหัสลับหรือข้อมูลการตรวจ (คีย์อยู่ใน Script Properties ข้อมูลอยู่ใน Sheet) มีเพียงรายชื่อจุดติดตั้งถังใน `Config.gs`

### 4) ผู้ใช้
- **ช่าง**: Dashboard → ช่างผู้ตรวจ (LINE) → เพิ่มช่างและออก PIN (หรือเมนู FireCheck → เพิ่มช่างผู้ตรวจ) แล้วแจ้ง PIN ให้ช่าง
- **ทีม ENV**: เจ้าของสคริปต์ถูกเพิ่มเป็น ADMIN อัตโนมัติ เพิ่มคนอื่นได้ที่หน้า **ผู้ดูแล Dashboard**
  สิทธิ์: `ADMIN` จัดการผู้ใช้ · `ENV` ยืนยันผล/สุ่มตรวจ · `VIEW` ดูอย่างเดียว

## วิธีใช้สำหรับช่าง (พิมพ์ "วิธีใช้" ในแชตก็ได้)

| ส่ง/พิมพ์ | ผล |
|---|---|
| `123456` (PIN) | เข้าสู่ระบบบนเครื่องนี้ (หมดอายุเมื่อไม่ได้ใช้ 12 ชม. ปรับได้ที่ `LINE_SESSION_HOURS`, 0 = ไม่หมดอายุ) |
| รูปบัตร | AI อ่านแล้วตอบผล ส่งทีละหลายรูปได้ · ถ้ายังไม่เข้าสู่ระบบ รูปจะถูกพักไว้จนพิมพ์ PIN |
| `FE012` | ระบุ/แก้รหัสถังของรูปล่าสุด (ถ้าไม่มีรูปล่าสุด = ใช้กับรูปถัดไป) |
| `รูปชำรุด` แล้วส่งรูป | แนบรูปจุดชำรุดกับรูปล่าสุด |
| `ยกเลิก` | ยกเลิกรูปล่าสุด |
| ข้อความอื่น | หมายเหตุของรูปล่าสุด (ภายใน 30 นาที) |
| ส่งตำแหน่ง (Location) | แนบพิกัดกับรูปล่าสุด |
| `สถานะ` | ความคืบหน้ารอบนี้ และถังที่ยังไม่มีรูป |
| `ออกจากระบบ` | เมื่อใช้เครื่องร่วมกับคนอื่น |

ไม่มีเน็ตตอนตรวจ: ถ่ายรูปด้วยกล้องเก็บไว้ แล้วเลือกจากอัลบั้มส่งตอนมี Wi-Fi

## วันตรวจ และวันส่ง

- **วันส่ง** = เวลาที่ LINE ได้รับรูป
- **วันตรวจ** เลือกตามลำดับ: เวลาถ่ายใน EXIF ของรูป → วันที่ที่ช่างเขียนบนบัตร (ต้องอยู่ในเดือนของรอบและไม่เกินวันส่ง) → เวลาส่ง
  แหล่งที่ใช้เก็บในคอลัมน์ `Inspections.Time_Source` (`EXIF` / `CARD` / `SENT`) และแสดงในคิวยืนยัน
- ธง "ถ่ายเร็วเกินจริง" คิดเฉพาะรูปที่มีเวลาถ่ายจริง (EXIF) เพราะเวลาส่ง LINE ของรูปที่ส่งรวดเดียวจะติดกันเสมอ ธง "รูปซ้ำ" ยังใช้ได้ตามเดิม

## อัปเกรดจาก v1 (AppSheet)

- รันเมนู **ตั้งค่าเริ่มต้น / อัปเกรดชีต** — เพิ่มชีต `Staff`, `Line_Devices`, `Admins` และคอลัมน์ใหม่ต่อท้าย `Inspections`, `AI_Results` ข้อมูลเดิมอยู่ครบ
- ชีต `Users` (ชื่อ + PIN ของ Dashboard v1) ไม่ใช้แล้ว ลบได้
- แถวเก่าจาก AppSheet ยังอ่านและแสดงผลได้ตามเดิม เลิกใช้แอป AppSheet ได้เลย

## พัฒนาต่อ

```bash
npm test                          # ทดสอบกฎ + flow LINE/OTP ด้วยตัวจำลอง
npm i -g @google/clasp@2 && clasp login
cp .clasp.json.example .clasp.json   # ใส่ scriptId
clasp push                        # ส่งโค้ด gas/ ขึ้น Apps Script
```

แก้โค้ดแล้วต้องอัปเดต deployment เดิมให้เป็นเวอร์ชันใหม่ (Deploy → Manage deployments → Edit → Version: New version) เพื่อให้ URL เดิมใช้ต่อได้ หรือใช้ workflow `deploy-gas` (ตั้ง Secrets `CLASPRC_JSON`, `SCRIPT_ID`, `DEPLOYMENT_ID`)

ทุกครั้งที่อัปเดต ให้เพิ่มเลขเวอร์ชันทั้ง `APP_VERSION` ใน `gas/Config.gs` และ `APP_VERSION` ใน `docs/index.html` — หน้า Dashboard แสดงทั้งสองเลขที่มุมล่างของเมนูซ้าย

## ข้อจำกัดที่ควรรู้

- Apps Script อ่าน header `X-Line-Signature` ไม่ได้ จึงป้องกัน webhook ด้วย key ใน URL — อย่าเผยแพร่ Webhook URL
- ข้อความตอบกลับ (reply) ไม่นับโควตา LINE ส่วน push ใช้เฉพาะแจ้งผลรูปที่อ่านทีหลังและแจ้งขอถ่ายใหม่ ปิดได้ที่ `LINE_PUSH_RESULT` / `LINE_NOTIFY_RETAKE`
- OTP ส่งด้วย MailApp ของบัญชีเจ้าของสคริปต์ (Gmail ส่วนตัวส่งได้ประมาณ 100 ฉบับ/วัน)
- เซสชัน Dashboard อยู่ได้ 6 ชั่วโมง (ข้อจำกัดของ CacheService)
