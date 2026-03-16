from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog
import time

from app.api.v1.router import router as v1_router
from app.services.llm.gemini_service import GeminiExtractionService

logger = structlog.get_logger()

app = FastAPI(
    title="DocuParse AI Service",
    description="OCR + LLM document extraction microservice",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Locked down in prod via internal VPC
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = round((time.time() - start) * 1000)
    logger.info("request", method=request.method, path=request.url.path,
                status=response.status_code, duration_ms=duration)
    return response

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("unhandled_error", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.include_router(v1_router, prefix="/api/v1")

_llm_service = GeminiExtractionService()

@app.on_event("shutdown")
async def shutdown_event():
    await _llm_service.aclose()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.head("/health")
def health_head():
    return {"status": "ok"}

@app.get("/")
def root():
    return {"status": "ok"}

@app.head("/")
def root_head():
    return {"status": "ok"}
