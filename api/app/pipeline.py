"""
PhyloSpark Pipeline Runner
===========================
Executes the full phylogenetic analysis pipeline as a background task
inside the FastAPI process. Steps:

  1. Download sequences from NCBI (Entrez)
  2. Validate & clean FASTA
  3. Feature engineering (amino acid composition, hydrophobic/charged fractions)
  4. Pairwise distance matrix
  5. Multiple sequence alignment (MAFFT subprocess, with BioPython fallback)
  6. Phylogenetic tree (Neighbor-Joining via BioPython)
  7. Upload results to MinIO
  8. Mark experiment complete

Each step updates the experiment status and writes persistent logs.
"""

import asyncio
import io
import json
import logging
import subprocess
import tempfile
import os
import traceback
from datetime import datetime, timezone

from Bio import Entrez, SeqIO
from Bio.SeqUtils.ProtParam import ProteinAnalysis
from Bio.Phylo.TreeConstruction import DistanceCalculator, DistanceTreeConstructor
from Bio.Phylo.TreeConstruction import DistanceMatrix
from Bio import Phylo

from app.database import SessionLocal
from app.models import Experiment, ExperimentStatus, ExperimentLog
from app.storage import get_minio_client, upload_file
from app.config import get_settings

logger = logging.getLogger(__name__)

# Standard amino acids
AMINO_ACIDS = list("ACDEFGHIKLMNPQRSTVWY")
HYDROPHOBIC = set("AILMFWV")
CHARGED = set("DEKRH")


def _log(experiment_id: int, message: str, step: str = "", level: str = "info"):
    """Persist a log entry to DB."""
    db = SessionLocal()
    try:
        entry = ExperimentLog(
            experiment_id=experiment_id,
            level=level,
            step=step,
            message=message,
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        logger.error(f"Log persistence failed: {e}")
        db.rollback()
    finally:
        db.close()


def _set_status(experiment_id: int, status: ExperimentStatus, error_message: str = None):
    """Update experiment status in DB."""
    db = SessionLocal()
    try:
        exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        if exp:
            exp.status = status
            if error_message:
                exp.error_message = error_message
            if status == ExperimentStatus.COMPLETE:
                exp.completed_at = datetime.now(timezone.utc)
            db.commit()
    except Exception as e:
        logger.error(f"Status update failed: {e}")
        db.rollback()
    finally:
        db.close()


def _is_cancelled(experiment_id: int) -> bool:
    """Check if user cancelled the experiment."""
    db = SessionLocal()
    try:
        exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        return exp and exp.status == ExperimentStatus.CANCELLED
    finally:
        db.close()


# ─── Step 1: Download sequences from NCBI ─────────────────────
def step_download(experiment_id: int, query: str, organism: str, max_sequences: int, selected_sequences: list) -> str:
    """Download FASTA sequences from NCBI. Returns raw FASTA string."""
    _set_status(experiment_id, ExperimentStatus.DOWNLOADING)
    _log(experiment_id, f"Starting sequence download: query='{query}', organism='{organism}'", "download")

    settings = get_settings()
    Entrez.email = settings.ncbi_email or "phylospark@example.com"
    if settings.ncbi_api_key:
        Entrez.api_key = settings.ncbi_api_key

    # If we have selected accessions, fetch those directly
    if selected_sequences and len(selected_sequences) > 0:
        _log(experiment_id, f"Fetching {len(selected_sequences)} pre-selected accessions from NCBI", "download")
        handle = Entrez.efetch(
            db="protein",
            id=",".join(selected_sequences),
            rettype="fasta",
            retmode="text",
        )
        fasta_data = handle.read()
        handle.close()
    else:
        # Search + fetch
        search_query = f"{query}[Title]"
        if organism:
            search_query += f" AND {organism}[Organism]"

        _log(experiment_id, f"Searching NCBI: {search_query}", "download")
        handle = Entrez.esearch(db="protein", term=search_query, retmax=max_sequences)
        record = Entrez.read(handle)
        handle.close()
        ids = record["IdList"]

        if not ids:
            raise ValueError(f"No sequences found for: {search_query}")

        _log(experiment_id, f"Found {len(ids)} sequence IDs, downloading FASTA...", "download")
        handle = Entrez.efetch(db="protein", id=ids, rettype="fasta", retmode="text")
        fasta_data = handle.read()
        handle.close()

    # Count sequences
    records = list(SeqIO.parse(io.StringIO(fasta_data), "fasta"))
    _log(experiment_id, f"Downloaded {len(records)} sequences from NCBI", "download", "success")

    # Upload raw FASTA to MinIO
    client = get_minio_client()
    key = f"experiments/{experiment_id}/raw_sequences.fasta"
    upload_file(client, "phylospark-raw", key, fasta_data.encode(), "text/plain")
    _log(experiment_id, f"Raw FASTA uploaded to MinIO: {key}", "download")

    return fasta_data


# ─── Step 2: Validate & clean FASTA ───────────────────────────
def step_validate(experiment_id: int, fasta_data: str) -> list:
    """Validate and clean sequences. Returns list of SeqRecord."""
    _log(experiment_id, "Validating and cleaning sequences...", "validate")

    records = list(SeqIO.parse(io.StringIO(fasta_data), "fasta"))
    valid = []
    skipped = 0

    for record in records:
        seq_str = str(record.seq).upper()
        # Skip very short sequences
        if len(seq_str) < 30:
            skipped += 1
            continue
        # Skip sequences with too many ambiguous characters
        ambiguous = sum(1 for c in seq_str if c not in AMINO_ACIDS and c != "-" and c != "*")
        if len(seq_str) > 0 and (ambiguous / len(seq_str)) > 0.15:
            skipped += 1
            continue
        valid.append(record)

    _log(experiment_id, f"Validation complete: {len(valid)} valid, {skipped} skipped", "validate", "success")

    # Upload clean FASTA to MinIO
    output = io.StringIO()
    SeqIO.write(valid, output, "fasta")
    clean_fasta = output.getvalue()

    client = get_minio_client()
    key = f"experiments/{experiment_id}/sequences_clean.fasta"
    upload_file(client, "phylospark-raw", key, clean_fasta.encode(), "text/plain")

    return valid


# ─── Step 3: Feature engineering (PySpark) ───────────────────
def step_features(experiment_id: int, records: list) -> list:
    """Compute per-sequence features using Apache Spark for distributed processing."""
    _set_status(experiment_id, ExperimentStatus.PROCESSING)
    _log(experiment_id, f"🔥 Starting Spark Feature Engineering for {len(records)} sequences...", "features")
    _log(experiment_id, "ENGINE: Apache Spark (local mode) | Initializing SparkSession...", "features")

    import time
    from pyspark.sql import SparkSession
    from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType

    t0 = time.time()

    # Create SparkSession
    spark = SparkSession.builder \
        .appName(f"PhyloSpark-Features-Exp{experiment_id}") \
        .master("local[*]") \
        .config("spark.driver.memory", "512m") \
        .config("spark.ui.enabled", "true") \
        .config("spark.ui.port", "4040") \
        .config("spark.ui.proxyBase", "/spark") \
        .config("spark.sql.shuffle.partitions", "4") \
        .getOrCreate()

    sc = spark.sparkContext
    _log(experiment_id, f"✅ SparkSession created | App: {sc.appName} | Master: {sc.master} | Cores: {sc.defaultParallelism}", "features", "success")
    _log(experiment_id, "🌐 Spark UI available at /spark/ while pipeline runs", "features")

    try:
        # Prepare sequence data for Spark
        seq_data = []
        for record in records:
            seq_str = str(record.seq).upper().replace("*", "").replace("-", "").replace("X", "")
            if len(seq_str) >= 10:
                seq_id = record.id[:20] if len(record.id) > 20 else record.id
                seq_data.append((seq_id, seq_str))

        num_seqs = len(seq_data)
        num_partitions = min(max(num_seqs // 25, 2), 8)  # 2-8 partitions
        _log(experiment_id, f"📊 Distributing {num_seqs} sequences across {num_partitions} Spark partitions", "features")

        # Create RDD and distribute computation
        seq_rdd = sc.parallelize(seq_data, num_partitions)
        _log(experiment_id, f"📦 RDD created: {seq_rdd.getNumPartitions()} partitions | {seq_rdd.count()} records", "features")

        # Map: compute features per sequence (distributed)
        def compute_features_spark(item):
            seq_id, seq_str = item
            length = len(seq_str)
            from collections import Counter
            counts = Counter(seq_str)
            aa_list = list("ACDEFGHIKLMNPQRSTVWY")
            hydrophobic_set = set("AILMFWV")
            charged_set = set("DEKRH")

            feat = {"seq_id": seq_id, "length": length}
            for aa in aa_list:
                feat[f"aa_{aa}"] = round(counts.get(aa, 0) / max(length, 1), 4)
            feat["hydrophobic_frac"] = round(sum(1 for c in seq_str if c in hydrophobic_set) / max(length, 1), 4)
            feat["charged_frac"] = round(sum(1 for c in seq_str if c in charged_set) / max(length, 1), 4)
            feat["molecular_weight"] = round(length * 110.0, 1)
            feat["isoelectric_point"] = 0.0
            # k-mer computation (additional Spark-specific feature)
            kmers_2 = Counter()
            for i in range(len(seq_str) - 1):
                kmers_2[seq_str[i:i+2]] += 1
            feat["unique_2mers"] = len(kmers_2)
            return feat

        t_map_start = time.time()
        features_rdd = seq_rdd.map(compute_features_spark)
        features = features_rdd.collect()  # Action triggers computation
        t_map_end = time.time()

        map_time = round(t_map_end - t_map_start, 2)
        _log(experiment_id, f"⚡ Spark MAP completed: {len(features)} features in {map_time}s | {num_partitions} partitions", "features", "success")

        # Spark DataFrame for statistics
        df = spark.createDataFrame(features)
        row_count = df.count()
        _log(experiment_id, f"📋 Spark DataFrame: {row_count} rows × {len(df.columns)} columns", "features")

        # Compute aggregate statistics with Spark SQL
        df.createOrReplaceTempView("features")
        stats = spark.sql("""
            SELECT
                COUNT(*) as total_sequences,
                ROUND(AVG(length), 1) as avg_length,
                MIN(length) as min_length,
                MAX(length) as max_length,
                ROUND(AVG(hydrophobic_frac), 4) as avg_hydrophobic,
                ROUND(AVG(charged_frac), 4) as avg_charged,
                ROUND(AVG(unique_2mers), 0) as avg_2mers
            FROM features
        """).collect()[0]

        _log(experiment_id,
             f"📈 Spark SQL Stats: {stats.total_sequences} seqs | "
             f"Avg length: {stats.avg_length} | "
             f"Avg hydrophobic: {stats.avg_hydrophobic} | "
             f"Avg 2-mers: {stats.avg_2mers}",
             "features", "success")

        # Upload features to MinIO
        client = get_minio_client()
        key = f"experiments/{experiment_id}/features.json"
        upload_file(client, "phylospark-features", key, json.dumps(features, indent=2).encode(), "application/json")

        total_time = round(time.time() - t0, 2)
        _log(experiment_id,
             f"🏁 Spark Feature Engineering COMPLETE: {len(features)} sequences | "
             f"{num_partitions} partitions | "
             f"Total: {total_time}s (map: {map_time}s)",
             "features", "success")

        return features

    finally:
        spark.stop()
        _log(experiment_id, "SparkSession stopped", "features")


# ─── Step 4: Pairwise distance matrix (PySpark) ──────────────
def step_distances(experiment_id: int, records: list, features: list) -> list:
    """Compute pairwise Euclidean distance using Apache Spark."""
    _log(experiment_id, "🔥 Starting Spark Distance Matrix computation...", "distances")
    _log(experiment_id, "ENGINE: Apache Spark (local mode) | Creating SparkSession...", "distances")

    import time
    import math
    from pyspark.sql import SparkSession
    from pyspark.sql import functions as F
    from itertools import combinations

    t0 = time.time()

    spark = SparkSession.builder \
        .appName(f"PhyloSpark-Distances-Exp{experiment_id}") \
        .master("local[*]") \
        .config("spark.driver.memory", "512m") \
        .config("spark.ui.enabled", "true") \
        .config("spark.ui.port", "4040") \
        .config("spark.ui.proxyBase", "/spark") \
        .config("spark.sql.shuffle.partitions", "4") \
        .getOrCreate()

    sc = spark.sparkContext
    n = len(features)
    total_pairs = n * (n - 1) // 2
    _log(experiment_id, f"✅ SparkSession created | {n} sequences → {total_pairs} pairwise comparisons", "distances", "success")

    try:
        # Build feature vectors
        vectors = {}
        for feat in features:
            vec = [feat.get(f"aa_{aa}", 0) for aa in AMINO_ACIDS]
            vec.append(feat.get("hydrophobic_frac", 0))
            vec.append(feat.get("charged_frac", 0))
            vectors[feat["seq_id"]] = vec

        seq_ids = list(vectors.keys())

        # Generate all pairs and distribute with Spark
        pairs = list(combinations(range(n), 2))
        num_partitions = min(max(len(pairs) // 100, 2), 8)
        _log(experiment_id, f"📊 Distributing {len(pairs)} pairs across {num_partitions} Spark partitions", "distances")

        # Broadcast vectors for efficient access
        bc_vectors = sc.broadcast(vectors)
        bc_seq_ids = sc.broadcast(seq_ids)

        pairs_rdd = sc.parallelize(pairs, num_partitions)
        _log(experiment_id, f"📦 RDD created: {pairs_rdd.getNumPartitions()} partitions | Broadcast vectors: {len(seq_ids)} × {len(next(iter(vectors.values())))} dims", "distances")

        # Map: compute distance per pair (distributed)
        def compute_distance(pair):
            i, j = pair
            vecs = bc_vectors.value
            ids = bc_seq_ids.value
            va = vecs[ids[i]]
            vb = vecs[ids[j]]
            dist = sum((a - b) ** 2 for a, b in zip(va, vb)) ** 0.5
            return {"seq_a": ids[i], "seq_b": ids[j], "euclidean_distance": round(dist, 6)}

        t_map_start = time.time()
        distances_rdd = pairs_rdd.map(compute_distance)
        distances = distances_rdd.collect()
        t_map_end = time.time()

        map_time = round(t_map_end - t_map_start, 2)
        _log(experiment_id, f"⚡ Spark MAP completed: {len(distances)} distance pairs in {map_time}s", "distances", "success")

        # Create DataFrame and compute summary statistics
        dist_df = spark.createDataFrame(distances)
        dist_df.createOrReplaceTempView("distances")

        stats = spark.sql("""
            SELECT
                COUNT(*) as total_pairs,
                ROUND(AVG(euclidean_distance), 6) as avg_distance,
                ROUND(MIN(euclidean_distance), 6) as min_distance,
                ROUND(MAX(euclidean_distance), 6) as max_distance,
                ROUND(STDDEV(euclidean_distance), 6) as std_distance
            FROM distances
        """).collect()[0]

        _log(experiment_id,
             f"📈 Spark SQL Stats: {stats.total_pairs} pairs | "
             f"Avg dist: {stats.avg_distance} | "
             f"Range: [{stats.min_distance}, {stats.max_distance}] | "
             f"StdDev: {stats.std_distance}",
             "distances", "success")

        # Upload to MinIO
        client = get_minio_client()
        key = f"experiments/{experiment_id}/distances.json"
        upload_file(client, "phylospark-features", key, json.dumps(distances, indent=2).encode(), "application/json")

        total_time = round(time.time() - t0, 2)
        _log(experiment_id,
             f"🏁 Spark Distance Matrix COMPLETE: {len(distances)} pairs | "
             f"{num_partitions} partitions | "
             f"Total: {total_time}s (map: {map_time}s)",
             "distances", "success")

        return distances

    finally:
        spark.stop()
        _log(experiment_id, "SparkSession stopped", "distances")


# ─── Step 5: Multiple Sequence Alignment ─────────────────────
def step_alignment(experiment_id: int, records: list) -> str:
    """Run MSA. Tries MAFFT first, falls back to simple gap-padded alignment."""
    _set_status(experiment_id, ExperimentStatus.ALIGNING)
    _log(experiment_id, f"Starting multiple sequence alignment ({len(records)} sequences)...", "alignment")

    # Write input FASTA to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as infile:
        SeqIO.write(records, infile, "fasta")
        infile_path = infile.name

    outfile_path = infile_path.replace(".fasta", "_aligned.fasta")
    aligned_fasta = None

    try:
        # Try MAFFT (installed in Docker image)
        result = subprocess.run(
            ["mafft", "--auto", "--quiet", infile_path],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0 and result.stdout.strip():
            aligned_fasta = result.stdout
            _log(experiment_id, "MAFFT alignment completed successfully", "alignment", "success")
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        _log(experiment_id, f"MAFFT not available ({e}), using fallback alignment", "alignment", "warning")

    if not aligned_fasta:
        try:
            # Try MUSCLE
            result = subprocess.run(
                ["muscle", "-in", infile_path, "-out", outfile_path],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0 and os.path.exists(outfile_path):
                with open(outfile_path) as f:
                    aligned_fasta = f.read()
                _log(experiment_id, "MUSCLE alignment completed successfully", "alignment", "success")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    if not aligned_fasta:
        # Fallback: pad sequences to same length (simple pseudo-alignment for display)
        _log(experiment_id, "Using padded alignment fallback (no MSA binary available)", "alignment", "warning")
        max_len = max(len(str(r.seq)) for r in records) if records else 0
        lines = []
        for r in records:
            seq = str(r.seq)
            padded = seq + "-" * (max_len - len(seq))
            lines.append(f">{r.id} {r.description}")
            lines.append(padded)
        aligned_fasta = "\n".join(lines) + "\n"

    # Upload alignment to MinIO
    client = get_minio_client()
    key = f"experiments/{experiment_id}/alignment.fasta"
    upload_file(client, "phylospark-alignments", key, aligned_fasta.encode(), "text/plain")
    _log(experiment_id, "Alignment uploaded to MinIO", "alignment")

    # Cleanup temp files
    try:
        os.unlink(infile_path)
        if os.path.exists(outfile_path):
            os.unlink(outfile_path)
    except OSError:
        pass

    return aligned_fasta


# ─── Step 6: Build phylogenetic tree ─────────────────────────
def step_tree(experiment_id: int, records: list, distances: list) -> str:
    """Build NJ tree from distance matrix using BioPython. Returns Newick string."""
    _set_status(experiment_id, ExperimentStatus.BUILDING_TREE)
    _log(experiment_id, "Building phylogenetic tree (Neighbor-Joining)...", "tree")

    # Build BioPython DistanceMatrix from our computed distances
    seq_ids = []
    seen = set()
    for d in distances:
        if d["seq_a"] not in seen:
            seq_ids.append(d["seq_a"])
            seen.add(d["seq_a"])
        if d["seq_b"] not in seen:
            seq_ids.append(d["seq_b"])
            seen.add(d["seq_b"])

    n = len(seq_ids)
    if n < 3:
        _log(experiment_id, "Not enough sequences for tree building (need >= 3)", "tree", "warning")
        # Generate a minimal tree
        newick = "(" + ",".join(f"{s}:0.1" for s in seq_ids) + ");"
    else:
        idx = {name: i for i, name in enumerate(seq_ids)}

        # Build lower triangular matrix for BioPython
        matrix = []
        for i in range(n):
            row = [0.0] * (i + 1)
            matrix.append(row)

        dist_lookup = {}
        for d in distances:
            key = (d["seq_a"], d["seq_b"])
            dist_lookup[key] = d["euclidean_distance"]
            dist_lookup[(d["seq_b"], d["seq_a"])] = d["euclidean_distance"]

        for i in range(n):
            for j in range(i):
                key = (seq_ids[i], seq_ids[j])
                matrix[i][j] = dist_lookup.get(key, 0.5)

        # Sanitize names for Newick compatibility (remove special chars)
        safe_names = []
        for name in seq_ids:
            safe = name.replace("(", "_").replace(")", "_").replace(",", "_").replace(":", "_").replace(";", "_")
            safe_names.append(safe)

        dm = DistanceMatrix(safe_names, matrix)
        constructor = DistanceTreeConstructor()
        tree = constructor.nj(dm)

        # Export as Newick
        output = io.StringIO()
        Phylo.write(tree, output, "newick")
        newick = output.getvalue().strip()

    # Upload tree to MinIO
    client = get_minio_client()
    key = f"experiments/{experiment_id}/tree.nwk"
    upload_file(client, "phylospark-trees", key, newick.encode(), "text/plain")

    _log(experiment_id, f"Phylogenetic tree built: {n} taxa, Neighbor-Joining method", "tree", "success")
    return newick


# ─── Step 7: Store results in experiment metadata ────────────
def step_finalize(experiment_id: int, newick: str, aligned_fasta: str, features: list, distances: list):
    """Store result references and mark experiment complete."""
    _log(experiment_id, "Finalizing experiment results...", "finalize")

    db = SessionLocal()
    try:
        exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        if exp:
            exp.result_tree_path = f"phylospark-trees/experiments/{experiment_id}/tree.nwk"
            exp.result_report_path = f"phylospark-features/experiments/{experiment_id}/features.json"
            # Store small results inline in metadata for quick access
            exp.metadata_ = {
                "newick": newick,
                "alignment": aligned_fasta[:50000] if len(aligned_fasta) > 50000 else aligned_fasta,
                "features": features,
                "distances": distances,
                "taxa_count": len(features),
                "distance_pairs": len(distances),
            }
            exp.status = ExperimentStatus.COMPLETE
            exp.completed_at = datetime.now(timezone.utc)
            db.commit()
    except Exception as e:
        logger.error(f"Finalize failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()

    _log(experiment_id, "Pipeline completed successfully!", "finalize", "success")


# ─── Main pipeline orchestrator ───────────────────────────────
def run_pipeline(experiment_id: int):
    """Execute the full pipeline synchronously. Called from a background thread."""
    db = SessionLocal()
    try:
        exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        if not exp:
            logger.error(f"Experiment {experiment_id} not found")
            return

        query = exp.query
        organism = exp.organism or ""
        max_sequences = exp.max_sequences or 100
        selected_sequences = exp.selected_sequences or []
    finally:
        db.close()

    try:
        # Step 1: Download
        fasta_data = step_download(experiment_id, query, organism, max_sequences, selected_sequences)
        if _is_cancelled(experiment_id):
            _log(experiment_id, "Pipeline cancelled by user", "cancel", "warning")
            return

        # Step 2: Validate
        records = step_validate(experiment_id, fasta_data)
        if not records:
            raise ValueError("No valid sequences after QC filtering")
        if _is_cancelled(experiment_id):
            _log(experiment_id, "Pipeline cancelled by user", "cancel", "warning")
            return

        # Step 3: Feature engineering
        features = step_features(experiment_id, records)
        if _is_cancelled(experiment_id):
            _log(experiment_id, "Pipeline cancelled by user", "cancel", "warning")
            return

        # Step 4: Distance matrix
        distances = step_distances(experiment_id, records, features)
        if _is_cancelled(experiment_id):
            _log(experiment_id, "Pipeline cancelled by user", "cancel", "warning")
            return

        # Step 5: Alignment
        aligned_fasta = step_alignment(experiment_id, records)
        if _is_cancelled(experiment_id):
            _log(experiment_id, "Pipeline cancelled by user", "cancel", "warning")
            return

        # Step 6: Tree building
        newick = step_tree(experiment_id, records, distances)
        if _is_cancelled(experiment_id):
            _log(experiment_id, "Pipeline cancelled by user", "cancel", "warning")
            return

        # Step 7: Finalize
        step_finalize(experiment_id, newick, aligned_fasta, features, distances)

    except Exception as e:
        logger.error(f"Pipeline failed for experiment {experiment_id}: {e}\n{traceback.format_exc()}")
        _set_status(experiment_id, ExperimentStatus.FAILED, str(e))
        _log(experiment_id, f"Pipeline failed: {e}", "error", "error")
