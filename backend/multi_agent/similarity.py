"""
Semantic similarity utilities for question deduplication.

Uses text-embedding-3-small to embed questions and cosine similarity
to detect semantically equivalent questions phrased differently.
"""

from typing import List, Optional

from services.judge_engine import get_openai_client


async def get_embedding(text: str) -> Optional[List[float]]:
    """Call text-embedding-3-small and return the embedding vector."""
    client = get_openai_client()
    if not client:
        return None
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text.strip(),
    )
    return response.data[0].embedding


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Pure-Python cosine similarity (no numpy needed)."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def is_semantic_duplicate(
    candidate_embedding: List[float],
    stored_embeddings: List[List[float]],
    threshold: float = 0.85,
) -> bool:
    """Return True if candidate is too similar to any stored embedding."""
    return any(
        cosine_similarity(candidate_embedding, stored) >= threshold
        for stored in stored_embeddings
    )
