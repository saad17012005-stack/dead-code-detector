from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
from sentence_transformers import SentenceTransformer
import warnings
import os

# Suppress some common huggingface warnings
warnings.filterwarnings("ignore")

app = FastAPI(title="Embedding Service")

# Load a standard 768-dimensional model. 
# all-mpnet-base-v2 yields exactly 768 dims, matching our database expectation.
model = SentenceTransformer('sentence-transformers/all-mpnet-base-v2')

class EmbedRequest(BaseModel):
    code_snippets: List[str]

class EmbedResponse(BaseModel):
    embeddings: List[List[float]]

@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest):
    if not request.code_snippets:
        return EmbedResponse(embeddings=[])
        
    # Generate real semantic embeddings
    # We use tolist() because fastapi requires standard python lists, not numpy arrays
    embeddings = model.encode(request.code_snippets).tolist()
    
    return EmbedResponse(embeddings=embeddings)

if __name__ == "__main__":
    import uvicorn
    # Use port 8000 as expected by our Docker compose and workers
    uvicorn.run(app, host="0.0.0.0", port=8000)
