from pathlib import Path
import json
import queue
import threading

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.models.schemas import (
    CheckLbPermissionsRequest,
    CheckLbPermissionsResponse,
    PermissionManifestEntry,
    PermissionManifestResponse,
    ScanResponse,
)
from app.config import settings
from app.auth import router as auth_router, require_scanner_user
from app.connections import router as connections_router, scan_credentials
from app.services.lb_permission_checker import LbPermissionChecker
from app.services.permission_preflight import DEFAULT_MANIFEST_PATH, load_permission_manifest
from app.services.scan_orchestrator import ScanOrchestrator, build_preflight_response

app = FastAPI(
    title="CloudScanner GCP LB Permission Checker",
    description="Scan cloud resources using workspace-owned cloud connections.",
    version="1.0.0",
)

app.include_router(auth_router)
app.include_router(connections_router)

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if (FRONTEND_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


@app.get("/")
def serve_frontend() -> FileResponse:
    if not (FRONTEND_DIR / "index.html").exists():
        raise HTTPException(status_code=503, detail="Frontend build missing. Run npm install and npm run build in frontend, then restart the backend.")
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/permissions/manifest", response_model=PermissionManifestResponse, dependencies=[Depends(require_scanner_user)])
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


@app.get("/api/v1/scan/{project_id}", response_model=ScanResponse, dependencies=[Depends(require_scanner_user)])
def scan_project(project_id: str, identity=Depends(scan_credentials)) -> ScanResponse:
    if not 6 <= len(project_id) <= 30:
        raise HTTPException(status_code=400, detail="Invalid project ID length.")

    try:
        return ScanOrchestrator(*identity).run(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to run scan. Check your connection and project access.",
        ) from exc


@app.get("/api/v1/scan/{project_id}/stream", dependencies=[Depends(require_scanner_user)])
def scan_project_stream(project_id: str, identity=Depends(scan_credentials)) -> StreamingResponse:
    if not 6 <= len(project_id) <= 30:
        raise HTTPException(status_code=400, detail="Invalid project ID length.")

    log_queue: queue.Queue[tuple[str, object]] = queue.Queue()

    def on_log(message: str) -> None:
        log_queue.put(("log", message))

    def run_scan() -> None:
        try:
            result = ScanOrchestrator(*identity).run(project_id, on_log=on_log)
            log_queue.put(("result", result))
        except ValueError as exc:
            log_queue.put(("error", str(exc)))
        except Exception as exc:
            log_queue.put(("error", "Failed to run scan. Check your connection and project access."))

    threading.Thread(target=run_scan, daemon=True).start()

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


@app.post("/api/check-lb-permissions", response_model=CheckLbPermissionsResponse, dependencies=[Depends(require_scanner_user)])
def check_lb_permissions(body: CheckLbPermissionsRequest, identity=Depends(scan_credentials)) -> CheckLbPermissionsResponse:
    try:
        checker = LbPermissionChecker(*identity)
        result = checker.check(body.project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to check permissions. Check your connection and project access.",
        ) from exc

    return _build_check_response(result)


@app.post("/api/check-lb-permissions/stream", dependencies=[Depends(require_scanner_user)])
def check_lb_permissions_stream(body: CheckLbPermissionsRequest, identity=Depends(scan_credentials)) -> StreamingResponse:
    log_queue: queue.Queue[tuple[str, object]] = queue.Queue()

    def on_log(message: str) -> None:
        log_queue.put(("log", message))

    def run_check() -> None:
        try:
            checker = LbPermissionChecker(*identity)
            result = checker.check(body.project_id, on_log=on_log)
            log_queue.put(("result", _build_check_response(result)))
        except ValueError as exc:
            log_queue.put(("error", str(exc)))
        except Exception as exc:
            log_queue.put(("error", "Failed to check permissions. Check your connection and project access."))

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
