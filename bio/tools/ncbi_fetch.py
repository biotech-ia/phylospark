"""
NCBI Sequence Fetcher
=====================
Downloads protein/nucleotide sequences from NCBI Entrez.
Used by the Airflow DAG and can be run standalone for testing.
"""

import os
import sys
from typing import Optional
from Bio import Entrez, SeqIO


def search_ncbi(
    query: str,
    db: str = "protein",
    max_results: int = 100,
    organism: Optional[str] = None,
    email: Optional[str] = None,
) -> list[str]:
    """Search NCBI and return a list of sequence IDs."""
    Entrez.email = email or os.environ.get("NCBI_EMAIL", "phylospark@example.com")
    api_key = os.environ.get("NCBI_API_KEY", "")
    if api_key:
        Entrez.api_key = api_key

    search_term = f"{query}[Title]"
    if organism:
        search_term += f" AND {organism}[Organism]"

    handle = Entrez.esearch(db=db, term=search_term, retmax=max_results)
    record = Entrez.read(handle)
    handle.close()

    return record.get("IdList", [])


def fetch_sequences(
    ids: list[str],
    db: str = "protein",
    rettype: str = "fasta",
) -> str:
    """Fetch sequences in FASTA format given a list of IDs."""
    if not ids:
        return ""

    handle = Entrez.efetch(db=db, id=ids, rettype=rettype, retmode="text")
    data = handle.read()
    handle.close()
    return data


def download_and_save(
    query: str,
    output_path: str,
    db: str = "protein",
    max_results: int = 100,
    organism: Optional[str] = None,
) -> int:
    """Search, download, and save sequences to a file. Returns count."""
    ids = search_ncbi(query, db=db, max_results=max_results, organism=organism)
    if not ids:
        print(f"No sequences found for: {query}")
        return 0

    fasta_data = fetch_sequences(ids, db=db)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        f.write(fasta_data)

    # Count sequences
    count = fasta_data.count(">")
    print(f"Downloaded {count} sequences to {output_path}")
    return count


if __name__ == "__main__":
    # Quick test
    query = sys.argv[1] if len(sys.argv) > 1 else "GH13 alpha-amylase"
    max_seq = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    output = sys.argv[3] if len(sys.argv) > 3 else "test_sequences.fasta"

    count = download_and_save(query, output, max_results=max_seq)
    print(f"Done: {count} sequences")
