from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    gemini_api_key: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    aws_s3_endpoint: str = ""
    redis_url: str = "redis://localhost:6379"
    ocr_engine: str = "easyocr"
    llm_model: str = "gemini-2.5-flash"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        # Support both:
        # 1) ai-service/.env (service-local env)
        # 2) project-root .env when running ai-service from its folder
        env_file=(".env", "../.env"),
        extra="ignore",
    )

settings = Settings()
