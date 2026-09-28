"""The three example models share one service collection."""

import json
from pathlib import Path
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class ExampleRoutesTest(unittest.TestCase):
    def call(self, method, payload):
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "10000",
             "--initialization-fuel", "10000", "example_models"],
            input=json.dumps({"method": method, "input": payload}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        return json.loads(result.stdout)

    def test_each_model_uses_its_own_query_and_knowledge(self):
        cases = [
            ("dog", "Dog", "dog", "Dogs", "Breed"),
            ("spider", "student", "student", "students", "address"),
            ("world", "city", "city", "city", "country"),
        ]
        for domain, entity, node, table, first_topic in cases:
            with self.subTest(domain=domain):
                query = self.call(f"{domain}/transform", {"intent": {
                    "op": "graph", "root": node,
                    "nodes": [{"id": node, "entity": entity}],
                    "edges": [], "select": [], "count": node,
                }})
                self.assertIn(f"FROM {table} AS {node}", query["sql"])
                page = self.call(f"{domain}/index", {"limit": 1})["Index"]
                self.assertEqual(page["entries"][0]["topic"], first_topic)
                point = self.call(f"{domain}/info", {"topic": first_topic})["Document"]["Found"]
                self.assertEqual(point["label"], first_topic)


if __name__ == "__main__":
    unittest.main()
