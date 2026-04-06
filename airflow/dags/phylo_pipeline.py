"""
PhyloSpark Pipeline DAG
========================
Orchestrates a complete phylogenetic analysis:
  1. Download sequences from NCBI
  2. Validate and clean FASTA
  3. Spark feature engineering (length, composition, k-mers)
  4. Spark similarity matrix
  5. Multiple sequence alignment (MAFFT)
  6. Phylogenetic tree building (FastTree)
  7. Annotate results
  8. Generate report
"""

from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.models import Variable

import os
import json
import subprocess
import tempfile

# ─── MinIO / S3 Config ───────────────────────────────────
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://minio:9000")
MINIO_USER = os.environ.get("MINIO_ROOT_USER", "minioadmin")
MINIO_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "minioadmin123")
BUCKET = "phylospark"


def _get_s3_client():
    import boto3
    from botocore.client import Config
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_USER,
        aws_secret_access_key=MINIO_PASSWORD,
        config=Config(signature_version="s3v4"),
    )


# ─── Task 1: Download sequences from NCBI ───────────────
def download_sequences(**context):
    from Bio import Entrez, SeqIO

    params = context["params"]
    query = params.get("query", "GH13 alpha-amylase")
    organism = params.get("organism", "")
    max_sequences = int(params.get("max_sequences", 100))
    experiment_id = params.get("experiment_id", "default")

    search_query = f"{query}[Title]"
    if organism:
        search_query += f" AND {organism}[Organism]"

    ncbi_email = os.environ.get("NCBI_EMAIL", "phylospark@example.com")
    Entrez.email = ncbi_email
    api_key = os.environ.get("NCBI_API_KEY", "")
    if api_key:
        Entrez.api_key = api_key

    # Search NCBI protein database
    handle = Entrez.esearch(db="protein", term=search_query, retmax=max_sequences)
    record = Entrez.read(handle)
    handle.close()
    ids = record["IdList"]

    if not ids:
        raise ValueError(f"No sequences found for query: {search_query}")

    # Fetch sequences in FASTA format
    handle = Entrez.efetch(db="protein", id=ids, rettype="fasta", retmode="text")
    fasta_data = handle.read()
    handle.close()

    # Upload to MinIO
    s3 = _get_s3_client()
    key = f"raw/{experiment_id}/sequences.fasta"
    s3.put_object(Bucket=BUCKET, Key=key, Body=fasta_data.encode(), ContentType="text/plain")

    return {"sequences_count": len(ids), "s3_key": key}


# ─── Task 2: Validate FASTA ─────────────────────────────
def validate_fasta(**context):
    from Bio import SeqIO
    import io

    ti = context["ti"]
    prev = ti.xcom_pull(task_ids="download_sequences")
    experiment_id = context["params"].get("experiment_id", "default")

    s3 = _get_s3_client()
    response = s3.get_object(Bucket=BUCKET, Key=prev["s3_key"])
    fasta_text = response["Body"].read().decode()

    valid_records = []
    for record in SeqIO.parse(io.StringIO(fasta_text), "fasta"):
        seq_str = str(record.seq)
        # Remove sequences with ambiguous characters > 10%
        ambiguous = sum(1 for c in seq_str if c in "XBZJx")
        if len(seq_str) > 50 and (ambiguous / len(seq_str)) < 0.1:
            valid_records.append(record)

    # Write validated FASTA
    output = io.StringIO()
    SeqIO.write(valid_records, output, "fasta")
    clean_fasta = output.getvalue()

    key = f"clean/{experiment_id}/sequences_clean.fasta"
    s3.put_object(Bucket=BUCKET, Key=key, Body=clean_fasta.encode(), ContentType="text/plain")

    return {"valid_count": len(valid_records), "s3_key": key}


# ─── Task 3: Spark Feature Engineering ──────────────────
def spark_feature_engineering(**context):
    ti = context["ti"]
    prev = ti.xcom_pull(task_ids="validate_fasta")
    experiment_id = context["params"].get("experiment_id", "default")

    result = subprocess.run(
        [
            "spark-submit",
            "--master", "local[*]",
            "/opt/spark/jobs/feature_engineering.py",
            "--input-bucket", BUCKET,
            "--input-key", prev["s3_key"],
            "--output-bucket", BUCKET,
            "--output-prefix", f"features/{experiment_id}",
            "--minio-endpoint", MINIO_ENDPOINT,
            "--minio-user", MINIO_USER,
            "--minio-password", MINIO_PASSWORD,
        ],
        capture_output=True, text=True, check=True,
    )

    return {"s3_prefix": f"features/{experiment_id}", "stdout": result.stdout[-500:]}


# ─── Task 4: Spark Similarity Matrix ────────────────────
def spark_similarity_matrix(**context):
    ti = context["ti"]
    experiment_id = context["params"].get("experiment_id", "default")

    result = subprocess.run(
        [
            "spark-submit",
            "--master", "local[*]",
            "/opt/spark/jobs/similarity_matrix.py",
            "--input-bucket", BUCKET,
            "--input-prefix", f"features/{experiment_id}",
            "--output-bucket", BUCKET,
            "--output-prefix", f"analysis/{experiment_id}",
            "--minio-endpoint", MINIO_ENDPOINT,
            "--minio-user", MINIO_USER,
            "--minio-password", MINIO_PASSWORD,
        ],
        capture_output=True, text=True, check=True,
    )

    return {"s3_prefix": f"analysis/{experiment_id}"}


# ─── Task 5: Multiple Sequence Alignment ────────────────
def run_alignment(**context):
    from Bio import SeqIO, AlignIO
    import io

    ti = context["ti"]
    prev = ti.xcom_pull(task_ids="validate_fasta")
    experiment_id = context["params"].get("experiment_id", "default")

    s3 = _get_s3_client()
    response = s3.get_object(Bucket=BUCKET, Key=prev["s3_key"])
    fasta_data = response["Body"].read()

    with tempfile.NamedTemporaryFile(suffix=".fasta", delete=False) as infile:
        infile.write(fasta_data)
        infile_path = infile.name

    outfile_path = infile_path.replace(".fasta", "_aligned.fasta")

    try:
        # Try MAFFT first (preferred)
        subprocess.run(
            ["mafft", "--auto", "--thread", "-1", infile_path],
            stdout=open(outfile_path, "w"),
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError:
        # Fallback: use MUSCLE if available, or Biopython ClustalW
        try:
            subprocess.run(
                ["muscle", "-in", infile_path, "-out", outfile_path],
                capture_output=True, check=True,
            )
        except FileNotFoundError:
            raise RuntimeError("Neither MAFFT nor MUSCLE found. Install alignment tools.")

    with open(outfile_path, "rb") as f:
        aligned_data = f.read()

    key = f"alignments/{experiment_id}/aligned.fasta"
    s3.put_object(Bucket=BUCKET, Key=key, Body=aligned_data, ContentType="text/plain")

    os.unlink(infile_path)
    os.unlink(outfile_path)

    return {"s3_key": key}


# ─── Task 6: Build Phylogenetic Tree ────────────────────
def build_tree(**context):
    ti = context["ti"]
    prev = ti.xcom_pull(task_ids="run_alignment")
    experiment_id = context["params"].get("experiment_id", "default")

    s3 = _get_s3_client()
    response = s3.get_object(Bucket=BUCKET, Key=prev["s3_key"])
    aligned_data = response["Body"].read()

    with tempfile.NamedTemporaryFile(suffix=".fasta", delete=False) as infile:
        infile.write(aligned_data)
        infile_path = infile.name

    tree_path = infile_path.replace(".fasta", ".nwk")

    try:
        # FastTree for protein sequences
        subprocess.run(
            ["FastTree", infile_path],
            stdout=open(tree_path, "w"),
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError:
        raise RuntimeError("FastTree not found. Install tree-building tools.")

    with open(tree_path, "rb") as f:
        tree_data = f.read()

    key = f"trees/{experiment_id}/phylo_tree.nwk"
    s3.put_object(Bucket=BUCKET, Key=key, Body=tree_data, ContentType="text/plain")

    os.unlink(infile_path)
    os.unlink(tree_path)

    return {"s3_key": key}


# ─── Task 7: Annotate Results ───────────────────────────
def annotate_results(**context):
    from Bio import Phylo
    import io

    ti = context["ti"]
    tree_result = ti.xcom_pull(task_ids="build_tree")
    feature_result = ti.xcom_pull(task_ids="spark_feature_engineering")
    experiment_id = context["params"].get("experiment_id", "default")

    s3 = _get_s3_client()

    # Read tree
    response = s3.get_object(Bucket=BUCKET, Key=tree_result["s3_key"])
    tree_text = response["Body"].read().decode()
    tree = Phylo.read(io.StringIO(tree_text), "newick")

    # Extract clades and basic stats
    terminals = tree.get_terminals()
    annotations = {
        "total_taxa": len(terminals),
        "tree_depth": tree.total_branch_length(),
        "taxa": [t.name for t in terminals],
        "clades": [],
    }

    # Identify major clades (internal nodes with > 2 children)
    for clade in tree.get_nonterminals():
        children = clade.get_terminals()
        if len(children) >= 3:
            annotations["clades"].append({
                "size": len(children),
                "taxa": [c.name for c in children],
                "branch_length": clade.branch_length or 0,
            })

    key = f"analysis/{experiment_id}/annotations.json"
    s3.put_object(
        Bucket=BUCKET, Key=key,
        Body=json.dumps(annotations, indent=2).encode(),
        ContentType="application/json",
    )

    return {"s3_key": key, "total_taxa": annotations["total_taxa"], "clades": len(annotations["clades"])}


# ─── Task 8: Generate Report ────────────────────────────
def generate_report(**context):
    from jinja2 import Template

    ti = context["ti"]
    experiment_id = context["params"].get("experiment_id", "default")
    annotations = ti.xcom_pull(task_ids="annotate_results")

    s3 = _get_s3_client()

    # Read annotations
    response = s3.get_object(Bucket=BUCKET, Key=annotations["s3_key"])
    annot_data = json.loads(response["Body"].read().decode())

    report_template = Template("""
    <!DOCTYPE html>
    <html>
    <head><title>PhyloSpark Report - {{ experiment_id }}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
        h1 { color: #2563eb; }
        .stat { background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 10px 0; }
        .clade { background: #f0fdf4; padding: 10px; border-left: 4px solid #22c55e; margin: 8px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
        th { background: #f9fafb; }
    </style>
    </head>
    <body>
        <h1>🧬 PhyloSpark Analysis Report</h1>
        <p>Experiment: <strong>{{ experiment_id }}</strong></p>
        <p>Generated: {{ timestamp }}</p>

        <div class="stat">
            <h3>Summary</h3>
            <ul>
                <li><strong>Total taxa:</strong> {{ total_taxa }}</li>
                <li><strong>Tree depth:</strong> {{ tree_depth | round(4) }}</li>
                <li><strong>Major clades identified:</strong> {{ clades | length }}</li>
            </ul>
        </div>

        <h2>Major Clades</h2>
        {% for clade in clades %}
        <div class="clade">
            <strong>Clade {{ loop.index }}</strong> ({{ clade.size }} taxa)
            <ul>
            {% for taxon in clade.taxa[:10] %}
                <li>{{ taxon }}</li>
            {% endfor %}
            {% if clade.taxa | length > 10 %}
                <li>... and {{ clade.taxa | length - 10 }} more</li>
            {% endif %}
            </ul>
        </div>
        {% endfor %}

        <h2>All Taxa</h2>
        <table>
            <tr><th>#</th><th>Taxon</th></tr>
            {% for taxon in taxa %}
            <tr><td>{{ loop.index }}</td><td>{{ taxon }}</td></tr>
            {% endfor %}
        </table>

        <footer><p><em>Generated by PhyloSpark v0.1 — Spark + Airflow + Biopython</em></p></footer>
    </body>
    </html>
    """)

    html = report_template.render(
        experiment_id=experiment_id,
        timestamp=datetime.now().isoformat(),
        total_taxa=annot_data["total_taxa"],
        tree_depth=annot_data.get("tree_depth", 0),
        clades=annot_data.get("clades", []),
        taxa=annot_data.get("taxa", []),
    )

    key = f"reports/{experiment_id}/report.html"
    s3.put_object(Bucket=BUCKET, Key=key, Body=html.encode(), ContentType="text/html")

    return {"s3_key": key}


# ─── DAG Definition ─────────────────────────────────────
default_args = {
    "owner": "phylospark",
    "retries": 1,
    "retry_delay": timedelta(minutes=2),
}

with DAG(
    dag_id="phylo_pipeline",
    default_args=default_args,
    description="End-to-end phylogenetic analysis pipeline",
    schedule_interval=None,  # Triggered via API
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["bioinformatics", "phylogenetics", "spark"],
    params={
        "experiment_id": "default",
        "query": "GH13 alpha-amylase",
        "organism": "",
        "max_sequences": 100,
    },
) as dag:

    t1 = PythonOperator(task_id="download_sequences", python_callable=download_sequences)
    t2 = PythonOperator(task_id="validate_fasta", python_callable=validate_fasta)
    t3 = PythonOperator(task_id="spark_feature_engineering", python_callable=spark_feature_engineering)
    t4 = PythonOperator(task_id="spark_similarity_matrix", python_callable=spark_similarity_matrix)
    t5 = PythonOperator(task_id="run_alignment", python_callable=run_alignment)
    t6 = PythonOperator(task_id="build_tree", python_callable=build_tree)
    t7 = PythonOperator(task_id="annotate_results", python_callable=annotate_results)
    t8 = PythonOperator(task_id="generate_report", python_callable=generate_report)

    # Pipeline flow:
    # Download → Validate → [Spark Features, Alignment] → Spark Similarity → Tree → Annotate → Report
    t1 >> t2
    t2 >> [t3, t5]           # Parallel: Spark features + alignment
    t3 >> t4                  # Spark similarity after features
    t5 >> t6                  # Tree after alignment
    [t4, t6] >> t7            # Annotate after both paths complete
    t7 >> t8                  # Report at the end
