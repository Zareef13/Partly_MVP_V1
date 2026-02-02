from fastapi import FastAPI

app = FastAPI(title="Partly MVP API")

@app.get("/health")
def health():
    return {"ok": True}