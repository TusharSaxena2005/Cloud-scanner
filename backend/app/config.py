from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[1] / ".env", env_file_encoding="utf-8")

    gcp_service_account_email: str = (
        "412341228981-compute@developer.gserviceaccount.com"
    )
    gcp_service_account_unique_id: str = "106805231874967943359"
    permission_manifest_path: Path | None = None
    mongodb_uri: str = ""
    mongodb_database: str = "cloudscanner"
    session_cookie_secure: bool = False
    session_hours: int = 24
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
