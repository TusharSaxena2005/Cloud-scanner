import re
from dataclasses import dataclass


@dataclass(frozen=True)
class GcpResourceRef:
    project: str
    region: str | None
    resource_type: str
    name: str
    self_link: str


_RESOURCE_PATTERN = re.compile(
    r"projects/(?P<project>[^/]+)"
    r"(?:/regions/(?P<region>[^/]+))?"
    r"/(?P<resource_type>[a-zA-Z]+)/(?P<name>[^/]+)$"
)


def parse_gcp_self_link(self_link: str) -> GcpResourceRef | None:
    if not self_link:
        return None

    path = self_link.split("/compute/")[-1] if "/compute/" in self_link else self_link
    match = _RESOURCE_PATTERN.search(path)
    if not match:
        return None

    return GcpResourceRef(
        project=match.group("project"),
        region=match.group("region"),
        resource_type=match.group("resource_type"),
        name=match.group("name"),
        self_link=self_link,
    )


def resource_scope_label(region: str | None) -> str:
    return region or "global"
