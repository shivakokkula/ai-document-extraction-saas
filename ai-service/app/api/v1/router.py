from fastapi import APIRouter
from app.api.v1.extract import router as extract_router

router = APIRouter()
router.include_router(extract_router, prefix="/extract", tags=["Extraction"])
