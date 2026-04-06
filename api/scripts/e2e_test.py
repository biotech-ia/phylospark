"""E2E validation script for PhyloSpark stack."""
import httpx
import sys

API = "http://localhost:8000"
passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name} {detail}")
    else:
        failed += 1
        print(f"  FAIL  {name} {detail}")


# 1. API health
r = httpx.get(f"{API}/health")
check("API health", r.status_code == 200, str(r.json()))

# 2. List experiments
r = httpx.get(f"{API}/api/v1/experiments/")
data = r.json()
check("Experiments list", data["total"] == 2, f"total={data['total']}")

# 3. Get completed experiment
r = httpx.get(f"{API}/api/v1/experiments/1")
exp = r.json()
check("Experiment #1 status", exp["status"] == "complete", exp["status"])
check("Experiment #1 name", "GH13" in exp["name"], exp["name"])

# 4. Tree data for completed experiment
r = httpx.get(f"{API}/api/v1/experiments/1/tree")
tree = r.json()
check("Tree data available", "newick" in tree, f"{len(tree['newick'])} chars")
check("Tree has taxa", "P04745" in tree["newick"])

# 5. Alignment data
r = httpx.get(f"{API}/api/v1/experiments/1/alignment")
al = r.json()
fasta = al["fasta"]
seq_count = fasta.count(">")
check("Alignment available", seq_count == 10, f"{seq_count} sequences")

# 6. Stats data
r = httpx.get(f"{API}/api/v1/experiments/1/stats")
stats = r.json()
check("Features available", len(stats["features"]) == 10, f"{len(stats['features'])} features")
check("Distances available", len(stats["distances"]) == 45, f"{len(stats['distances'])} pairs")
check("Feature has length", stats["features"][0].get("length", 0) > 0)
check("Feature has AA comp", "aa_A" in stats["features"][0])
check("Feature has hydro frac", "hydrophobic_frac" in stats["features"][0])

# 7. Pending experiment rejects data requests
r = httpx.get(f"{API}/api/v1/experiments/2/tree")
check("Pending exp rejects tree", r.status_code == 400)

# 8. Create new experiment
r = httpx.post(f"{API}/api/v1/experiments/", json={
    "name": "E2E Test Experiment",
    "query": "amylase test",
    "max_sequences": 5,
})
check("Create experiment", r.status_code == 201, f"id={r.json().get('id')}")
new_id = r.json()["id"]

# 9. Delete test experiment
r = httpx.delete(f"{API}/api/v1/experiments/{new_id}")
check("Delete experiment", r.status_code == 204)

# Summary
print(f"\n{'='*40}")
print(f"  {passed} passed, {failed} failed")
print(f"{'='*40}")
sys.exit(1 if failed else 0)
