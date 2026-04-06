"""
Spark Similarity Matrix Computation
====================================
Reads feature vectors from Parquet, computes pairwise distances:
- Euclidean distance on amino acid composition
- k-mer based Jaccard similarity

Outputs: CSV similarity matrix → MinIO
"""

import argparse
import json
from itertools import combinations

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.linalg import Vectors
import boto3
from botocore.client import Config
import math


AMINO_ACIDS = list("ACDEFGHIKLMNPQRSTVWY")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-bucket", required=True)
    parser.add_argument("--input-prefix", required=True)
    parser.add_argument("--output-bucket", required=True)
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--minio-endpoint", required=True)
    parser.add_argument("--minio-user", required=True)
    parser.add_argument("--minio-password", required=True)
    args = parser.parse_args()

    spark = SparkSession.builder \
        .appName("PhyloSpark-SimilarityMatrix") \
        .config("spark.jars.packages", "org.apache.hadoop:hadoop-aws:3.3.4") \
        .config("spark.hadoop.fs.s3a.endpoint", args.minio_endpoint) \
        .config("spark.hadoop.fs.s3a.access.key", args.minio_user) \
        .config("spark.hadoop.fs.s3a.secret.key", args.minio_password) \
        .config("spark.hadoop.fs.s3a.path.style.access", "true") \
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem") \
        .getOrCreate()

    try:
        # Read features
        input_path = f"s3a://{args.input_bucket}/{args.input_prefix}/features.parquet"
        df = spark.read.parquet(input_path)
        print(f"Loaded {df.count()} sequence features")

        # Assemble feature vector from AA compositions
        aa_cols = [f"aa_{aa}" for aa in AMINO_ACIDS]
        feature_cols = aa_cols + ["hydrophobic_frac", "charged_frac"]

        assembler = VectorAssembler(inputCols=feature_cols, outputCol="features")
        df_vec = assembler.transform(df).select("seq_id", "features")

        # Collect for pairwise comparison (feasible for < 5000 sequences)
        rows = df_vec.collect()
        n = len(rows)
        print(f"Computing {n*(n-1)//2} pairwise distances")

        # Compute distance matrix
        distances = []
        for i in range(n):
            for j in range(i + 1, n):
                vec_i = rows[i]["features"].toArray()
                vec_j = rows[j]["features"].toArray()
                dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(vec_i, vec_j)))
                distances.append({
                    "seq_a": rows[i]["seq_id"],
                    "seq_b": rows[j]["seq_id"],
                    "euclidean_distance": dist,
                })

        # Create DataFrame and write
        dist_df = spark.createDataFrame(distances)
        dist_df.show(10, truncate=False)

        output_path = f"s3a://{args.output_bucket}/{args.output_prefix}/distance_matrix.parquet"
        dist_df.write.mode("overwrite").parquet(output_path)
        print(f"Distance matrix written to {output_path}")

        # Write summary statistics
        stats = dist_df.agg(
            F.avg("euclidean_distance").alias("avg_distance"),
            F.min("euclidean_distance").alias("min_distance"),
            F.max("euclidean_distance").alias("max_distance"),
            F.stddev("euclidean_distance").alias("std_distance"),
            F.count("*").alias("total_pairs"),
        ).collect()[0]

        summary = {
            "total_sequences": n,
            "total_pairs": stats["total_pairs"],
            "avg_distance": stats["avg_distance"],
            "min_distance": stats["min_distance"],
            "max_distance": stats["max_distance"],
            "std_distance": stats["std_distance"],
        }

        # Upload summary JSON to MinIO
        s3 = boto3.client(
            "s3",
            endpoint_url=args.minio_endpoint,
            aws_access_key_id=args.minio_user,
            aws_secret_access_key=args.minio_password,
            config=Config(signature_version="s3v4"),
        )
        s3.put_object(
            Bucket=args.output_bucket,
            Key=f"{args.output_prefix}/distance_summary.json",
            Body=json.dumps(summary, indent=2).encode(),
            ContentType="application/json",
        )
        print(f"Summary: {summary}")

    finally:
        spark.stop()


if __name__ == "__main__":
    main()
