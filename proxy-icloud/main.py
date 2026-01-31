import uvicorn

DEFAULT_PORT=58888

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=DEFAULT_PORT, reload=True)