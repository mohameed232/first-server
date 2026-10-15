from fastapi import FastAPI

app = FastAPI(title="First Server")


@app.get("/")
def welcome() -> dict[str, str]:
    return {"message": "مرحبًا بك في أول تطبيق FastAPI!"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
