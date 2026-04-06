from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models import Experiment, ExperimentStatus, ExperimentLog
import asyncio
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


def append_log(experiment_id: int, level: str, message: str, step: str = ""):
    """Persist a log entry to the database."""
    db = SessionLocal()
    try:
        entry = ExperimentLog(
            experiment_id=experiment_id,
            level=level,
            step=step or "",
            message=message,
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to persist log for experiment {experiment_id}: {e}")
        db.rollback()
    finally:
        db.close()


def get_logs(experiment_id: int) -> list[dict]:
    """Read all logs for an experiment from the database."""
    db = SessionLocal()
    try:
        rows = (
            db.query(ExperimentLog)
            .filter(ExperimentLog.experiment_id == experiment_id)
            .order_by(ExperimentLog.id.asc())
            .all()
        )
        return [
            {
                "timestamp": row.created_at.isoformat() if row.created_at else "",
                "level": row.level,
                "step": row.step or "",
                "message": row.message,
            }
            for row in rows
        ]
    finally:
        db.close()


@router.websocket("/ws/experiments/{experiment_id}/logs")
async def experiment_logs_ws(websocket: WebSocket, experiment_id: int):
    """Stream real-time pipeline logs to the frontend."""
    await websocket.accept()

    db = SessionLocal()

    try:
        experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        if not experiment:
            await websocket.send_json({"type": "error", "message": "Experiment not found"})
            await websocket.close()
            return

        # Send initial status
        await websocket.send_json({
            "type": "status",
            "status": experiment.status,
            "message": f"Connected to experiment #{experiment_id}",
        })

        last_idx = 0
        terminal_states = {ExperimentStatus.COMPLETE, ExperimentStatus.FAILED, ExperimentStatus.CANCELLED, ExperimentStatus.CREATED}

        while True:
            # Refresh experiment from DB
            db.refresh(experiment)

            # Send any new log entries
            logs = get_logs(experiment_id)
            if len(logs) > last_idx:
                for entry in logs[last_idx:]:
                    await websocket.send_json({"type": "log", **entry})
                last_idx = len(logs)

            # Send status update
            await websocket.send_json({
                "type": "status",
                "status": experiment.status,
            })

            # If pipeline is done, send final message and close
            if experiment.status in terminal_states and experiment.status != ExperimentStatus.CREATED:
                if experiment.status == ExperimentStatus.COMPLETE:
                    await websocket.send_json({
                        "type": "complete",
                        "message": "Pipeline completed successfully!",
                    })
                elif experiment.status == ExperimentStatus.FAILED:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Pipeline failed: {experiment.error_message or 'Unknown error'}",
                    })
                elif experiment.status == ExperimentStatus.CANCELLED:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Pipeline stopped by user: {experiment.error_message or 'Cancelled'}",
                    })
                break

            await asyncio.sleep(1)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for experiment {experiment_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        db.close()


# REST endpoint to get logs (fallback for non-WebSocket clients)
@router.get("/api/v1/experiments/{experiment_id}/logs")
def get_experiment_logs(experiment_id: int, db: Session = Depends(get_db)):
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {"logs": get_logs(experiment_id), "status": experiment.status}


# POST endpoint for pipeline tasks to submit logs
@router.post("/api/v1/experiments/{experiment_id}/logs")
def post_log(experiment_id: int, payload: dict):
    append_log(
        experiment_id,
        payload.get("level", "info"),
        payload.get("message", ""),
        payload.get("step", ""),
    )
    return {"ok": True}
