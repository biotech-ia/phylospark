"""
Phylogenetic Tree Builder
=========================
Wraps FastTree and IQ-TREE for tree construction from aligned sequences.
"""

import os
import subprocess
import shutil
from typing import Optional


def find_tree_tool() -> Optional[str]:
    """Detect available tree-building tool."""
    for tool in ["FastTree", "fasttree", "iqtree", "iqtree2"]:
        if shutil.which(tool):
            return tool
    return None


def build_fasttree(input_path: str, output_path: str, protein: bool = True) -> str:
    """Build tree with FastTree."""
    cmd = ["FastTree"] if shutil.which("FastTree") else ["fasttree"]
    if not protein:
        cmd.append("-nt")

    with open(output_path, "w") as outf:
        subprocess.run(
            cmd + [input_path],
            stdout=outf,
            stderr=subprocess.PIPE,
            check=True,
        )
    return output_path


def build_iqtree(input_path: str, output_path: str, protein: bool = True) -> str:
    """Build tree with IQ-TREE."""
    cmd_name = "iqtree2" if shutil.which("iqtree2") else "iqtree"
    prefix = output_path.replace(".nwk", "")

    subprocess.run(
        [cmd_name, "-s", input_path, "-m", "TEST", "--prefix", prefix, "-T", "AUTO"],
        capture_output=True,
        check=True,
    )

    treefile = f"{prefix}.treefile"
    if os.path.exists(treefile):
        os.rename(treefile, output_path)
    return output_path


def build_tree(input_path: str, output_path: Optional[str] = None, tool: Optional[str] = None, protein: bool = True) -> str:
    """
    Build phylogenetic tree using best available tool.
    Returns path to Newick tree file.
    """
    if output_path is None:
        base = os.path.splitext(input_path)[0]
        output_path = f"{base}.nwk"

    if tool is None:
        tool = find_tree_tool()

    if tool in ("FastTree", "fasttree"):
        return build_fasttree(input_path, output_path, protein)
    elif tool in ("iqtree", "iqtree2"):
        return build_iqtree(input_path, output_path, protein)
    else:
        raise RuntimeError(
            "No tree-building tool found. Install FastTree (recommended) or IQ-TREE:\n"
            "  apt-get install fasttree  # or\n"
            "  conda install -c bioconda fasttree"
        )


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python tree_builder.py <aligned.fasta> [output.nwk]")
        sys.exit(1)

    inp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    tool = find_tree_tool()
    print(f"Using tree tool: {tool or 'NONE FOUND'}")

    if tool:
        result = build_tree(inp, out)
        print(f"Tree written to: {result}")
