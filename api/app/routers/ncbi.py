from fastapi import APIRouter, HTTPException
from app.schemas import NCBISearchRequest, NCBISearchResponse, SequenceInfo
from app.config import get_settings
from Bio import Entrez
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ncbi", tags=["ncbi"])


@router.post("/search", response_model=NCBISearchResponse)
def search_ncbi(payload: NCBISearchRequest):
    """Search NCBI and return sequence metadata for selection UI."""
    settings = get_settings()
    Entrez.email = settings.ncbi_email or "phylospark@example.com"
    if settings.ncbi_api_key:
        Entrez.api_key = settings.ncbi_api_key

    search_term = f"{payload.query}[Title]"
    if payload.organism:
        search_term += f" AND {payload.organism}[Organism]"

    try:
        # Step 1: Search for IDs
        handle = Entrez.esearch(db=payload.db, term=search_term, retmax=payload.max_results)
        record = Entrez.read(handle)
        handle.close()

        id_list = record.get("IdList", [])
        total_count = int(record.get("Count", 0))

        if not id_list:
            return NCBISearchResponse(sequences=[], total_found=0, query_used=search_term)

        # Step 2: Get detailed summaries for each ID
        handle = Entrez.esummary(db=payload.db, id=",".join(id_list))
        summaries = Entrez.read(handle)
        handle.close()

        sequences = []
        for item in summaries:
            acc = item.get("AccessionVersion", item.get("Caption", ""))
            title = item.get("Title", "Unknown")
            org = item.get("Organism", "")
            # Extract organism from title brackets if not in summary
            if not org and "[" in title:
                org = title.rsplit("[", 1)[-1].rstrip("]")
            org = org or "Unknown"
            length = int(item.get("Length", item.get("Slen", 0)))
            uid = str(item.get("Id", item.get("Uid", "")))

            sequences.append(SequenceInfo(
                accession=acc,
                title=title,
                organism=org,
                length=length,
                uid=uid,
            ))

        return NCBISearchResponse(
            sequences=sequences,
            total_found=total_count,
            query_used=search_term,
        )
    except Exception as e:
        logger.error(f"NCBI search failed: {e}")
        raise HTTPException(status_code=502, detail=f"NCBI search failed: {str(e)}")
