from fastapi import FastAPI, HTTPException, Response

from metrics import Metrics, collector

app = FastAPI(title="First Server")


@app.get("/")
def welcome() -> dict[str, str]:
    return {"message": "مرحبًا بك في أول تطبيق FastAPI!"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/metrics", response_model=Metrics)
@app.get("/metrics", response_model=Metrics, include_in_schema=False)
async def metrics(response: Response) -> Metrics:
    # /metrics supports existing proxies that strip the /api/ prefix.
    response.headers["Cache-Control"] = "no-store"
    try:
        return await collector.snapshot()
    except (OSError, ValueError, KeyError, IndexError):
        raise HTTPException(
            status_code=503,
            detail="Metrics temporarily unavailable",
            headers={"Cache-Control": "no-store"},
        ) from None
