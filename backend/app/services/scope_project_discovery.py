from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

from google.api_core import exceptions as google_exceptions
from google.cloud import resourcemanager_v3

LogCallback = Callable[[str], None]


@dataclass
class ScopeProjectDiscoveryResult:
    project_ids: list[str] = field(default_factory=list)
    skipped_scopes: list[dict[str, str]] = field(default_factory=list)


class ScopeProjectDiscovery:
    def __init__(self, credentials) -> None:
        self._credentials = credentials

    def discover(
        self,
        scope_type: str,
        scope_id: str,
        on_log: LogCallback | None = None,
    ) -> ScopeProjectDiscoveryResult:
        root = f"{'organizations' if scope_type == 'organization' else 'folders'}/{scope_id}"
        folders = resourcemanager_v3.FoldersClient(credentials=self._credentials)
        projects = resourcemanager_v3.ProjectsClient(credentials=self._credentials)
        parents = deque([root])
        project_ids: list[str] = []
        skipped_scopes: list[dict[str, str]] = []

        while parents:
            parent = parents.popleft()
            self._emit(on_log, f"Listing projects under {parent}")
            try:
                for project in projects.list_projects(parent=parent):
                    if project.project_id:
                        project_ids.append(project.project_id)
            except google_exceptions.GoogleAPIError as exc:
                if parent == root:
                    raise
                skipped_scopes.append({"resource": parent, "reason": str(exc)})
                self._emit(on_log, f"Could not list projects under {parent}: {exc}")

            self._emit(on_log, f"Listing child folders under {parent}")
            try:
                parents.extend(folder.name for folder in folders.list_folders(parent=parent))
            except google_exceptions.GoogleAPIError as exc:
                if parent == root:
                    raise
                skipped_scopes.append({"resource": parent, "reason": str(exc)})
                self._emit(on_log, f"Could not list child folders under {parent}: {exc}")

        unique_project_ids = list(dict.fromkeys(project_ids))
        self._emit(on_log, f"Discovered {len(unique_project_ids)} project(s) under {root}")
        return ScopeProjectDiscoveryResult(
            project_ids=unique_project_ids,
            skipped_scopes=skipped_scopes,
        )

    @staticmethod
    def _emit(on_log: LogCallback | None, message: str) -> None:
        if on_log is not None:
            on_log(message)
