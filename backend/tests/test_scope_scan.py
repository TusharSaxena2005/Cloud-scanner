from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

from app.services.external_lb_scanner import ExternalLbScanner
from app.services.scope_project_discovery import ScopeProjectDiscovery
from app.services.scope_scan import ScopeScanOrchestrator


class BatchedExternalLbScannerTests(unittest.TestCase):
    def test_scans_every_project_and_forwarding_rule_before_resolving_details(self):
        events = []

        class Scanner(ExternalLbScanner):
            def _get_project(self, project_id):
                events.append(f"project:{project_id}")
                return None

            def _discover_external_forwarding_rules(self, project_id):
                events.append(f"forwarding-rules:{project_id}")
                return [SimpleNamespace(
                    name=f"rule-{project_id}",
                    self_link=f"projects/{project_id}/global/forwardingRules/rule",
                    load_balancing_scheme="EXTERNAL",
                    port_range="80",
                    target=f"target-{project_id}",
                    IPAddress="192.0.2.1",
                )]

            def _resolve_hierarchy_target_proxy(self, rule, hierarchy):
                events.append(f"proxy:{hierarchy.project_id}")

            def _resolve_hierarchy_url_map(self, hierarchy):
                events.append(f"url-map:{hierarchy.project_id}")

            def _resolve_hierarchy_backends(self, hierarchy):
                events.append(f"backends:{hierarchy.project_id}")

        result = Scanner(object()).scan_projects(["project-one", "project-two"])

        self.assertEqual(
            events,
            [
                "project:project-one",
                "project:project-two",
                "forwarding-rules:project-one",
                "forwarding-rules:project-two",
                "proxy:project-one",
                "proxy:project-two",
                "url-map:project-one",
                "url-map:project-two",
                "backends:project-one",
                "backends:project-two",
            ],
        )
        self.assertEqual(
            [item.project_id for item in result.load_balancers],
            ["project-one", "project-two"],
        )


class ScopeProjectDiscoveryTests(unittest.TestCase):
    @patch("app.services.scope_project_discovery.resourcemanager_v3.ProjectsClient")
    @patch("app.services.scope_project_discovery.resourcemanager_v3.FoldersClient")
    def test_discovers_projects_recursively_before_resource_scanning(self, folders_client, projects_client):
        projects = projects_client.return_value
        projects.list_projects.side_effect = lambda parent: {
            "organizations/123": [SimpleNamespace(project_id="org-project")],
            "folders/10": [SimpleNamespace(project_id="folder-project")],
            "folders/11": [SimpleNamespace(project_id="nested-project")],
        }[parent]
        folders = folders_client.return_value
        folders.list_folders.side_effect = lambda parent: {
            "organizations/123": [SimpleNamespace(name="folders/10")],
            "folders/10": [SimpleNamespace(name="folders/11")],
            "folders/11": [],
        }[parent]

        result = ScopeProjectDiscovery(object()).discover("organization", "123")

        self.assertEqual(
            result.project_ids,
            ["org-project", "folder-project", "nested-project"],
        )
        self.assertEqual(result.skipped_scopes, [])
        self.assertEqual(projects.list_projects.call_count, 3)
        self.assertEqual(folders.list_folders.call_count, 3)


class ScopeScanOrchestratorTests(unittest.TestCase):
    @patch("app.services.scope_scan.ExternalLbScanner")
    @patch("app.services.scope_scan.LbPermissionChecker")
    @patch("app.services.scope_scan.ScopeProjectDiscovery")
    def test_checks_every_project_before_batched_resource_scan(
        self,
        discovery_class,
        permission_checker_class,
        scanner_class,
    ):
        events = []
        discovery_class.return_value.discover.return_value = SimpleNamespace(
            project_ids=["project-one", "project-two"],
            skipped_scopes=[],
        )

        def make_checker(credentials, email):
            checker = Mock()
            checker.check.side_effect = lambda project_id, on_log: (
                events.append(f"check:{project_id}")
                or SimpleNamespace(
                    all_permissions_granted=True,
                    missing_permissions=[],
                    invalid_permissions=[],
                )
            )
            return checker

        permission_checker_class.side_effect = make_checker
        scan_result = SimpleNamespace(
            failed_projects=[],
            projects=[],
            load_balancers=[],
        )
        scanner_class.return_value.scan_projects.side_effect = lambda project_ids, **kwargs: (
            events.append("scan")
            or scan_result
        )

        response = ScopeScanOrchestrator(object(), "scanner@example.com").run(
            "folder",
            "123",
        )

        self.assertEqual(events, ["check:project-one", "check:project-two", "scan"])
        self.assertEqual(response.scope_type, "folder")
        self.assertEqual(response.project_ids, ["project-one", "project-two"])
        self.assertEqual(response.scanned_project_ids, ["project-one", "project-two"])


if __name__ == "__main__":
    unittest.main()
