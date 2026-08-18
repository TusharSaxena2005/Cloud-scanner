from google.auth import default as google_auth_default
from google.auth.credentials import Credentials
from google.auth.exceptions import DefaultCredentialsError

from app.config import settings

CLOUD_PLATFORM_SCOPE = ["https://www.googleapis.com/auth/cloud-platform"]


def load_scanner_credentials() -> Credentials:
    try:
        credentials, _ = google_auth_default(scopes=CLOUD_PLATFORM_SCOPE)
        return credentials
    except DefaultCredentialsError as exc:
        raise ValueError(
            "Application Default Credentials not found. Run "
            "'gcloud auth application-default login', or set "
            "GOOGLE_APPLICATION_CREDENTIALS to a service account key path."
        ) from exc


def resolve_credentials_identity(credentials: Credentials) -> tuple[str, str | None]:
    service_account_email = getattr(credentials, "service_account_email", None)
    if service_account_email:
        unique_id = (
            settings.gcp_service_account_unique_id
            if service_account_email == settings.gcp_service_account_email
            else None
        )
        return service_account_email, unique_id

    return "ADC user account", None
