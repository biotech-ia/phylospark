from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Experiment, ExperimentStatus, TaxonInsight
from app.schemas import (
    AIRecommendRequest, AIRecommendResponse,
    AIAlignmentParamsRequest, AIAlignmentParamsResponse, AlignmentParams,
    TaxonInsightRequest, TreeInsightRequest, InsightResponse,
    AdvancedReportRequest, AdvancedReportResponse, DOIReference,
    AlignmentChatRequest, AlignmentChatResponse,
    AlignmentReportRequest, StatsReportRequest,
    ChartAnalysisRequest, CachedAnalysisResponse, ModelInfo,
)
from app.config import get_settings
from app.storage import get_minio_client, download_file
from openai import OpenAI
import json
import logging
import re
import time
import httpx

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

DOI_PATTERN = re.compile(r'10\.\d{4,9}/[^\s,;\]}"\']+')

# ── Model purpose mapping ──
REASONING_MODELS = {"deepseek-reasoner", "o1-mini", "o1-preview"}
CHAT_MODELS = {"deepseek-chat", "gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"}


def _resolve_provider(model: str) -> str:
    """Determine which provider owns a given model name."""
    if model.startswith("deepseek"):
        return "deepseek"
    return "openai"


def _get_client(provider: str = "deepseek") -> OpenAI:
    """Get OpenAI-compatible client for the requested provider."""
    settings = get_settings()
    if provider == "openai":
        if not settings.openai_api_key:
            raise HTTPException(status_code=503, detail="OpenAI API key not configured")
        return OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    # default: deepseek
    if not settings.deepseek_api_key:
        raise HTTPException(status_code=503, detail="DeepSeek API key not configured")
    return OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)


def _call_model(
    messages: list[dict],
    model: str | None = None,
    purpose: str = "chat",
    temperature: float = 0.3,
    max_tokens: int = 4000,
) -> dict:
    """Unified model call with retry, fallback, and reasoning_content extraction.

    Returns dict: { content, reasoning_content, model_used, tokens }
    """
    settings = get_settings()
    if not model:
        model = settings.default_reasoning_model if purpose == "reasoning" else settings.default_chat_model

    provider = _resolve_provider(model)
    fallback_model = settings.default_chat_model if model in REASONING_MODELS else None

    # DeepSeek-Reasoner doesn't support system messages or temperature
    is_reasoner = model in REASONING_MODELS
    call_messages = messages
    call_temp = temperature
    if is_reasoner:
        # Merge system message into first user message for reasoner models
        if call_messages and call_messages[0].get("role") == "system":
            sys_content = call_messages[0]["content"]
            rest = call_messages[1:]
            if rest and rest[0].get("role") == "user":
                rest[0] = {"role": "user", "content": f"{sys_content}\n\n{rest[0]['content']}"}
            else:
                rest = [{"role": "user", "content": sys_content}] + rest
            call_messages = rest
        call_temp = None  # reasoner ignores temperature

    for attempt in range(3):
        try:
            client = _get_client(provider)
            kwargs = dict(model=model, messages=call_messages, max_tokens=max_tokens)
            if call_temp is not None:
                kwargs["temperature"] = call_temp
            t0 = time.time()
            response = client.chat.completions.create(**kwargs)
            latency = time.time() - t0
            choice = response.choices[0]
            content = choice.message.content or ""
            reasoning = getattr(choice.message, "reasoning_content", None) or ""
            tokens = response.usage.total_tokens if response.usage else 0
            logger.info(f"AI call: model={model} tokens={tokens} latency={latency:.1f}s")
            return {
                "content": content.strip(),
                "reasoning_content": reasoning.strip() if reasoning else "",
                "model_used": model,
                "tokens": tokens,
            }
        except Exception as e:
            wait = 2 ** (attempt + 1)
            logger.warning(f"AI call attempt {attempt+1} failed ({model}): {e}. Retrying in {wait}s...")
            if attempt < 2:
                time.sleep(wait)

    # Fallback to chat model if reasoning failed
    if fallback_model and fallback_model != model:
        logger.warning(f"Falling back from {model} to {fallback_model}")
        return _call_model(messages, model=fallback_model, purpose="chat",
                          temperature=temperature, max_tokens=max_tokens)

    raise HTTPException(status_code=502, detail=f"AI call failed after 3 retries ({model})")


@router.post("/recommend-sequences", response_model=AIRecommendResponse)
def recommend_sequences(payload: AIRecommendRequest):
    """Use AI to recommend which sequences to keep for phylogenetic analysis."""
    seq_list = "\n".join(
        f"- {s.accession}: {s.title} | {s.organism} | {s.length} aa"
        for s in payload.sequences[:500]
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
        result = _call_model(
            messages=[{"role": "user", "content": prompt}],
            purpose="chat", temperature=0.3, max_tokens=4000,
            model=getattr(payload, 'model', None),
        )
        text = result["content"]
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
    except json.JSONDecodeError:
        logger.error(f"AI response not valid JSON: {text[:500]}")
        raise HTTPException(status_code=502, detail="AI returned invalid response format")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI call failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI recommendation failed: {str(e)}")


@router.post("/recommend-alignment-params", response_model=AIAlignmentParamsResponse)
def recommend_alignment_params(payload: AIAlignmentParamsRequest):
    """Use AI to recommend optimal alignment parameters."""
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
        result = _call_model(
            messages=[{"role": "user", "content": prompt}],
            purpose="chat", temperature=0.2, max_tokens=1000,
            model=getattr(payload, 'model', None),
        )
        text = result["content"]
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI call failed: {e}")
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
        result = _call_model(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            purpose="chat", temperature=0.4, max_tokens=3000,
            model=getattr(payload, 'model', None),
        )
        ai_text = result["content"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Taxon insight AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=payload.accession,
        scope="taxon",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=result["model_used"],
    )

    # Extract and validate DOIs from AI response
    doi_refs = _extract_and_validate_dois(ai_text)
    if doi_refs:
        insight.doi_references = [ref.model_dump() for ref in doi_refs]

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
        result = _call_model(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            purpose="reasoning", temperature=0.4, max_tokens=4000,
            model=getattr(payload, 'model', None),
        )
        ai_text = result["content"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Tree insight AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=None,
        scope="tree",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=result["model_used"],
    )

    # Extract and validate DOIs from AI response
    doi_refs = _extract_and_validate_dois(ai_text)
    if doi_refs:
        insight.doi_references = [ref.model_dump() for ref in doi_refs]

    db.add(insight)
    db.commit()
    db.refresh(insight)
    return insight


# ── DOI Validation System ──


def _validate_doi(doi: str) -> DOIReference:
    """Validate a single DOI against the CrossRef API and return metadata."""
    url = f"https://api.crossref.org/works/{doi}"
    ref = DOIReference(doi=doi, url=f"https://doi.org/{doi}", validated=False)
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(url, headers={"Accept": "application/json"})
            if resp.status_code == 200:
                data = resp.json().get("message", {})
                title_parts = data.get("title", [])
                ref.title = title_parts[0] if title_parts else ""
                authors_list = data.get("author", [])
                ref.authors = ", ".join(
                    f"{a.get('family', '')}, {a.get('given', '')}"
                    for a in authors_list[:5]
                )
                if len(authors_list) > 5:
                    ref.authors += " et al."
                container = data.get("container-title", [])
                ref.journal = container[0] if container else ""
                published = data.get("published-print") or data.get("published-online") or {}
                date_parts = published.get("date-parts", [[]])
                if date_parts and date_parts[0]:
                    ref.year = date_parts[0][0]
                ref.validated = True
    except Exception as e:
        logger.warning(f"DOI validation failed for {doi}: {e}")
    return ref


def _extract_and_validate_dois(text: str) -> list[DOIReference]:
    """Extract DOI patterns from AI text and validate each via CrossRef."""
    raw_dois = DOI_PATTERN.findall(text)
    # Clean trailing punctuation
    cleaned = set()
    for d in raw_dois:
        d = d.rstrip(".,;:)]}'\"")
        cleaned.add(d)
    if not cleaned:
        return []
    refs = []
    for doi in list(cleaned)[:15]:  # Limit to 15 DOIs max
        refs.append(_validate_doi(doi))
    return refs


def _get_features_context(experiment_id: int) -> str:
    """Get feature statistics for AI context."""
    try:
        client = get_minio_client()
        data = download_file(client, "phylospark-features", f"experiments/{experiment_id}/features.json")
        features = json.loads(data)
        if not features:
            return "(no features available)"
        lines = [f"Total sequences: {len(features)}"]
        lengths = [f.get("length", 0) for f in features]
        lines.append(f"Length range: {min(lengths)}-{max(lengths)} aa, avg {sum(lengths)/len(lengths):.0f}")
        hydro = [f.get("hydrophobic_frac", 0) for f in features]
        charged = [f.get("charged_frac", 0) for f in features]
        lines.append(f"Avg hydrophobic fraction: {sum(hydro)/len(hydro):.3f}")
        lines.append(f"Avg charged fraction: {sum(charged)/len(charged):.3f}")
        for f in features[:5]:
            lines.append(f"  - {f.get('seq_id','?')}: {f.get('length',0)} aa, hydro={f.get('hydrophobic_frac',0):.3f}")
        return "\n".join(lines)
    except Exception:
        return "(features not available)"


def _get_alignment_brief(experiment_id: int) -> str:
    """Get alignment summary for AI context."""
    try:
        client = get_minio_client()
        data = download_file(client, "phylospark-alignments", f"experiments/{experiment_id}/alignment.fasta")
        fasta = data.decode("utf-8")
        seqs = []
        cur = []
        for line in fasta.strip().split("\n"):
            if line.startswith(">"):
                if cur:
                    seqs.append("".join(cur))
                cur = []
            else:
                cur.append(line.strip())
        if cur:
            seqs.append("".join(cur))
        if not seqs:
            return "(empty alignment)"
        aln_len = max(len(s) for s in seqs)
        gap_count = sum(s.count("-") for s in seqs)
        total = len(seqs) * aln_len
        return f"Alignment: {len(seqs)} sequences, length {aln_len}, gap percentage {gap_count/total*100:.1f}%"
    except Exception:
        return "(alignment not available)"


@router.post("/experiments/{experiment_id}/advanced-report", response_model=AdvancedReportResponse)
def advanced_report(experiment_id: int, payload: AdvancedReportRequest, db: Session = Depends(get_db)):
    """Generate comprehensive AI analysis with validated DOI references."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    newick = _get_tree_context(experiment_id)
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)
    features_ctx = _get_features_context(experiment_id)
    alignment_ctx = _get_alignment_brief(experiment_id)

    system_prompt = """You are an expert bioinformatics research agent specialized in molecular phylogenetics, protein evolution, and comparative genomics. You produce comprehensive scientific analyses suitable for publication or academic presentation.

CRITICAL REQUIREMENTS:
1. You MUST include real, specific DOI references to published scientific papers throughout your analysis.
2. Format every reference as: [Author et al., Year](https://doi.org/DOI_HERE)
3. Include at least 8-12 relevant DOI references from real papers about:
   - The specific protein family being analyzed
   - Phylogenetic methods used (Neighbor-Joining, MAFFT, etc.)
   - Key organisms in the dataset
   - Relevant enzyme families and their industrial/medical applications
4. Every major claim should be supported by a DOI reference.
5. Use markdown formatting with clear sections and subsections.
6. Be scientifically rigorous — cite actual landmark papers in the field."""

    user_prompt = f"""Generate a COMPREHENSIVE scientific analysis report for this phylogenetic experiment.

**Experiment:**
- Name: {exp.name}
- Query: {exp.query}
- Organism filter: {exp.organism or 'All organisms'}
- Description: {exp.description or 'N/A'}

**Phylogenetic Tree (Newick):**
{newick}

**All Taxa:**
{taxa_ctx}

**Sequence Features (Spark-computed):**
{features_ctx}

**Alignment Summary:**
{alignment_ctx}

Write a comprehensive report covering ALL of the following sections:

## 1. Executive Summary
Brief overview of the analysis, key findings, and significance.

## 2. Dataset Characterization
- Taxonomic coverage and diversity
- Sequence length distribution and statistics
- Amino acid composition patterns
- Notable outliers or interesting sequences

## 3. Phylogenetic Analysis
- Tree topology and major clades identified
- Branch length patterns and evolutionary rates
- Closest vs most distant relationships
- Support for major groupings

## 4. Evolutionary Insights
- Evidence for functional divergence
- Conservation patterns across the protein family
- Potential horizontal gene transfer events
- Molecular clock implications

## 5. Functional & Structural Analysis
- Predicted functional domains
- Active site conservation
- Structure-function relationships
- Enzyme classification context

## 6. Biotechnological & Medical Relevance
- Industrial enzyme applications
- Drug targets or antibiotic resistance
- Agricultural applications
- Bioprospecting opportunities

## 7. Statistical Assessment
- Sequence diversity metrics
- Compositional bias analysis
- Distance distribution patterns

## 8. Conclusions & Future Directions
- Key takeaways
- Recommended follow-up analyses
- Limitations of the current analysis

## References
List ALL cited DOIs with full citation."""

    if payload.user_prompt:
        user_prompt += f"\n\n**Additional focus requested:** {payload.user_prompt}"

    try:
        result = _call_model(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            purpose="reasoning", temperature=0.3, max_tokens=8000,
            model=getattr(payload, 'model', None),
        )
        ai_text = result["content"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Advanced report AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI report generation failed: {str(e)}")

    doi_refs = _extract_and_validate_dois(ai_text)

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=None,
        scope="advanced_report",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=result["model_used"],
        doi_references=[ref.model_dump() for ref in doi_refs] if doi_refs else [],
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)

    return AdvancedReportResponse(
        id=insight.id,
        experiment_id=insight.experiment_id,
        scope=insight.scope,
        ai_response=insight.ai_response,
        doi_references=doi_refs,
        model_used=insight.model_used,
        created_at=insight.created_at,
    )


def _get_alignment_detailed(experiment_id: int) -> str:
    """Get detailed alignment context including per-column conservation summary."""
    try:
        client = get_minio_client()
        data = download_file(client, "phylospark-alignments", f"experiments/{experiment_id}/alignment.fasta")
        fasta = data.decode("utf-8")
        seqs = []
        ids = []
        cur = []
        cur_id = ""
        for line in fasta.strip().split("\n"):
            if line.startswith(">"):
                if cur:
                    seqs.append("".join(cur))
                    ids.append(cur_id)
                cur_id = line[1:].strip().split()[0]
                cur = []
            else:
                cur.append(line.strip())
        if cur:
            seqs.append("".join(cur))
            ids.append(cur_id)
        if not seqs:
            return "(empty alignment)"
        aln_len = max(len(s) for s in seqs)
        gap_count = sum(s.count("-") for s in seqs)
        total = len(seqs) * aln_len
        gap_pct = gap_count / total * 100 if total > 0 else 0

        # Compute per-column conservation summary
        highly_conserved = 0
        moderate = 0
        variable = 0
        for col in range(min(aln_len, 5000)):
            column = [s[col].upper() if col < len(s) else "-" for s in seqs]
            non_gap = [c for c in column if c != "-"]
            if non_gap:
                from collections import Counter
                counts = Counter(non_gap)
                top = counts.most_common(1)[0][1] / len(column)
                if top > 0.8:
                    highly_conserved += 1
                elif top > 0.5:
                    moderate += 1
                else:
                    variable += 1

        # Identify conserved blocks (runs of >80% conservation)
        lines = [
            f"Alignment: {len(seqs)} sequences, length {aln_len} positions",
            f"Gap percentage: {gap_pct:.1f}%",
            f"Highly conserved positions (>80%): {highly_conserved} ({highly_conserved/aln_len*100:.1f}%)" if aln_len else "",
            f"Moderately conserved (50-80%): {moderate}",
            f"Variable positions (<50%): {variable}",
            f"Sequence IDs: {', '.join(ids[:30])}{'...' if len(ids)>30 else ''}",
        ]
        # Add first 10 seq lengths
        for i, (sid, s) in enumerate(zip(ids[:10], seqs[:10])):
            real_len = len(s.replace("-", ""))
            lines.append(f"  {sid}: {real_len} aa ({len(s)} aligned)")

        return "\n".join(lines)
    except Exception:
        return "(alignment not available)"


@router.post("/experiments/{experiment_id}/alignment-report", response_model=AdvancedReportResponse)
def alignment_report(experiment_id: int, payload: AlignmentReportRequest, db: Session = Depends(get_db)):
    """Generate deep AI analysis of the MSA alignment with DOI references."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    alignment_detail = _get_alignment_detailed(experiment_id)
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)
    features_ctx = _get_features_context(experiment_id)
    newick = _get_tree_context(experiment_id)

    system_prompt = """You are a world-class bioinformatics expert specializing in multiple sequence alignment (MSA) analysis, protein conservation, and molecular evolution. You produce rigorous scientific reports suitable for academic publication.

CRITICAL REQUIREMENTS:
1. Include REAL DOI references from published scientific papers. Format: [Author et al., Year](https://doi.org/DOI_HERE)
2. Include at least 8-12 DOI references from papers about:
   - MSA methods (MAFFT: Katoh & Standley 2013, MUSCLE: Edgar 2004)
   - Conservation scoring (Valdar 2002, Capra & Singh 2007)
   - The specific protein family analyzed
   - Gap analysis methodology
   - Substitution matrices (BLOSUM62: Henikoff & Henikoff 1992)
3. Every major scientific claim must cite a real DOI.
4. Use markdown with clear headings, bullet points, and tables.
5. Be precise: cite actual numbers from the data provided."""

    user_prompt = f"""Generate a COMPREHENSIVE scientific analysis of this Multiple Sequence Alignment.

**Experiment:**
- Name: {exp.name}
- Query: {exp.query}
- Organism: {exp.organism or 'All organisms'}

**Alignment Data:**
{alignment_detail}

**Taxa in alignment:**
{taxa_ctx}

**Sequence features (Spark-computed):**
{features_ctx}

**Phylogenetic tree:**
{newick}

Write a comprehensive MSA analysis report covering ALL sections:

## 1. Alignment Overview & Quality Assessment
- Summary statistics (sequences, length, gaps, conservation)
- Overall alignment quality evaluation
- Comparison to expected alignment characteristics for this protein family

## 2. Conservation Analysis
- Highly conserved regions and their biological significance
- Active site motifs and catalytic residues (if identifiable)
- Conservation pattern across different taxonomic groups
- Relationship between conservation and known functional domains

## 3. Gap Analysis & Indel Patterns
- Gap distribution across sequences (which organisms have insertions/deletions)
- Gap-rich regions vs gap-free blocks
- Biological interpretation: do gaps correlate with known structural features?
- Impact on alignment quality and phylogenetic inference

## 4. Substitution Patterns & Evolutionary Rates
- Amino acid substitution patterns observed
- Position-specific evolutionary rates
- Synonymous vs non-synonymous change implications
- Selective pressure indicators (conserved vs rapidly evolving sites)

## 5. Sequence Diversity & Clustering
- Pairwise identity distribution
- Sequence groups/clusters based on similarity
- Outlier sequences and their implications
- Taxonomic representation assessment

## 6. Functional Domain Mapping
- Known domains in this protein family
- Conserved motifs mapped to alignment positions
- Predicted functional importance of conserved blocks
- Structure-function correlations

## 7. Methodological Assessment
- Suitability of alignment method used
- Impact of selected parameters on results
- Potential alignment artifacts or concerns
- Recommendations for refinement

## 8. Key Findings & Scientific Significance
- Top 5 most important discoveries
- How results relate to current literature
- Novel observations worth further investigation
- Practical implications (biotechnological, medical, ecological)

## References
Full citation list with validated DOIs."""

    if payload.user_prompt:
        user_prompt += f"\n\n**Additional focus requested:** {payload.user_prompt}"

    try:
        result = _call_model(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            purpose="reasoning", temperature=0.3, max_tokens=8000,
            model=getattr(payload, 'model', None),
        )
        ai_text = result["content"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Alignment report AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI alignment report failed: {str(e)}")

    doi_refs = _extract_and_validate_dois(ai_text)

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=None,
        scope="alignment_report",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=result["model_used"],
        doi_references=[ref.model_dump() for ref in doi_refs] if doi_refs else [],
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)

    return AdvancedReportResponse(
        id=insight.id,
        experiment_id=insight.experiment_id,
        scope=insight.scope,
        ai_response=insight.ai_response,
        doi_references=doi_refs,
        model_used=insight.model_used,
        created_at=insight.created_at,
    )


@router.post("/experiments/{experiment_id}/alignment-chat", response_model=AlignmentChatResponse)
def alignment_chat(experiment_id: int, payload: AlignmentChatRequest, db: Session = Depends(get_db)):
    """Conversational AI chat about the alignment with full context. Supports conversation history."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    alignment_detail = _get_alignment_detailed(experiment_id)
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)
    features_ctx = _get_features_context(experiment_id)

    system_prompt = f"""You are an expert bioinformatics research assistant having a conversation about a Multiple Sequence Alignment.

You have access to full experimental context:

**Experiment:** {exp.name}
**Query:** {exp.query}
**Organism:** {exp.organism or 'All'}

**Alignment data:**
{alignment_detail}

**Sequence metadata:**
{taxa_ctx}

**Computed features:**
{features_ctx}

RULES:
- Answer the user's questions with scientific rigor and depth
- Include specific DOI references when making scientific claims. Format: [Author et al., Year](https://doi.org/DOI_HERE)
- Reference actual data from the alignment when possible (sequence names, positions, conservation values)
- If the user asks for analysis of specific regions or sequences, provide detailed answers
- Use markdown formatting for clarity
- Be conversational but scientifically precise
- Build on previous conversation context provided"""

    messages = [{"role": "system", "content": system_prompt}]

    # Add conversation history for context continuity
    if payload.conversation_history:
        for msg in payload.conversation_history[-10:]:  # Last 10 messages max
            messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": payload.user_prompt})

    try:
        result = _call_model(
            messages=messages,
            purpose="chat", temperature=0.4, max_tokens=4000,
            model=getattr(payload, 'model', None),
        )
        ai_text = result["content"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Alignment chat AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI chat failed: {str(e)}")

    doi_refs = _extract_and_validate_dois(ai_text)

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=None,
        scope="alignment_chat",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=result["model_used"],
        doi_references=[ref.model_dump() for ref in doi_refs] if doi_refs else None,
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)
    return insight


@router.post("/experiments/{experiment_id}/stats-report", response_model=AdvancedReportResponse)
def stats_report(experiment_id: int, payload: StatsReportRequest, db: Session = Depends(get_db)):
    """Generate deep AI analysis of sequence statistics with DOI references."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    features_ctx = _get_features_context(experiment_id)
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)
    alignment_ctx = _get_alignment_brief(experiment_id)
    newick = _get_tree_context(experiment_id)

    # Get distance matrix summary
    dist_ctx = ""
    try:
        minio_client = get_minio_client()
        dist_data = download_file(minio_client, "phylospark-features", f"experiments/{experiment_id}/distances.json")
        distances = json.loads(dist_data)
        if distances:
            dists = [d.get("euclidean_distance", 0) for d in distances]
            dist_ctx = f"\nPairwise distances: {len(distances)} pairs, min={min(dists):.4f}, max={max(dists):.4f}, avg={sum(dists)/len(dists):.4f}"
    except Exception:
        pass

    system_prompt = """You are a world-class bioinformatics expert specializing in sequence analysis, protein biochemistry, and statistical analysis. You produce rigorous scientific reports suitable for academic publication.

CRITICAL REQUIREMENTS:
1. Include REAL DOI references from published scientific papers. Format: [Author et al., Year](https://doi.org/DOI_HERE)
2. Include at least 8-12 DOI references about:
   - Amino acid composition analysis methods
   - Hydrophobicity scales (Kyte-Doolittle: PMID 7108955)
   - Sequence feature engineering approaches
   - Statistical methods for bioinformatics
   - The protein family being studied
3. Use precise numbers from the data provided.
4. Use markdown formatting with tables where appropriate."""

    user_prompt = f"""Generate a COMPREHENSIVE scientific analysis report for the sequence statistics of this experiment.

**Experiment:**
- Name: {exp.name}
- Query: {exp.query}
- Organism: {exp.organism or 'All organisms'}

**Sequence Features (PySpark-computed):**
{features_ctx}

**Taxa:**
{taxa_ctx}

**Alignment summary:**
{alignment_ctx}
{dist_ctx}

**Phylogenetic tree:**
{newick}

Write a comprehensive report covering ALL sections:

## 1. Dataset Overview
- Number of sequences, taxonomic composition, diversity metrics
- Data quality assessment

## 2. Sequence Length Analysis
- Distribution statistics (mean, median, std, range, quartiles)
- Outlier identification and biological interpretation
- Length variation across taxonomic groups

## 3. Amino Acid Composition Analysis
- Global composition profile vs expected proteome frequencies
- Over/under-represented amino acids and their implications
- Composition differences between sequence clusters
- Correlation with protein function and structure

## 4. Physicochemical Property Analysis
- Hydrophobic fraction analysis (Kyte-Doolittle scale context)
- Charged residue distribution (acidic vs basic balance)
- Aromatics, aliphatics, and their structural roles
- isoelectric point predictions based on charged fractions

## 5. Pairwise Distance Analysis
- Distance distribution and what it reveals about divergence
- Closest and most distant pairs — biological significance
- Clustering patterns from distance data
- Consistency with phylogenetic tree topology

## 6. Feature Engineering Insights (PySpark)
- How computed features relate to protein function
- Machine learning feature importance implications
- Predictive power of different feature categories

## 7. Comparative Analysis
- How these sequences compare to known protein family members
- Expected vs observed feature distributions
- Anomalies that suggest novel variants or misannotations

## 8. Key Findings & Recommendations
- Top scientific insights
- Suggested experimental validations
- Further computational analyses recommended

## References
Full citation list with validated DOIs."""

    if payload.user_prompt:
        user_prompt += f"\n\n**Additional focus requested:** {payload.user_prompt}"

    try:
        result = _call_model(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            purpose="reasoning", temperature=0.3, max_tokens=8000,
            model=getattr(payload, 'model', None),
        )
        ai_text = result["content"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stats report AI failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI stats report failed: {str(e)}")

    doi_refs = _extract_and_validate_dois(ai_text)

    insight = TaxonInsight(
        experiment_id=experiment_id,
        accession=None,
        scope="stats_report",
        user_prompt=payload.user_prompt,
        ai_response=ai_text,
        model_used=result["model_used"],
        doi_references=[ref.model_dump() for ref in doi_refs] if doi_refs else [],
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)

    return AdvancedReportResponse(
        id=insight.id,
        experiment_id=insight.experiment_id,
        scope=insight.scope,
        ai_response=insight.ai_response,
        doi_references=doi_refs,
        model_used=insight.model_used,
        created_at=insight.created_at,
    )


# ── New endpoints: models, cached analysis, chart analysis ──


@router.get("/models", response_model=list[ModelInfo])
def list_models():
    """List all available AI models with their capabilities."""
    settings = get_settings()
    models = []

    if settings.deepseek_api_key:
        models.append(ModelInfo(
            id="deepseek-chat", label="DeepSeek Chat", provider="deepseek",
            type="chat", is_default=(settings.default_chat_model == "deepseek-chat"),
        ))
        models.append(ModelInfo(
            id="deepseek-reasoner", label="DeepSeek Reasoner", provider="deepseek",
            type="reasoning", is_default=(settings.default_reasoning_model == "deepseek-reasoner"),
        ))

    if settings.openai_api_key:
        models.append(ModelInfo(
            id="gpt-4o-mini", label="GPT-4o Mini", provider="openai",
            type="chat", is_default=(settings.default_chat_model == "gpt-4o-mini"),
        ))
        models.append(ModelInfo(
            id="gpt-4o", label="GPT-4o", provider="openai",
            type="reasoning", is_default=False,
        ))

    return models


@router.get("/models/{model_id}/health")
def model_health(model_id: str):
    """Quick health check for a specific model."""
    try:
        result = _call_model(
            messages=[{"role": "user", "content": "Reply OK"}],
            model=model_id, purpose="chat", temperature=0.0, max_tokens=10,
        )
        return {"model": model_id, "status": "healthy", "response": result["content"][:50]}
    except Exception as e:
        return {"model": model_id, "status": "unhealthy", "error": str(e)}


@router.get("/experiments/{experiment_id}/cached-analysis", response_model=CachedAnalysisResponse)
def cached_analysis(experiment_id: int, scope: str, db: Session = Depends(get_db)):
    """Get cached AI analysis, or generate and cache if not found."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    # Check for existing cached analysis
    existing = db.query(TaxonInsight).filter(
        TaxonInsight.experiment_id == experiment_id,
        TaxonInsight.scope == scope,
    ).order_by(TaxonInsight.created_at.desc()).first()

    if existing:
        doi_refs = []
        if existing.doi_references:
            doi_refs = [DOIReference(**r) if isinstance(r, dict) else r for r in existing.doi_references]
        return CachedAnalysisResponse(
            cached=True,
            insight=InsightResponse(
                id=existing.id, experiment_id=existing.experiment_id,
                accession=existing.accession, scope=existing.scope,
                user_prompt=existing.user_prompt, ai_response=existing.ai_response,
                model_used=existing.model_used, doi_references=doi_refs,
                created_at=existing.created_at,
            ),
        )

    # No cached analysis — return null insight (generation is done via POST chart-analysis)
    return CachedAnalysisResponse(cached=False, insight=None)


def _generate_chart_cached(experiment_id: int, scope: str, exp: Experiment, db: Session) -> CachedAnalysisResponse:
    """Generate and cache chart-specific or auto-scope AI analysis."""
    taxa_ctx = _get_taxon_meta_context(experiment_id, db)

    # ── Auto scopes: comprehensive section-level analysis ──
    auto_configs = {
        "stats_auto": {
            "context_fn": lambda: _get_features_context(experiment_id),
            "prompt": "Provide a comprehensive statistical analysis of this protein dataset. Cover sequence length distribution, amino acid composition patterns, hydrophobicity and charge distributions, and any notable outliers. Identify key biochemical trends and their biological significance.",
            "system": "You are a bioinformatics expert specializing in protein sequence statistics. Provide a thorough 3-4 paragraph analysis covering key statistical patterns and their biological meaning. Reference actual numbers. Include 2-3 DOI references. Format: [Author et al., Year](https://doi.org/DOI_HERE).",
            "purpose": "reasoning",
            "max_tokens": 4000,
        },
        "alignment_auto": {
            "context_fn": lambda: _get_alignment_detailed(experiment_id),
            "prompt": "Provide a comprehensive analysis of this multiple sequence alignment. Cover conservation patterns, gap distribution, highly conserved motifs, variable regions, and what these patterns reveal about the protein family's evolutionary constraints and functional domains.",
            "system": "You are a bioinformatics expert specializing in multiple sequence alignment analysis. Provide a thorough 3-4 paragraph analysis of alignment quality, conservation, and evolutionary implications. Reference actual numbers. Include 2-3 DOI references. Format: [Author et al., Year](https://doi.org/DOI_HERE).",
            "purpose": "reasoning",
            "max_tokens": 4000,
        },
        "tree_auto": {
            "context_fn": lambda: _get_tree_context(experiment_id),
            "prompt": "Provide a comprehensive phylogenetic analysis. Discuss tree topology, major clades, branch length patterns, evolutionary relationships, and any interesting groupings or outliers. Relate the tree structure to the taxonomic distribution of the organisms.",
            "system": "You are a bioinformatics expert specializing in phylogenetics. Provide a thorough 3-4 paragraph analysis of the phylogenetic tree structure and its evolutionary implications. Reference actual numbers. Include 2-3 DOI references. Format: [Author et al., Year](https://doi.org/DOI_HERE).",
            "purpose": "reasoning",
            "max_tokens": 4000,
        },
    }

    if scope in auto_configs:
        cfg = auto_configs[scope]
        data_ctx = cfg["context_fn"]()
        user_prompt = f"Experiment: {exp.name} (Query: {exp.query})\n\n{cfg['prompt']}\n\nData:\n{data_ctx}\n\nTaxa:\n{taxa_ctx}"
        result = _call_model(
            messages=[{"role": "system", "content": cfg["system"]}, {"role": "user", "content": user_prompt}],
            purpose=cfg["purpose"], temperature=0.3, max_tokens=cfg["max_tokens"],
        )
    else:
        # ── Chart-specific scopes ──
        chart_type = scope.replace("chart_", "")
        features_ctx = _get_features_context(experiment_id)

        chart_prompts = {
            "length_distribution": "Analyze the sequence length distribution. Discuss outliers, central tendency, and what the distribution shape suggests about this protein family.",
            "aa_composition": "Analyze the amino acid composition patterns. Identify over/under-represented residues and their functional implications.",
            "hydrophobic_charged": "Analyze the hydrophobic vs charged fraction distribution. Discuss what this reveals about protein structure and membrane association.",
            "distance_matrix": "Analyze the pairwise distance matrix. Discuss clustering patterns, outliers, and evolutionary divergence.",
            "entropy": "Analyze the Shannon entropy per position. Identify highly variable and highly conserved regions and their biological significance.",
            "taxonomy": "Analyze the taxonomic distribution. Discuss diversity, dominant genera, and representation gaps.",
            "lengths": "Analyze the sequence length variation across taxa. Discuss how length relates to function and taxonomy.",
            "features": "Analyze the computed biochemical features. Discuss hydrophobicity, charge, and molecular weight patterns.",
        }

        prompt = chart_prompts.get(chart_type, f"Analyze the {chart_type} data and provide key scientific insights.")

        system_prompt = """You are a bioinformatics expert. Provide a focused 2-3 paragraph analysis of this specific chart/metric.
Be precise, reference actual numbers, and suggest what the pattern means biologically.
Include 1-2 DOI references if relevant. Format: [Author et al., Year](https://doi.org/DOI_HERE)."""

        user_prompt = f"Experiment: {exp.name} (Query: {exp.query})\n\n{prompt}\n\nData:\n{features_ctx}\n\nTaxa:\n{taxa_ctx}"

        result = _call_model(
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            purpose="chat", temperature=0.3, max_tokens=2000,
        )

    doi_refs = _extract_and_validate_dois(result["content"])

    insight = TaxonInsight(
        experiment_id=experiment_id, accession=None, scope=scope,
        user_prompt=None, ai_response=result["content"],
        model_used=result["model_used"],
        doi_references=[ref.model_dump() for ref in doi_refs] if doi_refs else [],
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)

    return CachedAnalysisResponse(
        cached=False,
        insight=InsightResponse(
            id=insight.id, experiment_id=insight.experiment_id,
            accession=insight.accession, scope=insight.scope,
            user_prompt=insight.user_prompt, ai_response=insight.ai_response,
            model_used=insight.model_used, doi_references=doi_refs,
            created_at=insight.created_at,
        ),
    )


@router.post("/experiments/{experiment_id}/chart-analysis", response_model=CachedAnalysisResponse)
def chart_analysis(experiment_id: int, payload: ChartAnalysisRequest, db: Session = Depends(get_db)):
    """Generate focused AI analysis for a specific chart type or auto scope."""
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if exp.status != ExperimentStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Pipeline must complete first")

    # Determine scope: auto scopes pass as-is, chart types get prefixed
    auto_scopes = {"stats_auto", "alignment_auto", "tree_auto"}
    if payload.chart_type in auto_scopes:
        scope = payload.chart_type
    elif payload.chart_type.startswith("chart_"):
        scope = payload.chart_type
    else:
        scope = f"chart_{payload.chart_type}"

    # Check cache first
    existing = db.query(TaxonInsight).filter(
        TaxonInsight.experiment_id == experiment_id,
        TaxonInsight.scope == scope,
    ).order_by(TaxonInsight.created_at.desc()).first()

    if existing and not payload.force_refresh:
        doi_refs = []
        if existing.doi_references:
            doi_refs = [DOIReference(**r) if isinstance(r, dict) else r for r in existing.doi_references]
        return CachedAnalysisResponse(
            cached=True,
            insight=InsightResponse(
                id=existing.id, experiment_id=existing.experiment_id,
                accession=existing.accession, scope=existing.scope,
                user_prompt=existing.user_prompt, ai_response=existing.ai_response,
                model_used=existing.model_used, doi_references=doi_refs,
                created_at=existing.created_at,
            ),
        )

    return _generate_chart_cached(experiment_id, scope, exp, db)