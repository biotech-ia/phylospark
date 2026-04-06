from fastapi import APIRouter, HTTPException
from app.schemas import (
    AIRecommendRequest, AIRecommendResponse,
    AIAlignmentParamsRequest, AIAlignmentParamsResponse, AlignmentParams,
)
from app.config import get_settings
from openai import OpenAI
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


def _get_client() -> OpenAI:
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise HTTPException(status_code=503, detail="DeepSeek API key not configured")
    return OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )


@router.post("/recommend-sequences", response_model=AIRecommendResponse)
def recommend_sequences(payload: AIRecommendRequest):
    """Use DeepSeek AI to recommend which sequences to keep for phylogenetic analysis."""
    client = _get_client()
    settings = get_settings()

    seq_list = "\n".join(
        f"- {s.accession}: {s.title} | {s.organism} | {s.length} aa"
        for s in payload.sequences[:500]  # Limit context size
    )

    prompt = f"""You are an expert bioinformatician advising on phylogenetic analysis.

The user is running an experiment: "{payload.experiment_name}"
{f'Description: {payload.experiment_description}' if payload.experiment_description else ''}
NCBI Query: {payload.query}
{f'Target Organism: {payload.organism}' if payload.organism else ''}

They found {len(payload.sequences)} sequences from NCBI. Help them select the best subset for a meaningful phylogenetic analysis.

Criteria for selection:
1. Taxonomic diversity — include representatives from different organisms/clades
2. Sequence quality — prefer well-annotated sequences with known function
3. Length consistency — avoid extreme outliers that would distort alignment
4. Relevance — sequences should match the study's intent
5. Practical size — recommend 20-100 sequences for a good balance of coverage and computation

Sequences found:
{seq_list}

Respond ONLY with valid JSON (no markdown, no code blocks):
{{"recommended_accessions": ["ACC1", "ACC2", ...], "reasoning": "Brief explanation of selection criteria used"}}"""

    try:
        response = client.chat.completions.create(
            model=settings.deepseek_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=4000,
        )

        text = response.choices[0].message.content.strip()
        # Strip markdown code blocks if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        data = json.loads(text)
        return AIRecommendResponse(
            recommended_accessions=data["recommended_accessions"],
            reasoning=data.get("reasoning", "AI-curated selection for phylogenetic analysis"),
            total_recommended=len(data["recommended_accessions"]),
        )
    except json.JSONDecodeError as e:
        logger.error(f"AI response not valid JSON: {text[:500]}")
        raise HTTPException(status_code=502, detail="AI returned invalid response format")
    except Exception as e:
        logger.error(f"DeepSeek API call failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI recommendation failed: {str(e)}")


@router.post("/recommend-alignment-params", response_model=AIAlignmentParamsResponse)
def recommend_alignment_params(payload: AIAlignmentParamsRequest):
    """Use DeepSeek AI to recommend optimal alignment parameters."""
    client = _get_client()
    settings = get_settings()

    prompt = f"""You are an expert bioinformatician. Recommend optimal multiple sequence alignment parameters.

Experiment: "{payload.experiment_name}"
{f'Description: {payload.experiment_description}' if payload.experiment_description else ''}
Query: {payload.query}
{f'Organism: {payload.organism}' if payload.organism else ''}
Number of sequences: {payload.num_sequences}
{f'Average sequence length: {payload.avg_length:.0f} aa' if payload.avg_length else ''}

Consider:
- MAFFT is best for most protein alignments; MUSCLE for smaller sets
- Gap Opening Penalty: higher = fewer gaps (typical: 1.53 for MAFFT, 10.0 for traditional)
- Gap Extension Penalty: lower = allow longer gaps (typical: 0.123 for MAFFT, 0.2 for traditional)
- Weight Matrix: BLOSUM62 (general), Gonnet (PAM-based, good for divergent), PAM250 (distant homologs)
- Max iterations: more = better but slower

Respond ONLY with valid JSON (no markdown, no code blocks):
{{"method": "mafft or muscle", "gap_opening_penalty": float, "gap_extension_penalty": float, "protein_weight_matrix": "BLOSUM62 or Gonnet or PAM250", "max_iterations": int, "reasoning": "Brief explanation"}}"""

    try:
        response = client.chat.completions.create(
            model=settings.deepseek_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1000,
        )

        text = response.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        data = json.loads(text)
        params = AlignmentParams(
            method=data.get("method", "mafft"),
            gap_opening_penalty=float(data.get("gap_opening_penalty", 1.53)),
            gap_extension_penalty=float(data.get("gap_extension_penalty", 0.123)),
            protein_weight_matrix=data.get("protein_weight_matrix", "BLOSUM62"),
            max_iterations=int(data.get("max_iterations", 16)),
        )
        return AIAlignmentParamsResponse(
            params=params,
            reasoning=data.get("reasoning", "AI-optimized alignment parameters"),
        )
    except json.JSONDecodeError:
        logger.error(f"AI response not valid JSON: {text[:500]}")
        raise HTTPException(status_code=502, detail="AI returned invalid response format")
    except Exception as e:
        logger.error(f"DeepSeek API call failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI parameter recommendation failed: {str(e)}")
