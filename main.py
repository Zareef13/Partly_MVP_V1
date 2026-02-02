import os
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# -----------------------------
# Models
# -----------------------------

class EnrichRequest(BaseModel):
    mpns: List[str]
    manufacturer: Optional[str] = None


# -----------------------------
# App setup
# -----------------------------

app = FastAPI(
    title="Partly Enrichment API",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Health & root
# -----------------------------

@app.get("/")
def root():
    return {
        "service": "partly-backend",
        "status": "running"
    }

@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# Core enrichment stub
# -----------------------------

def enrich_single_mpn(mpn: str, manufacturer: Optional[str] = None):
    """
    TEMPORARY STUB.
    Replace body with your real normalization + datasheet merge pipeline.
    """
    return {
        "mpn": mpn,
        "manufacturer": manufacturer,
        "note": "stub response – replace with real enrichment logic"
    }


# -----------------------------
# API
# -----------------------------

@app.post("/enrich")
def enrich_parts(payload: EnrichRequest):
    results = []

    for mpn in payload.mpns:
        try:
            product = enrich_single_mpn(
                mpn=mpn,
                manufacturer=payload.manufacturer
            )

            results.append({
                "mpn": mpn,
                "status": "ok",
                "data": product
            })

        except Exception as e:
            results.append({
                "mpn": mpn,
                "status": "error",
                "error": str(e)
            })

    return {
        "count": len(results),
        "results": results
    }