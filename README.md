# رفوف | Rufoof

تطبيق مفتوح المصدر لإدارة المخزون باستخدام ملفات Google Sheets الخاصة بك. يدعم العربية والإنجليزية، والحركات والجرد، والحقول المخصصة، وتثبيته كتطبيق ويب.

Open-source inventory management using your own Google Sheets, with Arabic and English, stock movements, stock counts, custom fields, and an installable web app.

**© Subul Technology / سبل للتكنولوجيا — Rafuf (Rufoof).**

## النسبة وإعادة الاستخدام | Attribution and reuse

هذا المشروع مفتوح المصدر ومرخّص بموجب MIT. عند إعادة نشره أو تعديل أجزاء جوهرية منه، يجب إبقاء ملفي `LICENSE` و`NOTICE` وإشعار حقوق النشر، ويُطلب إبقاء نسبة واضحة إلى **AbdulRasol Al-Hilo / Subul Technology** مع الإشارة إلى أن المشروع الأصلي هو **Rafuf (Rufoof)**. تم بناء المشروع بمساعدة أدوات الذكاء الاصطناعي وتحت توجيه ومراجعة المطوّر.

This project is open source under the MIT License. When redistributing it or publishing a substantial derivative, retain `LICENSE`, `NOTICE`, and the copyright notice. Please provide clear attribution to **AbdulRasol Al-Hilo / Subul Technology** and identify the original project as **Rafuf (Rufoof)**.

## Data ownership and plans

المستخدم يملك بياناته وملفات Google Sheets الخاصة به. Rafuf لا يطّلع على محتوى الجداول ولا ينسخها إلى خوادم SubulTech؛ يتعامل المتصفح معها مباشرة عبر Google وبصلاحية `drive.file`. تُستخدم هوية SubulTech فقط للحساب، تفعيل التطبيق، حفظ مرجع الملف، والإحصاءات التشغيلية غير المتعلقة بمحتوى المخزون.

The user owns their inventory and Google Sheets files. Rafuf does not inspect or copy spreadsheet contents to SubulTech servers; the browser accesses them directly through Google with the limited `drive.file` scope. SubulTech Identity is used for account identity, app activation, workbook reference, and operational usage metrics—not inventory contents.

الخطة المجانية مناسبة لسجل واحد وحدود الاستخدام الأساسية. يمكن لاحقاً تفعيل خطة مدفوعة لعدة سجلات، حدود أكبر، وميزات متقدمة؛ لا تُعد هذه الحدود مفعّلة في النسخة الحالية إلا إذا ظهرت في حساب SubulTech.

The free plan is intended for one ledger and basic usage. A paid plan can later provide multiple ledgers, higher limits, and advanced features; these limits are not active in this release unless shown by SubulTech.

## التشغيل | Development

يتطلب Node.js 22.12 أو أحدث ضمن الإصدار 22، أو الإصدار 24 أو 26 فما فوق، وpnpm 12.6 (المثبت في `packageManager`). | Requires Node.js 22.12+ on the 22.x line, 24.x, or 26+, and pnpm 12.6 (pinned in `packageManager`).

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
```

يُستخدم `pnpm` وحده في هذا المشروع؛ لا تشغّل npm ولا تُنشئ `package-lock.json`. | This project uses pnpm only; do not run npm or create `package-lock.json`.

انسخ `.env.example` إلى `.env.local` واضبط `VITE_GOOGLE_CLIENT_ID` و`VITE_SUBULTECH_API_BASE_URL` (الإنتاج `https://api.subultech.top`، أو `http://127.0.0.1:8788` لـ Worker محلي) و`VITE_SUBULTECH_APPLICATION_SLUG=rafuf`. | Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID`, `VITE_SUBULTECH_API_BASE_URL` (production `https://api.subultech.top`, or `http://127.0.0.1:8788` for a local Worker), and `VITE_SUBULTECH_APPLICATION_SLUG=rafuf`.

افتح العنوان الذي يظهره Vite، عادة `http://localhost:5173`. يتوفر وضع تجريبي ببيانات في الذاكرة فقط، لا يكتب إلى Google ولا يحتفظ بالتغييرات بعد إعادة التحميل.

Open the URL printed by Vite, usually `http://localhost:5173`. The demo uses in-memory data and is reset when the page is reloaded; it does not write to Google.

## الاستخدام | How to use

بعد ربط Google، أنشئ ملف مخزن أو اختر ملفاً متاحاً للتطبيق. أضف المادة ورصيدها الافتتاحي، ثم سجّل الوارد والصادر؛ يتطلب الصرف الذي يجعل الرصيد سالباً تأكيداً. افتح بطاقة المادة لمراجعة سجلها، واستخدم الجرد لمادة واحدة في كل مرة لتسجيل الفرق كتسوية. لا يُعدّل الرصيد الافتتاحي من التطبيق بعد إنشاء المادة؛ استخدم تسوية الجرد ليبقى التغيير مسجلاً. يظهر تنبيه النقص حسب الحد الأدنى للمادة.

يمكن إضافة حقول مخصصة واختيار نوعها عند الإنشاء، وإظهارها أو إخفاؤها في الجداول والبحث في قيمها. يُحفظ خيار الإظهار محلياً ولا يحذف البيانات. تُكتشف الأعمدة المضافة في Sheets كحقول نصية، ويمكن تغيير اسم الحقل من عنوان العمود هناك ثم تحديث السجل. يمكن تغيير نوع حقل موجود بعد التحقق من مطابقة القيم؛ وعند وجود أعمدة مفقودة أو تعارض يعرض التطبيق لوحة «فحص الملف» التي تضيف عموداً اختيارياً فارغاً فقط وتطلب إصلاح الباقي يدوياً. يمكن تصفية الحركات بالتاريخ وتصدير CSV أو الطباعة من المتصفح.

After connecting Google, create a warehouse file or select an available app file. Add an item and its opening balance, then record incoming and outgoing movements; issuing stock below zero requires confirmation. Open an item to inspect its ledger, and count one item at a time to record differences as adjustments. The opening balance cannot be edited in the app after an item is created; record a stock-count adjustment instead. Low-stock alerts use each item's minimum stock.

You can create custom fields with a chosen type, show or hide their table columns, and search their values. Visibility is saved locally and does not delete data. Columns added in Sheets are discovered as text fields; rename a field through its column header in Sheets and reload. Existing field types can be changed once every non-empty value matches the new type; when columns are missing or conflicting, the Workbook check panel appends only an optional empty column and asks you to repair the rest manually. Movements can be filtered by date, exported to CSV, or printed from the browser.

## إعداد Google والهوية | Google and identity setup

1. يستخدم رفوف مشروع Google Cloud المركزي `SubulTech Identity` (`subultech-identity`) وOAuth Client ID العام المسجل هناك؛ لا تنشئ مشروعاً أو عميلاً جديداً لرفوف.
2. أضف أصل التطوير `http://localhost:5173` وأصل الإنتاج `https://rafuf.subultech.top` تحت **Authorized JavaScript origins**، دون redirect URI لأن التطبيق يستخدم تدفق Google Identity Services popup/token.
3. النطاقات المطلوبة: `openid email profile` و`https://www.googleapis.com/auth/drive.file` فقط، وفعّل Google Sheets API وGoogle Drive API.
4. اضبط المتغيرات الثلاثة في `.env.local` ثم أعد تشغيل Vite. لا تضع client secret في المتصفح أو المستودع.
5. تُصدر جلسة التطبيق من `https://api.subultech.top` عبر `/v1/auth/google` بمعرّف التطبيق الثابت `rafuf`. يتطلب ذلك أن يسمح Worker الخاص بـ SubulTech بأصل التطبيق في CORS (`https://rafuf.subultech.top` و`http://localhost:5173`)؛ هذا إعداد منفصل في مشروع SubulTech، وبدونه ترفض المتصفحات الطلبات.
6. للاختبار المحلي بدون الإنتاج، شغّل Worker على `http://127.0.0.1:8788` واضبط `VITE_SUBULTECH_API_BASE_URL` عليه.

1. Rufoof uses the central `SubulTech Identity` Google Cloud project (`subultech-identity`) and its registered public OAuth client ID; do not create a new project or client for Rufoof.
2. Add `http://localhost:5173` and `https://rafuf.subultech.top` under **Authorized JavaScript origins**, with no redirect URI because the app keeps the Google Identity Services popup/token flow.
3. Request only `openid email profile` and `https://www.googleapis.com/auth/drive.file`, and enable the Google Sheets and Drive APIs.
4. Set the three variables in `.env.local` and restart Vite. Never place a client secret in the browser app or repository.
5. `https://api.subultech.top` issues the app session through `/v1/auth/google` with the fixed `rafuf` slug. The SubulTech Worker must allow the app origin in CORS (`https://rafuf.subultech.top` and `http://localhost:5173`); that is a separate change in the SubulTech project, and browsers reject the requests without it.
6. For local testing without production, run the Worker on `http://127.0.0.1:8788` and point `VITE_SUBULTECH_API_BASE_URL` at it.

### الاستضافة | Hosting

الاستضافة المقترحة Cloudflare Pages: أمر البناء `pnpm build`، ومجلد النشر `dist`، و`public/_redirects` يوفّر رجوع SPA إلى `index.html`. أضف متغيرات البيئة في إعدادات المشروع، وأضف الدومين إلى Google origins. لا يُنشر التطبيق تلقائياً.

Hosting is Cloudflare Pages: build with `pnpm build`, publish `dist`, and `public/_redirects` provides the SPA fallback to `index.html`. Set the environment variables in the project settings and add the domain to Google origins. Nothing deploys automatically.

### استكشاف الأخطاء | Troubleshooting

- إذا ظهر خطأ إعداد Google أو SubulTech، تأكد من المتغيرات الثلاثة في `.env.local` وإعادة تشغيل Vite.
- إذا رفض Google تسجيل الدخول، تحقق من تطابق أصل الصفحة (البروتوكول والنطاق والمنفذ، دون مسار) مع أحد JavaScript origins، ومن إضافة الحساب إلى مستخدمي الاختبار عندما يكون التطبيق في وضع Testing.
- إذا تعذّر الوصول إلى SubulTech، تحقق من `VITE_SUBULTECH_API_BASE_URL` ومن أن Worker يسمح بأصل التطبيق في CORS.
- إذا انتهت الجلسة أثناء العمل، أعد الاتصال من التطبيق؛ لا تكرر حفظ حركة إذا كانت نتيجة الكتابة السابقة غير مؤكدة قبل التحقق من السجل.
- إذا أبلغ التطبيق عن خلل في بنية الملف أو بياناته، استخدم لوحة «فحص الملف» للعمود الاختياري المفقود فقط، وأصلح الأعمدة المطلوبة أو التعارضات والصفوف غير الصالحة في Google Sheets ثم أعد التحميل. وإذا كانت نتيجة كتابة بيانات تعريف الأعمدة غير مؤكدة، افحصها قبل إعادة المحاولة لتجنب تكرارها.

- If a Google or SubulTech setup error appears, check the three variables in `.env.local` and restart Vite.
- If Google rejects sign-in, check the exact JavaScript origin and add the account as a test user while the OAuth app is in Testing mode.
- If SubulTech is unreachable, check `VITE_SUBULTECH_API_BASE_URL` and confirm the Worker allows the app origin in CORS.
- If the session expires, reconnect in the app; inspect the ledger before repeating a movement whose save result is uncertain.
- If the app reports invalid workbook structure or data, use the Workbook check panel only for a missing optional column, and repair required columns, conflicts, or invalid rows in Google Sheets before reloading. If a column-metadata write has an uncertain outcome, inspect it before retrying to avoid duplicates.

## الخصوصية والحدود | Privacy and limits

- يطلب التطبيق `drive.file` لقراءة وتعديل الملفات المتاحة له، وليس صلاحية قراءة جميع ملفات Drive. يستخدم نطاقات الهوية للتعرف على الحساب؛ رمز الوصول يبقى في الذاكرة وقد تحتاج إعادة الاتصال عند انتهائه.
- جلسة SubulTech (رمز الوصول ورمز التجديد) تبقى في الذاكرة فقط وتُمسح عند الخروج أو إعادة تحميل الصفحة؛ لا تُحفظ في التخزين الدائم. معرّف التطبيق ثابت `rafuf` ولا يتحكم به المستخدم. تظهر حالة الحساب وخطة رفوف في الإعدادات.
- يمكن حفظ لقطة للقراءة دون اتصال على الجهاز؛ هذه البيانات المحلية غير مشفرة، ويمكن مسحها من التطبيق. لا تسجل الحركات دون اتصال.
- Google Sheets ليس قاعدة بيانات معاملات؛ قد تحدث تعارضات عند تعديل الملف من عدة أجهزة أو مباشرة في Sheets. سجل الحركات قابل للتعديل ممن يملك صلاحية الوصول إلى الملف.
- تنبيهات النقص تعتمد على الحد الأدنى للمادة؛ لا توجد قواعد تنبيه عامة قابلة للتخصيص.
- لم يُختبر الربط بحساب Google حقيقي أو تبادل SubulTech أو تثبيت PWA على جهاز فعلي بعد. إعداد Cloudflare Pages للاستضافة الاختيارية ولا ينشر التطبيق تلقائياً.

- The app requests `drive.file` to read and modify files available to the app, not full access to Drive. Identity scopes identify the account. Access tokens stay in memory; reconnecting may be necessary when they expire.
- The SubulTech session (access and refresh tokens) stays in memory only and is cleared on sign-out or reload; it is never written to persistent storage. The `rafuf` application slug is fixed and not user-controlled. Settings shows the account and Rufoof plan status.
- A local read-only snapshot may be stored unencrypted on the device and can be cleared in the app. Offline writes are disabled.
- Google Sheets is not a transactional database. Concurrent or direct sheet edits can conflict; anyone with access to the file can modify its movement history.
- Low-stock alerts use each item's minimum stock; arbitrary configurable alert rules are not available.
- A real Google account connection, the SubulTech exchange, and PWA installation on a device have not yet been tested. Cloudflare Pages configuration is for optional hosting and does not deploy automatically.

## المساهمة والترخيص | Contributing and license

شغّل اختبارات وبناء المشروع قبل المساهمة، واتبع تعليمات `AGENTS.md` عند استخدام الوكلاء. المشروع مرخص بموجب MIT؛ راجع `LICENSE`.

Run tests and build before contributing. Follow `AGENTS.md` when using coding agents. Licensed under MIT; see `LICENSE`.

للاستخدامات العامة وإعادة التوزيع، احتفظ بإشعار النسبة الموجود في `NOTICE`.

For redistribution and public reuse, preserve the attribution notice in `NOTICE`.
