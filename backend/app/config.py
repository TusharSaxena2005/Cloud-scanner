from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[1] / ".env", env_file_encoding="utf-8", extra="ignore")

    permission_manifest_path: Path | None = None
    database_url: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    public_url: str = "http://127.0.0.1:5173"
    credential_encryption_key: str = ""
    session_cookie_secure: bool = False
    session_hours: int = 24
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
