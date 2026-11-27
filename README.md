# StoryLoop: منصة فيديوهات الأطفال بالذكاء الاصطناعي

## المشمول
- `schema.sql`: جداول Turso (المفاتيح، القصص، المشاهد، المكتبة، سجل النشر)
- `lib/keyManager.js`: التبديل التلقائي بين المفاتيح (limit/quota/auth/شبكة) من غير ما التوليد يقف
- `lib/agnes.js`: نص + صورة + فيديو (create ثم polling بنفس المفتاح)
- `worker/daily.js`: قصة ← 8 مشاهد ← صور ← تحريك (قابل للاستئناف)
- `.github/workflows/daily.yml`: تشغيل يومي 08:00 بتوقيت القاهرة

## التشغيل لأول مرة
1. أنشئ قاعدة في https://app.turso.tech وخد `Database URL` + `Auth Token`
2. `cp .env.example .env` واملأها، وولّد `ENCRYPTION_KEY` بـ `openssl rand -hex 32`
3. `npm install && npm run migrate`
4. ضيف المفاتيح (مفتاح في كل سطر): `node scripts/add-keys.js agnes < keys.txt`
5. `npm run smoke` يطبع الـ raw response: **راجع أسماء الحقول** (خصوصاً حقل الصورة في الفيديو) وعدّل `lib/agnes.js` لو لزم
6. `npm run daily`
7. على GitHub: Settings → Secrets → أضف `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ENCRYPTION_KEY`

## الجاي
- لوحة تحكم Next.js على Vercel (خانة إضافة مفاتيح متعددة + حالة كل مفتاح + المكتبة)
- رفع الملفات لـ Cloudflare R2 (روابط Agnes ممكن تنتهي)
- TTS عربي (Edge TTS) + تجميع ffmpeg → final.mp4
- النشر على YouTube Shorts / TikTok

## المرحلة 5 (جديد): الصوت والتجميع
- `worker/finish.js`: تعليق صوتي عربي بـ Edge TTS (`ar-EG-SalmaNeural`) لكل مشهد، وبعدين ffmpeg يدمج ويجمّع → `final.mp4` (1080×1920)
- الأمر: `npm run finish` (محتاج `ffmpeg` و`pip install edge-tts`)
- الـ workflow بيرفع الفيديوهات كـ Artifact مؤقت (7 أيام) لحد ما نربط التخزين الدائم والنشر

## لوحة التحكم (Vercel)
- Next.js في `app/`. تدخل بكلمة سر `ADMIN_PASSWORD`.
- لمبات حالة الربط (Turso / التشفير / مفاتيح Agnes) + إضافة مفاتيح متعددة + اختبار الاتصال + إيقاف/تفعيل/مسح كل مفتاح.
- متغيرات Vercel المطلوبة (مرة واحدة): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD`.
