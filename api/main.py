from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import experiments, ncbi, ai, ws

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="PhyloSpark API",
    description="Bioinformatics phylogenetic analysis platform powered by Spark + Airflow",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://phylo.automation.com.mx", "https://phylo.automation.com.mx"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(experiments.router, prefix="/api/v1")
app.include_router(ncbi.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(ws.router)  # WebSocket at /ws/... and REST at /api/v1/...


@app.get("/health")
def health():
    return {"status": "ok", "service": "phylospark-api", "version": "0.2.0"}
