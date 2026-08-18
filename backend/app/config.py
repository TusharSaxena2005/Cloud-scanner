from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    gcp_service_account_email: str = (
        "412341228981-compute@developer.gserviceaccount.com"
    )
    gcp_service_account_unique_id: str = "106805231874967943359"
    permission_manifest_path: Path | None = None
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
