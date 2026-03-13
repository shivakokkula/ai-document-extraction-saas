# DocuParse AI — Production SaaS

AI-powered document extraction SaaS. Upload PDFs (invoices, receipts, bank statements) and extract structured JSON using OCR + Claude AI.

## Live Stack (Zero DevOps)

| Service | Platform | Cost |
|---------|----------|------|
| Frontend (Next.js) | Vercel | Free |
| Backend API (NestJS) | Render | $7/mo |
| AI Service (FastAPI) | Render | $7/mo |
| Database (PostgreSQL) | Neon | Free |
| Redis + Queues | Upstash | Free |
| File Storage | AWS S3 | ~$1/mo |
| Payments | Stripe | % of revenue |
| Email | SendGrid | Free |

**Total to launch: ~$15/month**

---

## Project Structure

```
ai-document-extraction-saas/
├── backend/       # NestJS API — Auth, Documents, Billing, Queue
├── ai-service/    # FastAPI — OCR + Claude extraction pipeline
├── frontend/      # Next.js 14 — Dashboard, Upload, Billing
├── render.yaml    # Render deployment blueprint
└── .env.example   # All environment variables documented
```

---

## Step-by-Step Deployment

### 1. Neon Database (Free PostgreSQL)

1. Sign up at [neon.tech](https://neon.tech) → New Project → name it `docuparsea`
2. Click Connect → copy two connection strings:
   - **Pooled connection** → `DATABASE_URL`
   - **Direct connection** → `DIRECT_URL`

### 2. Upstash Redis (Free)

1. Sign up at [upstash.com](https://upstash.com) → Create Database → Redis
2. Copy the Redis URL (starts with `rediss://`) → `REDIS_URL`

### 3. AWS S3

1. Create a private S3 bucket in `ap-south-1`
2. Create an IAM user with `AmazonS3FullAccess`
3. Copy Access Key ID + Secret → `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
4. Add CORS policy to bucket:
```json
[{"AllowedHeaders":["*"],"AllowedMethods":["PUT","GET"],"AllowedOrigins":["https://your-app.vercel.app"],"ExposeHeaders":["ETag"]}]
```

### 4. Stripe

1. Get API keys from [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create two recurring products: Pro (₹1,999/mo) and Enterprise (₹9,999/mo)
3. Add webhook endpoint: `https://your-backend.onrender.com/api/v1/billing/webhook`
   - Events: `customer.subscription.*`, `invoice.payment_*`

### 5. Anthropic API Key

Sign up at [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key

### 6. SendGrid

Sign up at [sendgrid.com](https://sendgrid.com) → Settings → API Keys → Create Key

---

### 7. Deploy Backend to Render

1. [render.com](https://render.com) → New → Web Service → connect this repo
2. Settings:
   - Root Directory: `backend`
   - Runtime: `Node`
   - Build: `npm ci && npx prisma generate && npm run build`
   - Start: `npx prisma migrate deploy && node dist/main.js`
   - Plan: Starter ($7/mo)
3. Add all env vars from `.env.example`

### 8. Deploy AI Service to Render

1. New → Web Service → same repo
2. Settings:
   - Root Directory: `ai-service`
   - Runtime: `Python 3`
   - Build: `apt-get update && apt-get install -y tesseract-ocr poppler-utils libgl1 && pip install -r requirements.txt`
   - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Plan: Starter ($7/mo)
3. Add: `ANTHROPIC_API_KEY`, `AWS_*`, `OCR_ENGINE=tesseract`

### 9. Deploy Frontend to Vercel

```bash
cd frontend
npx vercel
```

Add in Vercel dashboard → Environment Variables:
```
NEXT_PUBLIC_API_URL = https://your-backend.onrender.com
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_live_...
```

### 10. Final Wiring

Update backend env vars on Render:
```
FRONTEND_URL   = https://your-app.vercel.app
AI_SERVICE_URL = https://your-ai-service.onrender.com
```

---

## Local Development

```bash
# Backend
cd backend && npm install
cp ../.env.example .env  # fill in Neon + Upstash keys
npx prisma generate && npx prisma migrate dev
npm run start:dev

# AI Service (new terminal)
cd ai-service && pip install -r requirements.txt
# Install Tesseract: brew install tesseract (Mac) or apt install tesseract-ocr (Linux)
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
npm run dev
```

Open http://localhost:3000

---

## Plans

| Plan | Price | Docs/month |
|------|-------|-----------|
| Free | ₹0 | 10 |
| Pro | ₹1,999/mo | 500 |
| Enterprise | ₹9,999/mo | Unlimited |

## API Docs

Swagger: `https://your-backend.onrender.com/api/docs`

## License

MIT
