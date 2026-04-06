from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from app.models import ExperimentStatus


class AlignmentParams(BaseModel):
    method: str = Field(default="mafft", description="mafft or muscle")
    gap_opening_penalty: float = Field(default=10.0)
    gap_extension_penalty: float = Field(default=0.2)
    protein_weight_matrix: str = Field(default="BLOSUM62", description="BLOSUM62, Gonnet, PAM250, etc.")
    max_iterations: int = Field(default=16)


class ExperimentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    query: str = Field(..., min_length=1, max_length=500, description="NCBI search query, e.g. 'GH13 alpha-amylase'")
    organism: Optional[str] = Field(None, max_length=255)
    max_sequences: int = Field(default=100, ge=1, le=5000)
    selected_sequences: Optional[list[str]] = Field(None, description="Selected sequence accessions from NCBI search")
    alignment_params: Optional[AlignmentParams] = None


class ExperimentResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    query: str
    organism: Optional[str]
    max_sequences: int
    status: ExperimentStatus
    selected_sequences: Optional[list[str]]
    alignment_params: Optional[dict]
    result_tree_path: Optional[str]
    result_report_path: Optional[str]
    error_message: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ExperimentList(BaseModel):
    experiments: list[ExperimentResponse]
    total: int


class NCBISearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    organism: Optional[str] = None
    db: str = Field(default="protein")
    max_results: int = Field(default=200, ge=1, le=5000)


class SequenceInfo(BaseModel):
    accession: str
    title: str
    organism: str
    length: int
    uid: str


class NCBISearchResponse(BaseModel):
    sequences: list[SequenceInfo]
    total_found: int
    query_used: str


class AIRecommendRequest(BaseModel):
    sequences: list[SequenceInfo]
    experiment_name: str
    experiment_description: Optional[str] = None
    query: str
    organism: Optional[str] = None


class AIRecommendResponse(BaseModel):
    recommended_accessions: list[str]
    reasoning: str
    total_recommended: int


class AIAlignmentParamsRequest(BaseModel):
    experiment_name: str
    experiment_description: Optional[str] = None
    query: str
    organism: Optional[str] = None
    num_sequences: int
    avg_length: Optional[float] = None


class AIAlignmentParamsResponse(BaseModel):
    params: AlignmentParams
    reasoning: str
