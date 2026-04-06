"""
Multiple Sequence Alignment Wrapper
====================================
Wraps MAFFT and MUSCLE for protein sequence alignment.
Falls back gracefully if preferred tool is unavailable.
"""

import os
import subprocess
import shutil
import tempfile
from typing import Optional


def find_alignment_tool() -> Optional[str]:
    """Detect available alignment tool."""
    for tool in ["mafft", "muscle"]:
        if shutil.which(tool):
            return tool
    return None


def align_mafft(input_path: str, output_path: str, threads: int = -1) -> str:
    """Run MAFFT alignment."""
    with open(output_path, "w") as outf:
        result = subprocess.run(
            ["mafft", "--auto", "--thread", str(threads), input_path],
            stdout=outf,
            stderr=subprocess.PIPE,
            check=True,
        )
    return output_path


def align_muscle(input_path: str, output_path: str) -> str:
    """Run MUSCLE alignment."""
    subprocess.run(
        ["muscle", "-in", input_path, "-out", output_path],
        capture_output=True,
        check=True,
    )
    return output_path


def align_sequences(input_path: str, output_path: Optional[str] = None, tool: Optional[str] = None) -> str:
    """
    Align sequences using the best available tool.
    Returns path to aligned FASTA file.
    """
    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_aligned{ext}"

    if tool is None:
        tool = find_alignment_tool()

    if tool == "mafft":
        return align_mafft(input_path, output_path)
    elif tool == "muscle":
        return align_muscle(input_path, output_path)
    else:
        raise RuntimeError(
            "No alignment tool found. Install MAFFT (recommended) or MUSCLE:\n"
            "  apt-get install mafft  # or\n"
            "  conda install -c bioconda mafft"
        )


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python alignment.py <input.fasta> [output.fasta]")
        sys.exit(1)

    inp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    tool = find_alignment_tool()
    print(f"Using alignment tool: {tool or 'NONE FOUND'}")

    if tool:
        result = align_sequences(inp, out)
        print(f"Alignment written to: {result}")
