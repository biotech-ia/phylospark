"""
Spark Feature Engineering for Protein Sequences
================================================
Reads FASTA from MinIO, computes:
- Sequence length
- Amino acid composition (20 aa)
- k-mer frequencies (k=2,3)
- Molecular weight estimate
- Isoelectric point category

Outputs: Parquet with features per sequence → MinIO
"""

import argparse
import io
import sys
from collections import Counter

from pyspark.sql import SparkSession
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType, ArrayType
import boto3
from botocore.client import Config


AMINO_ACIDS = list("ACDEFGHIKLMNPQRSTVWY")


def parse_fasta_from_s3(endpoint, user, password, bucket, key):
    """Download and parse FASTA from MinIO."""
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=user,
        aws_secret_access_key=password,
        config=Config(signature_version="s3v4"),
    )
    response = client.get_object(Bucket=bucket, Key=key)
    text = response["Body"].read().decode()

    sequences = []
    current_id = None
    current_seq = []

    for line in text.strip().split("\n"):
        if line.startswith(">"):
            if current_id:
                sequences.append((current_id, "".join(current_seq)))
            current_id = line[1:].split()[0]
            current_seq = []
        else:
            current_seq.append(line.strip())

    if current_id:
        sequences.append((current_id, "".join(current_seq)))

    return sequences


def compute_features(seq_id, sequence):
    """Compute features for a single protein sequence."""
    seq_upper = sequence.upper()
    length = len(seq_upper)

    # Amino acid composition (fraction)
    counts = Counter(seq_upper)
    aa_comp = {aa: counts.get(aa, 0) / max(length, 1) for aa in AMINO_ACIDS}

    # k-mer frequencies (k=2)
    kmers_2 = Counter()
    for i in range(len(seq_upper) - 1):
        kmers_2[seq_upper[i:i+2]] += 1
    total_2mers = max(sum(kmers_2.values()), 1)

    # k-mer frequencies (k=3)
    kmers_3 = Counter()
    for i in range(len(seq_upper) - 2):
        kmers_3[seq_upper[i:i+3]] += 1
    total_3mers = max(sum(kmers_3.values()), 1)

    # Molecular weight estimate (average aa MW ~110 Da)
    mw_estimate = length * 110.0

    # Hydrophobic fraction
    hydrophobic = set("AILMFWVP")
    hydro_frac = sum(1 for c in seq_upper if c in hydrophobic) / max(length, 1)

    # Charged fraction
    charged = set("DEKRH")
    charged_frac = sum(1 for c in seq_upper if c in charged) / max(length, 1)

    return {
        "seq_id": seq_id,
        "length": length,
        "mw_estimate": mw_estimate,
        "hydrophobic_frac": hydro_frac,
        "charged_frac": charged_frac,
        **{f"aa_{aa}": aa_comp[aa] for aa in AMINO_ACIDS},
        "unique_2mers": len(kmers_2),
        "unique_3mers": len(kmers_3),
        "top_2mer": kmers_2.most_common(1)[0][0] if kmers_2 else "",
        "top_3mer": kmers_3.most_common(1)[0][0] if kmers_3 else "",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-bucket", required=True)
    parser.add_argument("--input-key", required=True)
    parser.add_argument("--output-bucket", required=True)
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--minio-endpoint", required=True)
    parser.add_argument("--minio-user", required=True)
    parser.add_argument("--minio-password", required=True)
    args = parser.parse_args()

    spark = SparkSession.builder \
        .appName("PhyloSpark-FeatureEngineering") \
        .config("spark.jars.packages", "org.apache.hadoop:hadoop-aws:3.3.4") \
        .config("spark.hadoop.fs.s3a.endpoint", args.minio_endpoint) \
        .config("spark.hadoop.fs.s3a.access.key", args.minio_user) \
        .config("spark.hadoop.fs.s3a.secret.key", args.minio_password) \
        .config("spark.hadoop.fs.s3a.path.style.access", "true") \
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem") \
        .getOrCreate()

    try:
        # Parse sequences from MinIO
        sequences = parse_fasta_from_s3(
            args.minio_endpoint, args.minio_user, args.minio_password,
            args.input_bucket, args.input_key,
        )
        print(f"Loaded {len(sequences)} sequences")

        # Compute features
        features = [compute_features(sid, seq) for sid, seq in sequences]
        print(f"Computed features for {len(features)} sequences")

        # Create Spark DataFrame
        df = spark.createDataFrame(features)
        df.show(5, truncate=False)
        df.printSchema()

        # Write as Parquet to MinIO
        output_path = f"s3a://{args.output_bucket}/{args.output_prefix}/features.parquet"
        df.write.mode("overwrite").parquet(output_path)
        print(f"Features written to {output_path}")

        # Also write summary stats
        summary = df.describe()
        summary_path = f"s3a://{args.output_bucket}/{args.output_prefix}/summary.parquet"
        summary.write.mode("overwrite").parquet(summary_path)
        print(f"Summary written to {summary_path}")

    finally:
        spark.stop()


if __name__ == "__main__":
    main()
