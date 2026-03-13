from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    anthropic_api_key: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    aws_s3_endpoint: str = ""
    redis_url: str = "redis://localhost:6379"
    ocr_engine: str = "paddleocr"   # or 'tesseract'
    llm_model: str = "claude-opus-4-6"
    log_level: str = "INFO"

    class Config:
        env_file = ".env"

settings = Settings()
