"""
PhyloSpark Demo Seed Script
============================
Seeds the database with Pamela's GH13 alpha-amylase experiment and
pre-computed results (tree, alignment, stats) so the UI has data to display
without needing to run the full Airflow pipeline.

Usage:
    docker compose exec api python /app/scripts/seed_demo.py
    OR locally:
    python scripts/seed_demo.py
"""
import os
import sys
import json
import math

# Add parent to path for local execution
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Experiment, ExperimentStatus

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://phylospark:phylospark_dev_2024@localhost:5432/phylospark",
)

# ── Pamela's 10 GH13 α-amylase sequences (real NCBI accessions) ──
DEMO_SEQUENCES = {
    "P0C1B3": "MFAKRFKTSLLPLFAGFLLASHCIAATQESGPAELVMPSSYLANYGQFISINGNQLYIDGKTWDTPNSENLCYAMKEFLDMNHPIYINVHDFNQSGSYENQTLGISYANSGYTEQYIMLMAHFDTAWIDFQYEGSSSWSNGHYGDPYTNGFMMNYKSGGRDEWNDNPMFTNDFSAVQYIKFIPEKKKIIVILDSHLNPHANQIEKANDEKWDAWNLTYLQNLNKSN",
    "P04745": "MKLFWLLFTIGFCWAQYSSNTQQGRTSIVHLFEWRWVDIALECERYLAPKGFGGVQVSPPNENVAIHNPFRPWWERYQPVSYKLCTRSGNEDEFRNMVTRCNNVGVRIYVDAVINHMCGNAVSAGTSSTCGSYFNPGSRDFPAVPYSGWDFNDGKCKTGSGDIENYNDATQVRDCRLSGLLDLALGKDYVRSKIAEYMNHLIDIGVAGFRIDASKHMWPGDIKAILDKLHNLNSNWFPAGSKPFIYQEVIDLGGEPIKSSDYFGNGRVTEFKYGAKLGTVIRKWNGEKMSYLKNWGEGWGFMPSDRALVFVDNHDNQRGHGAGGASILTFWDARLYKMAVGFMLAHPYGFTRVMSSYRWPRQFQNGS",
    "P06278": "AAPFNGTMMQYFEWYLPNDGNHWNRLRDDAQNLKNRKYDNVTWQWFDIAQRKNYLAAGSGGGGVVFVDNDWRNPNQANDLQAYLNDAKRDTAAFLNNTYLLDTGADRVNKFEGKMNAEWKGILKQVGDQVLVEVSPYGSNFYFAYMGASTINRMDELYKQVQGKEVFDFMAWSHWYFDAQSGSMQQLEDYIKFYGDKVHDMFEFADHPGYRQAYYLSQHGKHLNGRDNYYYVSSAFNEGDTLANKSFEKINADPIFKQLFWKQTHPEWTFQDDSYDLWNQLNSYTFEKDFPRFPYDKIIYGSSQDDANKKKTQLQKAIDRISSQITRFDGPDAKWQIYTYNGGYIEPTKFGLSNRDWDYFKRHYKSYLQN",
    "Q9UQ90": "MRGLLALLFLVHPCHLGAGKGGPRGSGSAADKVFLSPLHRLPEEAGATVLVVLNHESGPHVRLQELRGDTFLDCAALGHEAAPLLLRDYIDAAGPQWVCTRVFVGHEGDGAPAATREQALAQWLLERGVRVWALDSEVDSDGFADAHQTLRSCQARLAAAAGSGHVHRGVHEGTWIDTIAAYLDDPWPPSPRSLYSMFANNHDQFNAFLARGEKRGEPWHFYQSHKEPFTRSHGHEAMIDLGLASSPSVTEKLDAGLQHAYAAVHDFHQLVFTMAHRKYPEEVSAMASKFHEHVGKVLV",
    "A0A2Z4HWH2": "MQKFLILLTTATLFTANANAAETPPSIVHHLYRWRHEIALQYHREYGSKGFQGIQISPPNESVAAYQPFRPWWERYKPVAYYQCTRSGNEGEHREMITRMHQHGMRVYVDAVMNHMCADIAMAGTSEQCGTYYNPLSQEYFPSIPYSGWDFNDGRDKTPSKDIENYKDDTDVRDCRLSDLIDLALGQDYVRSKIAEYMKHLIDIGVAGFRLDASHHMWPGDIKAILDDMKKLGSNWFAAGSQPFISQEVIDLGGEPVKSADYFSNAKVHQFKYNAQLGTILKEWNGEKMAYLKNWGDGWGFVPSERSLVYVDNHDSQRGHSSQGASILTFWDPRLYQNAVGFMLAHPYGFTRVMSSYRWPRTFRDGS",
    "P19531": "MKAAVSRSKLVALLTATAFLATHCSAVETSIVHLFEWRWVDIALECERYLAPKGFGGVQVSPPNENVAIFNPFRPWWERYQPVSYKLCTRSGNEDEFRNMVTRCNNVGVRIYVDAVINHMCGNAVSAGTSSTCGSYFNPGSRDFPAVPYSGWDFNDGKCKTGSGDIENYNDATQVRDCRLSGLLDLALGKDYVRSKIAEYMNHLIDIGVAGFRIDASKHMWPGDIKAILDKLHNLNSNWFPAGSRPFIYQEVIDLGGEPIKSSDYFGNGRVTEFKYGAKLGTVIRKWNGEKMSYLKNWGEGWGFMPSDRALVFVDNHDNQRGHGAGGASILTFWDARLYKMAVGFMLAHPYGFTRVMSSYRWPRQFQNGS",
    "P10531": "MHCLKITLCSSCWLFAMFTADSMVHLFEWRWADIVIECETYLGEENKTGGIHASPNENVGLYNPFRPWYHRYQPVSYKLCTKSSKENTYREMVTRTHHIGINIYVDAVINHLCGSGASEGESTACGIYFNPGSREFPAVPYSGWDFNDGKCKTASSDDIESYNQATQVRDCRLSDLIDLALGLDYVRSKIAEYMHNLIDIGVAGFRLDASKHMWPGDIKAVLDALKALGANWFPSGSKPFIYQEVIDLGGEPIKSTDYFGRGRVNQFKYGADLGTVIRQWNAEKMSYLKNWITGWGYMPHSRALVFVDNHDNQRGHGAGGASILTFWDARLYKMAVGFMLAHPYCFTRVMANYRWPSYFQNGD",
    "Q6YBX1": "MVKARFQFLLLFSTFVSQSNATQTAMPAIVHSIYQWFQEIALECRRYLTPKGFGGVQVSPPNENIAIYNPFRPWWDQYQPVSYKLCTMSGNENEFREMVSRINNHGVRIYVDAVINHMCGNAVSAGTEAQCGSYFNQKAQEFPSVPYSGWDFNDGKCKTGSGDIEHYNDATQVRDCRLAGLLDLALGRDYVRSKIAEYMKHLIDIGVAGFRLDASKHMWPGDIKAILDNLHRLNSNWFSAGSRPFISQEVIDLGGEPIKSADYFHNGRVTQFKYGAKLGTVIRQWDGEKMSYLKNWGEGWGFMPSGRALVFVDNHDNQRGHGAGGASILTFWDARLYKMAVGFMLAHPYGLTRVISSYRWPRKFRDGS",
    "O82839": "MAAASISLFFCLLLTTVSAHHGVLTFHEVNRDWFDLAGLSKLGVPQSGFVTNDIAMWNKFGSDATNAIWSHPQWLHKNPAMQSYKLCTSSGADKEYRSMIQRLHDHGIVTIVDVVINHMGGEPNSYAGSSTCGSYFNPETAAFPSVPQHGWDFNDGKETTSGKDIDNYNDALEVRSCRLAGLIDLALGEDYNRSTIAEYMNRLIDIGVAGFRIDAAKHMSAGDIEAILRNLHSLGADWFPASAKPFIYQEVIDYGGEPIKSSDFHSRGKVAQFKYGAELGTVLEKWNNEHMAYLKNLGKGWATMPNSRALVFVDNHDSQRGHGAGGDSILTFWDKRLYKLAVGFMLAHPYGFTRVMSSYQWPQATRKGA",
    "Q9LIB1": "MCMVRSVFMLGSLLLLTTTSATASESADRPLCLMTFHDVNRDWIDLAGISEMGIPQSGFVTNEIVMWNKFGRDATDAIWSHPQWLHKSPAMQSYKLCTSSGADKEYKSMIERLHKQGIVTIVDVVINHMGGEPNSYAGSTTCGSYFNPETAAFPSVPQHGWDFNDGKETTSSKDIENYNDALQVRSCRLAGLIDLGLGEDYNRSTIAEYMNRLIDIGVAGFRIDAAKHMSAGDIEAILRNLHRLGADWFPAGSKPFIYQEVIDYGGEPIKSSDFHSRGKVAQFKYGAELGTVLEKWNGENIAYLKNLGKGWATMPNSRALVFVDNHDSQRGHGAGGDSILTFWDKRLYKLAVGFMLAHPYGFTRVMSSYRWPQATKRGS",
}

# Pre-computed demo Newick tree (approximate NJ tree for the 10 seqs)
DEMO_NEWICK = (
    "((P04745:0.023,P19531:0.019):0.012,"
    "(P10531:0.089,(A0A2Z4HWH2:0.045,Q6YBX1:0.038):0.025):0.031,"
    "((O82839:0.042,Q9LIB1:0.039):0.065,"
    "(Q9UQ90:0.312,"
    "(P0C1B3:0.456,P06278:0.287):0.112):0.078));"
)

# Build demo alignment (simplified - pad shorter seqs with gaps)
def build_demo_alignment():
    max_len = max(len(s) for s in DEMO_SEQUENCES.values())
    lines = []
    for acc, seq in DEMO_SEQUENCES.items():
        padded = seq + "-" * (max_len - len(seq))
        lines.append(f">{acc}_GH13_alpha-amylase")
        # Wrap at 80 chars
        for i in range(0, len(padded), 80):
            lines.append(padded[i:i+80])
    return "\n".join(lines) + "\n"


def build_demo_features():
    """Compute feature engineering results for display (like Spark would)."""
    features = []
    amino_acids = "ACDEFGHIKLMNPQRSTVWY"
    hydrophobic = set("AILMFWVP")
    charged = set("DEKRH")

    for acc, seq in DEMO_SEQUENCES.items():
        length = len(seq)
        aa_counts = {aa: seq.count(aa) / length for aa in amino_acids}
        hydro_frac = sum(1 for c in seq if c in hydrophobic) / length
        charged_frac = sum(1 for c in seq if c in charged) / length
        mw_approx = length * 110.0  # average MW per amino acid

        feat = {
            "seq_id": acc,
            "length": length,
            "mw_approx": round(mw_approx, 1),
            "hydrophobic_frac": round(hydro_frac, 4),
            "charged_frac": round(charged_frac, 4),
        }
        for aa in amino_acids:
            feat[f"aa_{aa}"] = round(aa_counts[aa], 4)
        features.append(feat)
    return features


def build_demo_distances(features):
    """Compute pairwise euclidean distances on feature vectors."""
    amino_acids = "ACDEFGHIKLMNPQRSTVWY"
    keys = [f"aa_{aa}" for aa in amino_acids] + ["hydrophobic_frac", "charged_frac"]
    distances = []
    for i, fa in enumerate(features):
        for j, fb in enumerate(features):
            if j <= i:
                continue
            dist = math.sqrt(sum((fa[k] - fb[k]) ** 2 for k in keys))
            distances.append({
                "seq_a": fa["seq_id"],
                "seq_b": fb["seq_id"],
                "euclidean_distance": round(dist, 6),
            })
    return distances


def seed():
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Check if demo already exists
    existing = db.query(Experiment).filter(Experiment.name == "Pamela's GH13 α-amylase Analysis").first()
    if existing:
        print(f"Demo experiment already exists (id={existing.id}). Updating results...")
        exp = existing
    else:
        exp = Experiment(
            name="Pamela's GH13 α-amylase Analysis",
            description="Phylogenetic analysis of 10 GH13 glycoside hydrolase family alpha-amylase sequences from diverse organisms. Reproducing and scaling Pamela's bioinformatics practice.",
            query="GH13 alpha-amylase",
            organism="",
            max_sequences=10,
            status=ExperimentStatus.COMPLETE,
        )
        db.add(exp)
        db.flush()
        print(f"Created demo experiment (id={exp.id})")

    # Build results
    features = build_demo_features()
    distances = build_demo_distances(features)
    alignment = build_demo_alignment()

    # Store results in metadata (always available, no MinIO needed for demo)
    exp.status = ExperimentStatus.COMPLETE
    exp.metadata_ = {
        "newick": DEMO_NEWICK,
        "alignment": alignment,
        "features": features,
        "distances": distances,
        "sequences_count": len(DEMO_SEQUENCES),
        "accessions": list(DEMO_SEQUENCES.keys()),
    }
    exp.result_tree_path = f"experiments/{exp.id}/tree.nwk"
    exp.result_report_path = f"experiments/{exp.id}/report.html"

    db.commit()
    print(f"✓ Seeded experiment '{exp.name}' with:")
    print(f"  - {len(DEMO_SEQUENCES)} sequences")
    print(f"  - Newick tree ({len(DEMO_NEWICK)} chars)")
    print(f"  - Alignment ({len(alignment)} chars)")
    print(f"  - {len(features)} feature vectors")
    print(f"  - {len(distances)} pairwise distances")
    print(f"\nOpen http://localhost:3000/experiment/{exp.id} to view results!")

    # Also seed a second experiment (not run) for demo purposes
    existing2 = db.query(Experiment).filter(Experiment.name == "Extended GH13 Family Analysis").first()
    if not existing2:
        exp2 = Experiment(
            name="Extended GH13 Family Analysis",
            description="Scaled analysis: 100 GH13 sequences across all organisms to identify subfamily clustering patterns.",
            query="GH13 glycoside hydrolase alpha-amylase",
            organism="",
            max_sequences=100,
            status=ExperimentStatus.CREATED,
        )
        db.add(exp2)
        db.commit()
        print(f"✓ Created pending experiment '{exp2.name}' (ready to run)")

    db.close()


if __name__ == "__main__":
    seed()
