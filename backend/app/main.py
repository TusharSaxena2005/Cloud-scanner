from pathlib import Path
import json
import queue
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.models.schemas import (
    CheckLbPermissionsRequest,
    CheckLbPermissionsResponse,
    PermissionManifestEntry,
    PermissionManifestResponse,
    ScanResponse,
    ServiceAccountInfo,
)
from app.config import settings
from app.services.gcp_credentials import (
    load_scanner_credentials,
    resolve_credentials_identity,
)
from app.services.lb_permission_checker import LbPermissionChecker
from app.services.permission_preflight import DEFAULT_MANIFEST_PATH, load_permission_manifest
from app.services.scan_orchestrator import ScanOrchestrator, build_preflight_response

app = FastAPI(
    title="CloudScanner GCP LB Permission Checker",
    description="Check whether the configured service account can view GCP load balancers.",
    version="1.0.0",
)

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
    app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")


@app.get("/")
def serve_frontend() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/service-account", response_model=ServiceAccountInfo)
def get_service_account() -> ServiceAccountInfo:
    try:
        credentials = load_scanner_credentials()
        email, unique_id = resolve_credentials_identity(credentials)
    except ValueError:
        email = settings.gcp_service_account_email
        unique_id = settings.gcp_service_account_unique_id

    return ServiceAccountInfo(
        email=email,
        unique_id=unique_id,
        auth_method="adc",
    )


@app.get("/api/permissions/manifest", response_model=PermissionManifestResponse)
def get_permission_manifest() -> PermissionManifestResponse:
    manifest_path = settings.permission_manifest_path or DEFAULT_MANIFEST_PATH
    manifest = load_permission_manifest(manifest_path)
    return PermissionManifestResponse(
        manifest_path=str(manifest_path),
        permissions=[
            PermissionManifestEntry(permission=entry.permission, scope=entry.scope)
            for entry in manifest
        ],
    )


def _build_check_response(result) -> CheckLbPermissionsResponse:
    return build_preflight_response(result)


@app.get("/api/v1/scan/{project_id}", response_model=ScanResponse)
def scan_project(project_id: str) -> ScanResponse:
    if not 6 <= len(project_id) <= 30:
        raise HTTPException(status_code=400, detail="Invalid project ID length.")

    try:
        return ScanOrchestrator().run(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to run scan: {exc}",
        ) from exc


@app.post("/api/check-lb-permissions", response_model=CheckLbPermissionsResponse)
def check_lb_permissions(body: CheckLbPermissionsRequest) -> CheckLbPermissionsResponse:
    try:
        checker = LbPermissionChecker()
        result = checker.check(body.project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to check GCP permissions: {exc}",
        ) from exc

    return _build_check_response(result)


@app.post("/api/check-lb-permissions/stream")
def check_lb_permissions_stream(body: CheckLbPermissionsRequest) -> StreamingResponse:
    log_queue: queue.Queue[tuple[str, object]] = queue.Queue()

    def on_log(message: str) -> None:
        log_queue.put(("log", message))

    def run_check() -> None:
        try:
            checker = LbPermissionChecker()
            result = checker.check(body.project_id, on_log=on_log)
            log_queue.put(("result", _build_check_response(result)))
        except ValueError as exc:
            log_queue.put(("error", str(exc)))
        except Exception as exc:
            log_queue.put(("error", f"Failed to check GCP permissions: {exc}"))

    threading.Thread(target=run_check, daemon=True).start()

    def event_stream():
        while True:
            event_type, payload = log_queue.get()
            if event_type == "log":
                yield f"data: {json.dumps({'type': 'log', 'message': payload})}\n\n"
            elif event_type == "result":
                yield f"data: {json.dumps({'type': 'result', 'data': payload.model_dump()})}\n\n"
                break
            elif event_type == "error":
                yield f"data: {json.dumps({'type': 'error', 'message': payload})}\n\n"
                break

    return StreamingResponse(event_stream(), media_type="text/event-stream")
