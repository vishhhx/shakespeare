from qdrant_client import QdrantClient
from dotenv import load_dotenv
import os

load_dotenv()

client = QdrantClient(
    url=os.getenv("QDRANT_URL", "http://localhost:6333"),
    api_key=os.getenv("QDRANT_API_KEY") or None,
)

client.recreate_collection(
    collection_name="faces",
    vectors_config={
        "size": 512,
        "distance": "Cosine"
    }
)

print("Collection created!")