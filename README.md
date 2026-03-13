# DocuParse AI — Production SaaS

AI-powered document extraction SaaS. Upload PDFs (invoices, receipts, bank statements) and extract structured data using OCR + LLM.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, TailwindCSS |
| Backend API | NestJS, TypeScript, Prisma |
| AI Service | Python, FastAPI, PaddleOCR, Claude API |
| Database | PostgreSQL 16 |
| Queue | Redis + BullMQ |
| Storage | AWS S3 / MinIO |
| Payments | Stripe |
| Auth | JWT + Refresh Tokens + Google OAuth |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/shivakokkula/ai-document-extraction-saas.git
cd ai-document-extraction-saas

# 2. Copy environment variables
cp .env.example .env
# Fill in your API keys

# 3. Start all services
docker-compose up -d

# 4. Run migrations
cd backend && npx prisma migrate deploy

# 5. Access
# Frontend:   http://localhost:3000
# Backend:    http://localhost:4000
# AI Service: http://localhost:8000
# MinIO UI:   http://localhost:9001
```

## Project Structure

```
ai-document-extraction-saas/
├── frontend/         # Next.js app
├── backend/          # NestJS API
├── ai-service/       # Python FastAPI + OCR + LLM
├── infrastructure/   # Docker, Nginx, CI/CD
└── .github/          # GitHub Actions workflows
```

## Plans

| Plan | Price | Documents/month |
|------|-------|----------------|
| Free | ₹0 | 10 |
| Pro | ₹1,999 | 500 |
| Enterprise | ₹9,999 | Unlimited |

## License

MIT
