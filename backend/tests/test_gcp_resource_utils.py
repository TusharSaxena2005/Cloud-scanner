import unittest

from app.services.gcp_resource_utils import parse_gcp_self_link


class GcpResourceUtilsTests(unittest.TestCase):
    def test_parse_global_resource_url(self):
        self_link = (
            "https://www.googleapis.com/compute/v1/projects/"
            "project-fd50a991-1440-4085-8ca/global/targetHttpProxies/"
            "juice-shop-lb-target-proxy"
        )

        resource = parse_gcp_self_link(self_link)

        self.assertIsNotNone(resource)
        self.assertEqual(resource.project, "project-fd50a991-1440-4085-8ca")
        self.assertIsNone(resource.region)
        self.assertEqual(resource.resource_type, "targetHttpProxies")
        self.assertEqual(resource.name, "juice-shop-lb-target-proxy")
        self.assertEqual(resource.self_link, self_link)

    def test_parse_regional_resource_url(self):
        resource = parse_gcp_self_link(
            "https://www.googleapis.com/compute/v1/projects/demo-project/"
            "regions/us-central1/backendServices/regional-backend"
        )

        self.assertIsNotNone(resource)
        self.assertEqual(resource.region, "us-central1")
        self.assertEqual(resource.resource_type, "backendServices")
        self.assertEqual(resource.name, "regional-backend")


if __name__ == "__main__":
    unittest.main()
