from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Experiment, ExperimentStatus, TaxonInsight
from app.schemas import (
    AIRecommendRequest, AIRecommendResponse,
    AIAlignmentParamsRequest, AIAlignmentParamsResponse, AlignmentParams,
    TaxonInsightRequest, TreeInsightRequest, InsightResponse,
)
from app.config import get_settings
from app.storage import get_minio_client, download_file
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


def _get_tree_context(experiment_id: int) -> str:
    """Get the Newick tree string for AI context (truncated if huge)."""
    try:
        client = get_minio_client()
        data = download_file(client, "phylospark-trees", f"experiments/{experiment_id}/tree.nwk")
        newick = data.decode("utf-8")
        if len(newick) > 8000:
            return newick[:8000] + "... [truncated]"
        return newick
    except Exception:
        return "(tree not available)"


def _get_taxon_meta_context(experiment_id: int, db: Session) -> str:
    """Build a text summary of all taxa in the experiment."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp or not exp.metadata_ or "taxon_meta" not in exp.metadata_:
        return "(taxon metadata not loaded)"
    lines = []
    for acc, m in list(exp.metadata_["taxon_meta"].items())[:100]:
        lines.append(f"- {acc}: {m.get('organism', '?')} | {m.get('protein_name', '?')} | {m.get('length', '?')} aa")
    return "\n".join(lines)


@router.post("/experiments/{experiment_id}/taxon-insight", response_model=InsightResponse)
def taxon_insight(experiment_id: int, payload: TaxonInsightRequest, db: Session = Depends(get_db)):
    """AI analysis of a specific taxon in context of the phylogenetic tree."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    client_ai = _get_client()
    settings = get_settings()

    newick = _get_tree_context(experiment_id)
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)

    # Find this taxon's info
    taxon_info = ""
    if exp.metadata_ and "taxon_meta" in exp.metadata_:
        meta = exp.metadata_["taxon_meta"].get(payload.accession, {})
        taxon_info = f"Accession: {payload.accession}\nOrganism: {meta.get('organism', 'Unknown')}\nProtein: {meta.get('protein_name', 'Unknown')}\nLength: {meta.get('length', '?')} aa"

    system_prompt = """You are a senior bioinformatics researcher specializing in molecular phylogenetics, enzyme evolution, and comparative genomics. You provide expert-level analysis that connects sequence data to biological function, evolutionary history, and practical significance.

Your analyses should be:
- Scientifically rigorous but accessible
- Grounded in the actual phylogenetic tree structure and relationships
- Focused on what makes this organism/protein interesting in context
- Including references to key enzyme families (e.g., GH13 for alpha-amylases)
- Written in clear sections with headings using markdown"""

    user_prompt = f"""Analyze this specific taxon within the phylogenetic tree of this experiment.

**Target taxon:**
{taxon_info}

**All taxa in this tree:**
{taxa_ctx}

**Newick tree:**
{newick}

**Experiment context:**
Name: {exp.name}
Query: {exp.query}
Organism filter: {exp.organism or 'All'}

Provide a rich analysis covering:
1. **Organism Profile** — What is this organism? Its ecological niche, habitat, and significance.
2. **Protein Function** — What does this specific protein do? Its role in the organism's biology.
3. **Evolutionary Context** — Where does it sit in this tree? Which organisms are its closest relatives here and what does that grouping suggest?
4. **Notable Features** — Anything remarkable about its sequence length, branch length, or phylogenetic position.
5. **Practical Relevance** — Industrial, medical, or research applications of this enzyme variant.
"""

    if payload.user_prompt:
        user_prompt += f"\n\n**Additional user question:** {payload.user_prompt}"

    try:
        response = client_ai.chat.completions.create(
            model=settings.deepseek_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=3000,
        )
        ai_text = response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Taxon insight AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=payload.accession,
        scope="taxon",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=settings.deepseek_model,
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)
    return insight


@router.post("/experiments/{experiment_id}/tree-insight", response_model=InsightResponse)
def tree_insight(experiment_id: int, payload: TreeInsightRequest, db: Session = Depends(get_db)):
    """AI analysis of the entire phylogenetic tree."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    client_ai = _get_client()
    settings = get_settings()

    newick = _get_tree_context(experiment_id)
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)

    # Get feature stats if available
    stats_ctx = ""
    try:
        minio_client = get_minio_client()
        feat_data = download_file(minio_client, "phylospark-features", f"experiments/{experiment_id}/features.json")
        features = json.loads(feat_data)
        if features:
            lengths = [f.get("length", 0) for f in features]
            stats_ctx = f"\nFeature stats: {len(features)} sequences, lengths {min(lengths)}-{max(lengths)} aa, avg {sum(lengths)/len(lengths):.0f} aa"
    except Exception:
        pass

    system_prompt = """You are a senior bioinformatics researcher and phylogenetics expert. You analyze phylogenetic trees to extract meaningful biological insights about evolutionary relationships, enzyme diversity, and functional implications.

Your analysis should be:
- Scientifically rigorous yet accessible to graduate students
- Based on the actual tree topology and branch patterns
- Connecting tree structure to biological function
- Using markdown with clear headings and bullet points
- Highlighting unexpected findings or interesting patterns"""

    user_prompt = f"""Perform a comprehensive analysis of this phylogenetic tree.

**Experiment:**
Name: {exp.name}
Query: {exp.query}
Organism filter: {exp.organism or 'All'}
{stats_ctx}

**All taxa:**
{taxa_ctx}

**Newick tree:**
{newick}

Provide a comprehensive analysis covering:
1. **Tree Overview** — General structure, number of major clades, overall topology.
2. **Major Clades** — Identify and describe the main groups. What organisms cluster together and why?
3. **Evolutionary Patterns** — Long vs short branches, what they suggest about divergence rates.
4. **Functional Diversity** — How does the tree reflect functional differences in the protein family?
5. **Outliers & Surprises** — Any unexpected groupings, potential horizontal gene transfer, or misclassifications?
6. **Key Findings Summary** — Top 3-5 most important takeaways from this analysis.
7. **Suggested Next Steps** — What additional analyses could reveal more about these relationships?
"""

    if payload.user_prompt:
        user_prompt += f"\n\n**Additional user question:** {payload.user_prompt}"

    try:
        response = client_ai.chat.completions.create(
            model=settings.deepseek_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=4000,
        )
        ai_text = response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Tree insight AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=None,
        scope="tree",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=settings.deepseek_model,
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)
    return insight
