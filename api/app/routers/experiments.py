from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Experiment, ExperimentStatus, ExperimentLog
from app.schemas import ExperimentCreate, ExperimentResponse, ExperimentList
from app.storage import get_minio_client, download_file
from datetime import datetime, timezone
import json
import logging

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

    if experiment.status not in (ExperimentStatus.CREATED, ExperimentStatus.FAILED):
        raise HTTPException(status_code=400, detail=f"Cannot run experiment in '{experiment.status}' state")

    # TODO: Trigger Airflow DAG via REST API
    experiment.status = ExperimentStatus.DOWNLOADING
    db.commit()
    db.refresh(experiment)
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
