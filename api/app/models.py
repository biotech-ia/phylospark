from sqlalchemy import Column, Integer, String, DateTime, Text, JSON, Enum as SQLEnum, ForeignKey
from sqlalchemy.sql import func
import enum
from app.database import Base


class ExperimentStatus(str, enum.Enum):
    CREATED = "created"
    DOWNLOADING = "downloading"
    PROCESSING = "processing"
    ALIGNING = "aligning"
    BUILDING_TREE = "building_tree"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Experiment(Base):
    __tablename__ = "experiments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    query = Column(String(500), nullable=False)  # NCBI search query
    organism = Column(String(255), nullable=True)
    max_sequences = Column(Integer, default=100)
    status = Column(SQLEnum(ExperimentStatus), default=ExperimentStatus.CREATED)
    selected_sequences = Column(JSON, nullable=True)  # List of selected sequence accessions
    alignment_params = Column(JSON, nullable=True)  # Alignment config (gap penalties, matrix, etc.)
    result_tree_path = Column(String(500), nullable=True)  # MinIO path
    result_report_path = Column(String(500), nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class ExperimentLog(Base):
    __tablename__ = "experiment_logs"

    id = Column(Integer, primary_key=True, index=True)
    experiment_id = Column(Integer, ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False, index=True)
    level = Column(String(20), nullable=False, default="info")
    step = Column(String(100), nullable=True, default="")
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
