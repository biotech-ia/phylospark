from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Experiment, ExperimentStatus, ExperimentLog, TaxonInsight
from app.schemas import (
    ExperimentCreate, ExperimentResponse, ExperimentList,
    TaxonMetaResponse, TaxonMeta,
    InsightListResponse, InsightResponse,
    AlignmentStatsResponse, ConservationData,
)
from app.storage import get_minio_client, download_file
from app.pipeline import run_pipeline
from datetime import datetime, timezone
from collections import Counter
import json
import logging
import threading

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post("/", response_model=ExperimentResponse, status_code=201)
def create_experiment(payload: ExperimentCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    # Convert AlignmentParams to dict for JSON column
    if data.get("alignment_params") and hasattr(payload.alignment_params, "model_dump"):
        data["alignment_params"] = payload.alignment_params.model_dump()
    experiment = Experiment(**data)
    db.add(experiment)
    db.commit()
    db.refresh(experiment)
    return experiment


@router.get("/", response_model=ExperimentList)
def list_experiments(skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    total = db.query(Experiment).count()
    experiments = (
        db.query(Experiment)
        .order_by(Experiment.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return ExperimentList(experiments=experiments, total=total)


@router.get("/{experiment_id}", response_model=ExperimentResponse)
def get_experiment(experiment_id: int, db: Session = Depends(get_db)):
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return experiment


@router.post("/{experiment_id}/run", response_model=ExperimentResponse)
def trigger_pipeline(experiment_id: int, db: Session = Depends(get_db)):
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")

    if experiment.status not in (ExperimentStatus.CREATED, ExperimentStatus.FAILED, ExperimentStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Cannot run experiment in '{experiment.status}' state")

    # Set initial status and launch pipeline in background thread
    experiment.status = ExperimentStatus.DOWNLOADING
    db.commit()
    db.refresh(experiment)

    # Run pipeline in a separate thread so the API returns immediately
    thread = threading.Thread(target=run_pipeline, args=(experiment_id,), daemon=True)
    thread.start()

    return experiment


@router.get("/{experiment_id}/tree")
def get_tree_data(experiment_id: int, db: Session = Depends(get_db)):
    """Return Newick tree data from MinIO storage."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if experiment.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Experiment is not complete")

    try:
        client = get_minio_client()
        key = f"experiments/{experiment_id}/tree.nwk"
        data = download_file(client, "phylospark-trees", key)
        return {"newick": data.decode("utf-8")}
    except Exception as e:
        logger.warning(f"Tree data not available for experiment {experiment_id}: {e}")
        # Fallback: check if metadata has inline tree
        if experiment.metadata_ and "newick" in experiment.metadata_:
            return {"newick": experiment.metadata_["newick"]}
        raise HTTPException(status_code=404, detail="Tree data not available")


@router.get("/{experiment_id}/alignment")
def get_alignment_data(experiment_id: int, db: Session = Depends(get_db)):
    """Return FASTA alignment data from MinIO storage."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if experiment.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Experiment is not complete")

    try:
        client = get_minio_client()
        key = f"experiments/{experiment_id}/alignment.fasta"
        data = download_file(client, "phylospark-alignments", key)
        return {"fasta": data.decode("utf-8")}
    except Exception as e:
        logger.warning(f"Alignment data not available for experiment {experiment_id}: {e}")
        if experiment.metadata_ and "alignment" in experiment.metadata_:
            return {"fasta": experiment.metadata_["alignment"]}
        raise HTTPException(status_code=404, detail="Alignment data not available")


@router.get("/{experiment_id}/alignment-stats", response_model=AlignmentStatsResponse)
def get_alignment_stats(experiment_id: int, db: Session = Depends(get_db)):
    """Compute conservation scores and consensus from alignment FASTA."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if experiment.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Experiment is not complete")

    # Get alignment FASTA
    fasta_text = None
    try:
        client = get_minio_client()
        key = f"experiments/{experiment_id}/alignment.fasta"
        data = download_file(client, "phylospark-alignments", key)
        fasta_text = data.decode("utf-8")
    except Exception:
        if experiment.metadata_ and "alignment" in experiment.metadata_:
            fasta_text = experiment.metadata_["alignment"]
    if not fasta_text:
        raise HTTPException(status_code=404, detail="Alignment data not available")

    # Parse FASTA
    sequences = []
    current_seq = []
    for line in fasta_text.strip().split("\n"):
        if line.startswith(">"):
            if current_seq:
                sequences.append("".join(current_seq))
            current_seq = []
        else:
            current_seq.append(line.strip())
    if current_seq:
        sequences.append("".join(current_seq))

    if not sequences:
        raise HTTPException(status_code=404, detail="No sequences in alignment")

    num_seqs = len(sequences)
    aln_len = max(len(s) for s in sequences)

    # Compute per-column conservation + consensus
    conservation = []
    consensus_chars = []
    total_gaps = 0
    total_cells = num_seqs * aln_len
    identity_scores = []

    for pos in range(aln_len):
        column = []
        for seq in sequences:
            ch = seq[pos].upper() if pos < len(seq) else "-"
            column.append(ch)

        gaps = column.count("-")
        total_gaps += gaps
        non_gap = [c for c in column if c != "-"]

        if non_gap:
            counts = Counter(non_gap)
            most_common_char, most_common_count = counts.most_common(1)[0]
            score = most_common_count / len(column)
            identity_scores.append(score)
            consensus_chars.append(most_common_char)
        else:
            score = 0.0
            consensus_chars.append("-")

        conservation.append(ConservationData(
            position=pos + 1,
            score=round(score, 4),
            consensus=consensus_chars[-1],
        ))

    avg_identity = sum(identity_scores) / len(identity_scores) if identity_scores else 0.0
    gap_pct = (total_gaps / total_cells * 100) if total_cells > 0 else 0.0

    return AlignmentStatsResponse(
        num_sequences=num_seqs,
        alignment_length=aln_len,
        avg_identity=round(avg_identity, 4),
        gap_percentage=round(gap_pct, 2),
        conservation=conservation,
        consensus_sequence="".join(consensus_chars),
    )


@router.get("/{experiment_id}/stats")
def get_stats_data(experiment_id: int, db: Session = Depends(get_db)):
    """Return feature engineering and distance matrix data."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if experiment.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Experiment is not complete")

    result = {"features": [], "distances": []}
    try:
        client = get_minio_client()
        features_key = f"experiments/{experiment_id}/features.json"
        data = download_file(client, "phylospark-features", features_key)
        result["features"] = json.loads(data)
    except Exception as e:
        logger.warning(f"Features not available for experiment {experiment_id}: {e}")
        if experiment.metadata_ and "features" in experiment.metadata_:
            result["features"] = experiment.metadata_["features"]

    try:
        client = get_minio_client()
        dist_key = f"experiments/{experiment_id}/distances.json"
        data = download_file(client, "phylospark-features", dist_key)
        result["distances"] = json.loads(data)
    except Exception as e:
        logger.warning(f"Distances not available for experiment {experiment_id}: {e}")
        if experiment.metadata_ and "distances" in experiment.metadata_:
            result["distances"] = experiment.metadata_["distances"]

    return result


@router.post("/{experiment_id}/stop", response_model=ExperimentResponse)
def stop_experiment(experiment_id: int, db: Session = Depends(get_db)):
    """Stop/cancel a running experiment pipeline."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")

    running_states = {
        ExperimentStatus.DOWNLOADING,
        ExperimentStatus.PROCESSING,
        ExperimentStatus.ALIGNING,
        ExperimentStatus.BUILDING_TREE,
    }
    if experiment.status not in running_states:
        raise HTTPException(status_code=400, detail=f"Cannot stop experiment in '{experiment.status}' state")

    prev_status = experiment.status
    experiment.status = ExperimentStatus.CANCELLED
    experiment.error_message = f"Cancelled by user during '{prev_status}' phase"
    db.commit()

    # Log the cancellation
    log_entry = ExperimentLog(
        experiment_id=experiment_id,
        level="warning",
        step="cancel",
        message=f"Pipeline stopped by user. Previous state: {prev_status}",
    )
    db.add(log_entry)
    db.commit()
    db.refresh(experiment)
    return experiment


@router.delete("/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: int, db: Session = Depends(get_db)):
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    db.delete(experiment)
    db.commit()


@router.get("/{experiment_id}/taxon-metadata", response_model=TaxonMetaResponse)
def get_taxon_metadata(experiment_id: int, db: Session = Depends(get_db)):
    """Fetch organism metadata for each taxon from NCBI or cached metadata."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if experiment.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Experiment is not complete")

    # Return cached metadata if available
    if experiment.metadata_ and "taxon_meta" in experiment.metadata_:
        taxa = {}
        for acc, meta in experiment.metadata_["taxon_meta"].items():
            taxa[acc] = TaxonMeta(**meta)
        return TaxonMetaResponse(taxa=taxa)

    # Fetch from NCBI and cache
    from Bio import Entrez, SeqIO
    from app.config import get_settings
    import io

    settings = get_settings()
    Entrez.email = settings.ncbi_email or "phylospark@example.com"
    if settings.ncbi_api_key:
        Entrez.api_key = settings.ncbi_api_key

    # Get accessions from FASTA in MinIO
    accessions = []
    try:
        client = get_minio_client()
        fasta_raw = download_file(client, "phylospark-raw", f"experiments/{experiment_id}/sequences_clean.fasta")
        records = list(SeqIO.parse(io.StringIO(fasta_raw.decode("utf-8")), "fasta"))
        accessions = [r.id for r in records]
    except Exception:
        # Fallback: try selected_sequences
        accessions = experiment.selected_sequences or []

    if not accessions:
        return TaxonMetaResponse(taxa={})

    taxa = {}
    try:
        # Fetch summaries from NCBI in batch
        handle = Entrez.esummary(db="protein", id=",".join(accessions[:200]))
        summaries = Entrez.read(handle)
        handle.close()

        for item in summaries:
            acc = item.get("AccessionVersion", item.get("Caption", ""))
            title = item.get("Title", "")
            org = item.get("Organism", "")
            if not org and "[" in title:
                org = title.rsplit("[", 1)[-1].rstrip("]")
            # Extract protein name from title (before the organism bracket)
            protein_name = title.split("[")[0].strip() if "[" in title else title
            length = int(item.get("Length", item.get("Slen", 0)))
            tax_id = str(item.get("TaxId", ""))

            taxa[acc] = TaxonMeta(
                accession=acc,
                organism=org or "Unknown",
                title=title,
                taxonomy=tax_id,
                protein_name=protein_name,
                length=length,
            )
    except Exception as e:
        logger.warning(f"NCBI metadata fetch failed for exp {experiment_id}: {e}")
        # Build minimal metadata from FASTA headers
        try:
            client = get_minio_client()
            fasta_raw = download_file(client, "phylospark-raw", f"experiments/{experiment_id}/sequences_clean.fasta")
            for rec in SeqIO.parse(io.StringIO(fasta_raw.decode("utf-8")), "fasta"):
                title = rec.description
                org = ""
                if "[" in title:
                    org = title.rsplit("[", 1)[-1].rstrip("]")
                protein_name = title.split("[")[0].strip() if "[" in title else title
                taxa[rec.id] = TaxonMeta(
                    accession=rec.id, organism=org or "Unknown",
                    title=title, protein_name=protein_name,
                    length=len(rec.seq),
                )
        except Exception:
            pass

    # Cache in metadata
    meta = experiment.metadata_ or {}
    meta["taxon_meta"] = {acc: t.model_dump() for acc, t in taxa.items()}
    experiment.metadata_ = meta
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(experiment, "metadata_")
    db.commit()

    return TaxonMetaResponse(taxa=taxa)


@router.get("/{experiment_id}/insights", response_model=InsightListResponse)
def get_insights(experiment_id: int, db: Session = Depends(get_db)):
    """Get all saved AI insights for an experiment."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    insights = (
        db.query(TaxonInsight)
        .filter(TaxonInsight.experiment_id == experiment_id)
        .order_by(TaxonInsight.created_at.desc())
        .all()
    )
    return InsightListResponse(insights=insights)
