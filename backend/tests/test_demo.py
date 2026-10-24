import unittest
from app.demo import sample_workspace


class DemoTests(unittest.TestCase):
    def test_snapshot_routes_and_policies(self):
        workspace = sample_workspace()["projects"][0]
        self.assertEqual(workspace["scopeId"], "ecommerce-prod-2026")
        lbs = workspace["scanResult"]["load_balancers"]
        self.assertEqual(len(lbs), 2)
        entries = {entry["backend_service"]["name"]: entry for lb in lbs for entry in lb["backend_services"]}
        self.assertEqual(len(entries), 4)
        self.assertIsNone(entries["api-backend"]["security_policy"])
        self.assertEqual(entries["store-frontend-backend"]["edge_security_policy"]["name"], "cdn-edge-policy")
        legacy = entries["legacy-admin-backend"]["security_policy"]
        self.assertTrue(legacy["details"]["rules"][0]["preview"])
        self.assertEqual(len(lbs[0]["backend_services"]), 3)

    def test_organization_projects_and_combined_view(self):
        workspace = sample_workspace()
        self.assertEqual(workspace["scopeId"], "all-projects")
        self.assertEqual(len(workspace["projects"]), 9)
        lbs = workspace["scanResult"]["load_balancers"]
        self.assertEqual(len(lbs), 17)
        self.assertEqual(sum(len(lb["backend_services"]) for lb in lbs), 29)
        self.assertEqual({lb["project_id"] for lb in lbs}, {p["scopeId"] for p in workspace["projects"]})
        for project in workspace["projects"]:
            self.assertTrue(project["sampleMode"])
            for lb in project["scanResult"]["load_balancers"]:
                for entry in lb["backend_services"]:
                    self.assertIn(project["scopeId"], entry["backend_service"]["self_link"])

