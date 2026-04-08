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


# ── Taxon metadata & AI insights ──

class TaxonMeta(BaseModel):
    accession: str
    organism: str = ""
    title: str = ""
    taxonomy: str = ""
    protein_name: str = ""
    length: int = 0

class TaxonMetaResponse(BaseModel):
    taxa: dict[str, TaxonMeta]

class TaxonInsightRequest(BaseModel):
    accession: str
    user_prompt: Optional[str] = None
    model: Optional[str] = None

class TreeInsightRequest(BaseModel):
    user_prompt: Optional[str] = None
    model: Optional[str] = None

class DOIReference(BaseModel):
    doi: str
    title: str = ""
    authors: str = ""
    journal: str = ""
    year: Optional[int] = None
    validated: bool = False
    url: str = ""

class InsightResponse(BaseModel):
    id: int
    experiment_id: int
    accession: Optional[str]
    scope: str
    user_prompt: Optional[str]
    ai_response: str
    model_used: Optional[str]
    doi_references: Optional[list[DOIReference]] = None
    created_at: datetime

    model_config = {"from_attributes": True}

class InsightListResponse(BaseModel):
    insights: list[InsightResponse]

class AdvancedReportRequest(BaseModel):
    user_prompt: Optional[str] = None
    model: Optional[str] = None

class AdvancedReportResponse(BaseModel):
    id: int
    experiment_id: int
    scope: str
    ai_response: str
    doi_references: list[DOIReference]
    model_used: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

class ConservationData(BaseModel):
    position: int
    score: float
    consensus: str

class AlignmentStatsResponse(BaseModel):
    num_sequences: int
    alignment_length: int
    avg_identity: float
    gap_percentage: float
    conservation: list[ConservationData]
    consensus_sequence: str


# ── Alignment AI chat & reports ──

class AlignmentChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class AlignmentChatRequest(BaseModel):
    user_prompt: str
    conversation_history: Optional[list[AlignmentChatMessage]] = None
    model: Optional[str] = None

class AlignmentChatResponse(BaseModel):
    id: int
    experiment_id: int
    scope: str
    user_prompt: Optional[str]
    ai_response: str
    doi_references: Optional[list[DOIReference]] = None
    model_used: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

class AlignmentReportRequest(BaseModel):
    user_prompt: Optional[str] = None
    model: Optional[str] = None

class StatsReportRequest(BaseModel):
    user_prompt: Optional[str] = None
    model: Optional[str] = None


# ── New schemas for multi-model + caching ──

class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str
    type: str  # "chat" | "reasoning"
    is_default: bool = False

class CachedAnalysisResponse(BaseModel):
    cached: bool
    insight: Optional[InsightResponse] = None

class ChartAnalysisRequest(BaseModel):
    chart_type: str  # e.g. "entropy", "aa_composition", or auto scopes "stats_auto", "alignment_auto", "tree_auto"
    force_refresh: bool = False
    model: Optional[str] = None
