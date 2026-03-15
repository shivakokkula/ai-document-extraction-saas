# DocuParse AI — Production SaaS

AI-powered document extraction. Upload PDFs (invoices, receipts, bank statements) → get structured JSON via OCR + Gemini.

---

## Deployment Stack

| What | Where | Cost |
|------|-------|------|
| Frontend (Next.js 14) | Vercel | Free |
| Backend API (NestJS) | Render | $7/mo |
| AI Service (FastAPI) | Render | $7/mo |
| PostgreSQL | Neon | Free |
| Redis + Job Queue | Upstash | Free |
| File Storage | AWS S3 | ~$1/mo |
| Payments | Stripe | % of revenue |
| Email | SendGrid | Free (100/day) |

**Total fixed cost: ~$15/month**

---

## Project Structure

```
ai-document-extraction-saas/
├── backend/       # NestJS — Auth, Documents, Billing, Queue
├── ai-service/    # FastAPI — OCR (Tesseract) + Claude LLM pipeline
├── frontend/      # Next.js 14 — Dashboard, Upload, Billing UI
├── render.yaml    # One-click Render deploy blueprint
└── .env.example   # Every env var documented with where to get it
```

---

## COMPLETE SETUP GUIDE

> Do these steps IN ORDER. Each step gives you values to paste into your `.env`.

---

### STEP 1 — Fork & Clone

```bash
git clone https://github.com/shivakokkula/ai-document-extraction-saas.git
cd ai-document-extraction-saas
cp .env.example backend/.env
cp .env.example ai-service/.env
```

---

### STEP 2 — Neon (Free PostgreSQL)

**What it is:** Serverless PostgreSQL. Free tier = 512MB, more than enough to start.

1. Go to → [neon.tech](https://neon.tech) → **Sign up with GitHub**
2. Click **New Project**
   - Name: `docuparsea`
   - Region: `AWS ap-south-1 (Mumbai)`
   - PostgreSQL version: 16
3. Click **Create Project**
4. On the dashboard click **Connect**
5. Select **Connection string** tab
6. Copy the **Pooled connection** string (has `?pgbouncer=true` at the end)
   → paste as `DATABASE_URL` in `backend/.env`
7. Switch to **Direct connection** (no pgbouncer)
   → paste as `DIRECT_URL` in `backend/.env`

Your values will look like:
```env
DATABASE_URL="postgresql://user:pass@ep-cool-name-123.ap-south-1.aws.neon.tech/dbname?sslmode=require&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://user:pass@ep-cool-name-123.ap-south-1.aws.neon.tech/dbname?sslmode=require"
```

> ⚠️ Keep `&connection_limit=1` on the pooled URL — required for serverless.

---

### STEP 3 — Upstash (Free Redis)

**What it is:** Serverless Redis. Used for BullMQ job queues and rate limiting.

1. Go to → [console.upstash.com](https://console.upstash.com) → **Sign up**
2. Click **Create Database**
   - Name: `docuparsea`
   - Type: **Redis**
   - Region: `AP-South-1 (Mumbai)` or `US-East-1`
   - TLS: **Enabled** ✅
3. Click **Create**
4. On the database page scroll to **Connect** section
5. Copy the **Redis URL** (starts with `rediss://`)
   → paste as `REDIS_URL` in `backend/.env`

Your value will look like:
```env
REDIS_URL="rediss://default:AbCdEfGhIj@us1-abc-12345.upstash.io:6379"
```

> ⚠️ Must start with `rediss://` (with double `s`) — this is TLS-enabled Redis.

---

### STEP 4 — AWS S3 (You said this is done ✅)

Confirm you have these values in your `.env`:
```env
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=docuparsea-uploads
AWS_S3_ENDPOINT=          # leave blank for real AWS
```

**Add CORS policy to your bucket** (if not done yet):
1. Go to S3 → your bucket → **Permissions** tab → **CORS** → Edit
2. Paste this:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://your-app.vercel.app"
    ],
    "ExposeHeaders": ["ETag"]
  }
]
```
3. Save

---

### STEP 5 — Gemini API Key

**What it is:** Powers the LLM extraction — reads OCR text and returns structured JSON.

1. Go to → [aistudio.google.com](https://aistudio.google.com) → Sign in
2. Click **API Keys** in the left sidebar
3. Click **Create Key**
   - Name: `docuparsea`
4. Copy the key (shown only once — save it!)
   → paste as `GEMINI_API_KEY` in `ai-service/.env`

Your value will look like:
```env
GEMINI_API_KEY="AIza..."
```

> 💡 Add $5 credit to start. Each document extraction costs ~$0.01-0.03.

---

### STEP 6 — Stripe (Payments)

**What it is:** Handles subscriptions, billing portal, and webhooks.

#### 6a. Get API keys
1. Go to → [dashboard.stripe.com](https://dashboard.stripe.com) → Sign up
2. Click **Developers** → **API keys**
3. Copy **Publishable key** → `STRIPE_PUBLISHABLE_KEY`
4. Click **Reveal test key** → copy **Secret key** → `STRIPE_SECRET_KEY`

> 💡 Use test keys (`pk_test_` / `sk_test_`) during development. Switch to live keys before launch.

#### 6b. Create products
1. Go to **Products** → **Add product**
2. **Product 1 — Pro Plan:**
   - Name: `DocuParse Pro`
   - Click **Add price**
   - Pricing model: **Recurring**
   - Price: `1999` → Currency: `INR`
   - Billing period: **Monthly**
   - Click **Save product**
   - Copy the **Price ID** (starts with `price_`)
   → paste as `STRIPE_PRO_PRICE_ID`

3. **Product 2 — Enterprise Plan:**
   - Name: `DocuParse Enterprise`
   - Price: `9999 INR/month`
   - Copy **Price ID** → `STRIPE_ENTERPRISE_PRICE_ID`

#### 6c. Create webhook (for local dev)
1. Install Stripe CLI: [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
2. Run:
```bash
stripe login
stripe listen --forward-to localhost:4000/api/v1/billing/webhook
```
3. Copy the **webhook signing secret** shown → `STRIPE_WEBHOOK_SECRET`

> For production: Dashboard → **Webhooks** → **Add endpoint** → URL: `https://your-backend.onrender.com/api/v1/billing/webhook` → Events: `customer.subscription.*`, `invoice.payment_*`

---

### STEP 7 — SendGrid (Email)

**What it is:** Sends verification emails, password resets, and notifications.

1. Go to → [sendgrid.com](https://sendgrid.com) → Sign up free
2. Go to **Settings** → **API Keys** → **Create API Key**
   - Name: `docuparsea`
   - Permission: **Full Access**
3. Copy key → `SENDGRID_API_KEY`
4. Go to **Settings** → **Sender Authentication** → **Single Sender Verification**
   - Add your email (e.g., your Gmail)
   - Verify it
5. Set `FROM_EMAIL` to that verified email

---

### STEP 8 — Google OAuth (Optional but recommended)

**What it is:** "Sign in with Google" button. Skip if you want email/password only.

1. Go to → [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project → name: `docuparsea`
3. Go to **APIs & Services** → **OAuth consent screen**
   - User Type: **External**
   - App name: `DocuParse AI`
   - Support email: your email
   - Save
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `DocuParse Web`
   - Authorized redirect URIs:
     - `http://localhost:4000/api/v1/auth/google/callback` (dev)
     - `https://your-backend.onrender.com/api/v1/auth/google/callback` (prod)
5. Click **Create** → copy **Client ID** and **Client Secret**

```env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback
```

---

### STEP 9 — Generate JWT Secrets

Run this in your terminal — generates two secure 64-char random secrets:

```bash
node -e "const c=require('crypto'); console.log('JWT_ACCESS_SECRET=' + c.randomBytes(64).toString('hex')); console.log('JWT_REFRESH_SECRET=' + c.randomBytes(64).toString('hex'));"
```

Copy both values into your `backend/.env`.

---

### STEP 10 — Install Local Dependencies

#### System requirements
```bash
# Mac
brew install node@20 python@3.11 tesseract

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs python3.11 python3-pip tesseract-ocr tesseract-ocr-eng poppler-utils libgl1
```

#### Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
```

#### AI Service
```bash
cd ../ai-service
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

#### Frontend
```bash
cd ../frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
echo "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_..." >> .env.local
```

---

### STEP 11 — Run Locally

Open **3 terminals**:

**Terminal 1 — Backend:**
```bash
cd backend
npm run start:dev
# Runs on http://localhost:4000
# Swagger docs: http://localhost:4000/api/docs
```

**Terminal 2 — AI Service:**
```bash
cd ai-service
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
# Runs on http://localhost:8000
```

**Terminal 3 — Frontend:**
```bash
cd frontend
npm run dev
# Runs on http://localhost:3000
```

**Terminal 4 — Stripe webhooks (optional):**
```bash
stripe listen --forward-to localhost:4000/api/v1/billing/webhook
```

Open [http://localhost:3000](http://localhost:3000) — you should see the login page.

---

### STEP 12 — Deploy to Production

#### 12a. Deploy Backend to Render
1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect GitHub → select this repo
3. Configure:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm ci && npx prisma generate && npm run build`
   - **Start Command:** `npx prisma migrate deploy && node dist/main.js`
   - **Plan:** Starter ($7/mo)
4. Add **all** env vars from `backend/.env` (replace localhost URLs with real ones)
5. Click **Create Web Service**
6. Copy the deployed URL (e.g., `https://docuparsea-backend.onrender.com`)

#### 12b. Deploy AI Service to Render
1. **New** → **Web Service** → same repo
2. Configure:
   - **Root Directory:** `ai-service`
   - **Runtime:** Python 3
   - **Build Command:** `apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-eng poppler-utils libgl1 && pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Starter ($7/mo)
3. Add env vars: `GEMINI_API_KEY`, all `AWS_*`, `OCR_ENGINE=tesseract`
4. Copy deployed URL

#### 12c. Update Backend with AI Service URL
In Render dashboard → `docuparsea-backend` → Environment:
```
AI_SERVICE_URL = https://docuparsea-ai-service.onrender.com
FRONTEND_URL   = https://your-app.vercel.app   (fill after step 12d)
```

#### 12d. Deploy Frontend to Vercel
```bash
cd frontend
npx vercel --prod
```
Or connect GitHub repo at [vercel.com](https://vercel.com):
- Framework: Next.js (auto-detected)
- Root Directory: `frontend`
- Add env vars:
  ```
  NEXT_PUBLIC_API_URL = https://docuparsea-backend.onrender.com
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_live_...
  ```

#### 12e. Update Stripe webhook URL
Dashboard → Webhooks → Edit endpoint URL to:
`https://docuparsea-backend.onrender.com/api/v1/billing/webhook`

---

## Plans

| Plan | Price | Docs/month | File size |
|------|-------|-----------|-----------|
| Free | ₹0 | 10 | 5MB |
| Pro | ₹1,999/mo | 500 | 50MB |
| Enterprise | ₹9,999/mo | Unlimited | 200MB |

---

## API Reference

Swagger docs: `https://your-backend.onrender.com/api/docs`

Key endpoints:
```
POST /api/v1/auth/register          Register
POST /api/v1/auth/login             Login → returns access + refresh tokens
POST /api/v1/auth/refresh           Rotate refresh token
POST /api/v1/documents/upload-url   Get S3 presigned upload URL
POST /api/v1/documents              Trigger AI processing
GET  /api/v1/documents              List documents (paginated)
GET  /api/v1/documents/:id          Get document + extraction result
GET  /api/v1/documents/:id/export   Download JSON or CSV
POST /api/v1/billing/checkout       Start Stripe checkout
GET  /api/v1/billing/usage          Current month usage
GET  /api/v1/health                 Health check
```

---

## License

MIT — free to use for your own SaaS.
