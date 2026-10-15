# first-server

تطبيق Backend بسيط باستخدام Python وFastAPI. يُنصح باستخدام Python 3.12.

## الإعداد

نفّذ من مجلد المستودع:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## التشغيل المحلي

```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

المنفذ 8001 يتجنب التعارض مع خادم الصفحة الثابتة السابق على 8000.

| المسار | الاستجابة |
| --- | --- |
| `GET /` | `{"message": "مرحبًا بك في أول تطبيق FastAPI!"}` |
| `GET /health` | `{"status": "ok"}` |
| `GET /docs` | توثيق تفاعلي لتجربة API |

للتحقق محليًا: `curl http://127.0.0.1:8001/health`.
ملف `index.html` الأصلي محفوظ كما هو؛ التطبيق الحالي لا يقدمه تلقائيًا.

## الاختبارات

بعد تفعيل البيئة الافتراضية وتثبيت المتطلبات:

```bash
python -m pytest -q
```

تشمل المتطلبات أدوات التشغيل والاختبار. تتحقق الاختبارات من كود HTTP ومحتوى JSON للمسارين.
هذه تعليمات تطوير محلي فقط، ولا تتضمن نشرًا أو إعدادات Nginx.
