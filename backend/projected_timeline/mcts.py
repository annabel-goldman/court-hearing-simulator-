"""
Monte Carlo Tree Search over predicted hearing topic sequences.

Two modes
---------
Generator mode  : Build a tree from the full topic pool.
                  Call run_generation(topics, n_sims, top_k) → list of ranked paths.
                  Each path becomes one TopicPrediction (replaces one LLM agenda call).

Projector mode  : Given the current coverage state, project remaining topics.
                  Call run_projection(remaining_topics, n_sims) → ordered list of titles.

Value function
--------------
Rollouts are embedding-based (no LLM), using the same _embed / _cosine helpers
that the trajectory tracker already loads.  This makes simulations very fast —
thousands per second even on CPU.

  score = mean_consecutive_cosine + 0.1 * coverage_fraction
          ↑ topic-to-topic thematic flow    ↑ bonus for covering more ground
"""

from __future__ import annotations

import logging
import math
import random
from typing import Callable, Dict, List, Optional

import anyio

logger = logging.getLogger("court-simulator.projected_timeline.mcts")

# Re-use the embedding helpers already loaded by the tracker.
# They're module-level callables with lazy model initialisation.
from .tracker import _embed, _cosine  # noqa: PLC2701


# ---------------------------------------------------------------------------
# MCTS Node
# ---------------------------------------------------------------------------

class _Node:
    """One node in the MCTS tree.

    `state` is an ordered tuple of topic titles that have been 'addressed'
    on the path from the root to this node.
    """

    __slots__ = ("state", "parent", "children", "visits", "value", "_untried")

    def __init__(
        self,
        state: tuple[str, ...],
        parent: Optional[_Node],
        untried: List[str],   # topic titles not yet added to this path
    ):
        self.state    = state
        self.parent   = parent
        self.children: Dict[str, _Node] = {}
        self.visits   = 0
        self.value    = 0.0
        self._untried = list(untried)   # mutable copy; consumed as we expand

    # ------------------------------------------------------------------
    # UCB1 selection score (from parent's perspective)
    # ------------------------------------------------------------------

    def ucb1(self, exploration: float = math.sqrt(2)) -> float:
        if self.visits == 0:
            return float("inf")
        parent_visits = self.parent.visits if self.parent else self.visits
        return (
            self.value / self.visits
            + exploration * math.sqrt(math.log(parent_visits) / self.visits)
        )

    def is_fully_expanded(self) -> bool:
        return len(self._untried) == 0

    def best_child(self, exploration: float = math.sqrt(2)) -> _Node:
        return max(self.children.values(), key=lambda c: c.ucb1(exploration))


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _score_sequence(
    titles: List[str],
    vec_map: Dict[str, List],
    quality_map: Optional[Dict[str, float]] = None,
) -> float:
    """
    Score an ordered sequence of topic titles.

    Score = mean cosine similarity between consecutive pairs
            + 0.1 * (len(sequence) / total_topics) as a coverage bonus
            - quality penalties for weak topics (if quality_map provided).

    When quality_map is present (live projection mode), topics the advocate
    argued weakly are penalised and unaddressed topics (missing from the map
    entirely) get an urgency bonus — the projector steers toward gaps and
    weaknesses the bench should probe.
    """
    if len(titles) < 2:
        return 0.0

    total = len(vec_map)
    pairs = [(titles[i], titles[i + 1]) for i in range(len(titles) - 1)]
    sim_sum = sum(
        _cosine(vec_map[a], vec_map[b])
        for a, b in pairs
        if a in vec_map and b in vec_map
    )
    mean_sim = sim_sum / len(pairs)
    coverage_bonus = 0.1 * (len(titles) / max(total, 1))

    quality_adjustment = 0.0
    if quality_map:
        for t in titles:
            q = quality_map.get(t)
            if q is None:
                # Unaddressed — urgency bonus to steer toward it
                quality_adjustment += 0.08
            elif q < 0.4:
                # Weak argument — bonus to re-probe
                quality_adjustment += 0.05
            elif q > 0.7:
                # Strong — mild penalty (no need to revisit)
                quality_adjustment -= 0.03

    return mean_sim + coverage_bonus + quality_adjustment


_ROLLOUT_EPSILON = 0.25   # probability of random pick vs. greedy nearest-neighbour


def _rollout(
    node_state: tuple[str, ...],
    remaining: List[str],
    vec_map: Dict,
    quality_map: Optional[Dict[str, float]] = None,
    max_steps: Optional[int] = None,
) -> float:
    """
    Simulate an epsilon-greedy completion of the path and return its score.

    At each step, with probability (1 - _ROLLOUT_EPSILON) pick the topic whose
    embedding is most similar to the last-placed topic (greedy thematic flow).
    With probability _ROLLOUT_EPSILON pick uniformly at random to maintain
    diversity and avoid premature convergence.

    When quality_map is provided (live projection), weak/unaddressed topics
    get a selection bonus so the projector gravitates toward them.

    max_steps limits how many topics to add during the rollout (used by sparse
    MCTS to keep rollouts shallow during initial generation).
    """
    if not remaining:
        return _score_sequence(list(node_state), vec_map, quality_map)
    path = list(node_state)
    pool = list(remaining)
    steps = 0
    while pool and (max_steps is None or steps < max_steps):
        if path and random.random() > _ROLLOUT_EPSILON:
            last_vec = vec_map.get(path[-1])
            if last_vec is not None:
                def _pick_score(t):
                    cos = _cosine(vec_map[t], last_vec) if t in vec_map else 0.0
                    if quality_map:
                        q = quality_map.get(t)
                        if q is None:
                            cos += 0.15   # strong pull toward unaddressed
                        elif q < 0.4:
                            cos += 0.08   # pull toward weak
                    return cos
                next_title = max(pool, key=_pick_score)
            else:
                next_title = random.choice(pool)
        else:
            next_title = random.choice(pool)
        path.append(next_title)
        pool.remove(next_title)
        steps += 1
    return _score_sequence(path, vec_map, quality_map)


# ---------------------------------------------------------------------------
# Core MCTS loop (shared by both modes)
# ---------------------------------------------------------------------------

def _run_mcts(
    topic_pool: List[Dict],
    n_sims: int,
    quality_map: Optional[Dict[str, float]] = None,
    max_depth: Optional[int] = None,
) -> _Node:
    """
    Run n_sims MCTS simulations starting from an empty root state.

    Returns the root node; callers extract best paths from the tree.

    topic_pool entries must have keys: "title", "vector"
    (call _prepare_pool first to add vector keys).

    quality_map — optional title→float (0–1) from the live tracker.
    When provided, the rollout and scoring functions bias toward weak /
    unaddressed topics so the projector recommends what needs attention.

    max_depth — when set, limits the tree to this many topics per path.
    Nodes at max_depth are treated as leaves (no further expansion).
    Used by sparse MCTS: initial generation creates shallow trees, then
    live projection expands deeper as the student progresses.
    """
    titles   = [t["title"] for t in topic_pool]
    vec_map  = {t["title"]: t["vector"] for t in topic_pool}

    root = _Node(state=(), parent=None, untried=list(titles))

    for _ in range(n_sims):
        node = root

        # ── 1. Selection ──────────────────────────────────────────────
        while node.is_fully_expanded() and node.children:
            node = node.best_child()

        # ── 2. Expansion (respect max_depth) ──────────────────────────
        at_depth_limit = max_depth is not None and len(node.state) >= max_depth
        if node._untried and not at_depth_limit:
            action = node._untried.pop(random.randrange(len(node._untried)))
            new_state     = node.state + (action,)
            new_state_set = frozenset(new_state)
            if max_depth is not None and len(new_state) >= max_depth:
                new_untried = []
            else:
                new_untried = [t for t in titles if t not in new_state_set]
            child = _Node(state=new_state, parent=node, untried=new_untried)
            node.children[action] = child
            node = child

        # ── 3. Rollout (depth-limited when max_depth is set) ──────────
        node_state_set = frozenset(node.state)
        remaining = [t for t in titles if t not in node_state_set]
        rollout_steps = None
        if max_depth is not None:
            rollout_steps = max_depth - len(node.state)
        score = _rollout(node.state, remaining, vec_map, quality_map, max_steps=rollout_steps)

        # ── 4. Backpropagation ────────────────────────────────────────
        cur = node
        while cur is not None:
            cur.visits += 1
            cur.value  += score
            cur = cur.parent

    return root


# ---------------------------------------------------------------------------
# Shared utility: embed topic pool
# ---------------------------------------------------------------------------

def _prepare_pool(topic_pool: List[Dict]) -> List[Dict]:
    """
    Add 'vector' key to each topic dict using the tracker's embedding backend.
    Operates on a copy; does not mutate the input list.
    """
    texts = [f"{t['title']}. {t.get('description', '')}" for t in topic_pool]
    vectors = _embed(texts)
    prepared = []
    for topic, vec in zip(topic_pool, vectors):
        prepared.append({**topic, "vector": vec})
    return prepared


# ---------------------------------------------------------------------------
# Tree serialisation (for frontend visualisation)
# ---------------------------------------------------------------------------

def serialise_tree(
    root: _Node,
    max_depth: int = 3,
    max_children: int = 6,
    id_map: Optional[Dict[int, int]] = None,
    root_label: str = "",
) -> dict:
    """
    Export the top levels of the MCTS tree as a flat node/edge graph.

    Only the top `max_children` nodes by visit count are retained at each
    level, and the tree is truncated at `max_depth`.  This keeps the payload
    small enough for smooth frontend rendering while showing the most-explored
    paths.

    Parameters
    ----------
    id_map : optional dict mapping id(node) → streaming integer id.
        When provided (streaming mode), node ids in the output match the ids
        emitted via the SSE `node` events so the frontend can reuse positions
        that were assigned during streaming.  When None, ids are assigned by
        DFS counter (0, 1, 2, …).
    root_label : label to assign to the root node (e.g. case summary).

    Returns {"nodes": [...], "edges": [...]} where each node has:
        id, label (topic title, root_label for root, or ""), visits, avg_value, depth
    """
    nodes: list[dict] = []
    edges: list[dict] = []
    _ctr = [0]

    def _node_id(node: _Node) -> int:
        if id_map is not None:
            return id_map.get(id(node), _ctr[0])
        return _ctr[0]

    def _visit(node: _Node, depth: int, parent_id: int | None) -> None:
        my_id = _node_id(node)
        _ctr[0] += 1
        label = node.state[-1] if node.state else root_label
        avg_v = round(node.value / node.visits, 3) if node.visits else 0.0
        nodes.append({
            "id":        my_id,
            "label":     label,
            "visits":    node.visits,
            "avg_value": avg_v,
            "depth":     depth,
        })
        if parent_id is not None:
            edges.append({"source": parent_id, "target": my_id})
        if depth < max_depth and node.children:
            top = sorted(
                node.children.values(),
                key=lambda c: c.visits,
                reverse=True,
            )[:max_children]
            for child in top:
                _visit(child, depth + 1, my_id)

    _visit(root, 0, None)
    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# Generator mode
# ---------------------------------------------------------------------------

def run_generation(
    topic_pool: List[Dict],
    n_sims: int = 800,
    top_k: int = 10,
    root_label: str = "",
    max_depth: Optional[int] = None,
) -> tuple[List[List[Dict]], dict]:
    """
    Run MCTS over the topic pool and return top_k distinct ordered paths.

    Each returned path is a list of topic dicts (with 'title', 'description',
    'target' keys) in the MCTS-predicted hearing order.

    max_depth — sparse MCTS: limit paths to this many topics.  When set,
    the initial tree is shallow and fast; live projection expands deeper
    as the student progresses through topics.

    If the pool is empty or too small, returns an empty list.
    """
    if not topic_pool:
        return []

    prepared = _prepare_pool(topic_pool)

    logger.info("MCTS generation: %d topics, %d sims, top_k=%d, max_depth=%s", len(prepared), n_sims, top_k, max_depth)
    root = _run_mcts(prepared, n_sims, max_depth=max_depth)

    # Collect all leaf paths (nodes with no children) sorted by avg value
    paths: List[tuple[float, tuple[str, ...]]] = []
    _collect_leaves(root, paths)
    paths.sort(key=lambda x: x[0], reverse=True)

    # De-duplicate and take top_k
    seen: set[tuple[str, ...]] = set()
    results: List[List[Dict]] = []
    title_to_topic = {t["title"]: t for t in topic_pool}

    for _, state in paths:
        if state in seen or len(state) == 0:
            continue
        seen.add(state)
        path_topics = [
            title_to_topic[title]
            for title in state
            if title in title_to_topic
        ]
        if path_topics:
            results.append(path_topics)
        if len(results) >= top_k:
            break

    # If MCTS didn't find enough distinct paths, fall back to score-ordered pool
    if not results:
        logger.warning("MCTS generation: no leaf paths found; returning shuffled pool")
        fallback = sorted(
            prepared,
            key=lambda t: sum(_cosine(t["vector"], o["vector"]) for o in prepared),
            reverse=True,
        )
        results = [[title_to_topic[t["title"]] for t in fallback if t["title"] in title_to_topic]]

    logger.info("MCTS generation: returning %d paths", len(results))
    tree_depth = max_depth if max_depth is not None else 3
    return results, serialise_tree(root, max_depth=tree_depth, root_label=root_label)


def _collect_leaves(node: _Node, out: List[tuple[float, tuple[str, ...]]]) -> None:
    """DFS to collect (avg_value, state) from true leaf nodes only (no children).

    Leaf nodes are the frontier of the tree — they have been visited (and had
    rollouts performed from them) but not yet expanded.  Restricting collection
    to leaves prevents short partial paths from competing against longer, more
    fully-explored paths on average value alone.
    """
    if not node.children and node.visits > 0:
        avg = node.value / node.visits
        out.append((avg, node.state))
    for child in node.children.values():
        _collect_leaves(child, out)


# ---------------------------------------------------------------------------
# Projector mode (live re-projection)
# ---------------------------------------------------------------------------

def run_projection(
    remaining: List[Dict],
    n_sims: int = 150,
    root_label: str = "",
    quality_map: Optional[Dict[str, float]] = None,
) -> tuple[List[str], dict]:
    """
    Given the unaddressed topics at the current hearing state, run MCTS
    and return an ordered list of topic titles (most-likely-next first).

    `remaining` entries need at least 'title' and optionally 'description'.
    `quality_map` — optional title→float (0–1) from the live tracker;
    passed through to the value function so weak/unaddressed topics score
    higher in the projection.
    Returns an empty list if there is nothing left to project.
    """
    if not remaining:
        return []

    if len(remaining) == 1:
        return [remaining[0]["title"]]

    prepared = _prepare_pool(remaining)
    root     = _run_mcts(prepared, n_sims, quality_map=quality_map)

    # Rank child actions of the root by visit count (most-explored = most likely next)
    ranked = sorted(
        root.children.items(),
        key=lambda kv: kv[1].visits,
        reverse=True,
    )
    return [title for title, _ in ranked], serialise_tree(root, root_label=root_label)


# ---------------------------------------------------------------------------
# Streaming generator mode (SSE)
# ---------------------------------------------------------------------------

# Expand-event callback type: (node_id, parent_id, depth) -> None
ExpandCallback = Callable[[int, int, int], None]


async def _run_mcts_streaming(
    topic_pool: List[Dict],
    n_sims: int,
    on_expand: ExpandCallback,
    yield_every: int = 10,
    max_depth: Optional[int] = None,
) -> tuple[_Node, Dict[int, int]]:
    """
    Async version of _run_mcts that yields to the event loop every
    `yield_every` simulations so SSE events can be flushed to the client.

    `on_expand(node_id, parent_id, depth)` is called synchronously inside
    the loop each time a new node is created.  Because this function awaits
    `asyncio.sleep(0)` periodically, the caller's async generator can drain
    queued events between batches without needing threads.

    max_depth — sparse MCTS depth limit (same semantics as _run_mcts).
    """
    titles  = [t["title"] for t in topic_pool]
    vec_map = {t["title"]: t["vector"] for t in topic_pool}

    root = _Node(state=(), parent=None, untried=list(titles))

    # Stable sequential IDs (Python object ids can be reused after GC)
    _seq: Dict[int, int] = {id(root): 0}
    _ctr = [1]

    def _sid(node: _Node) -> int:
        oid = id(node)
        if oid not in _seq:
            _seq[oid] = _ctr[0]
            _ctr[0] += 1
        return _seq[oid]

    # Emit the root so the frontend can place it immediately
    on_expand(0, -1, 0)

    for i in range(n_sims):
        node = root

        # Selection
        while node.is_fully_expanded() and node.children:
            node = node.best_child()

        # Expansion (respect max_depth)
        at_depth_limit = max_depth is not None and len(node.state) >= max_depth
        if node._untried and not at_depth_limit:
            action        = node._untried.pop(random.randrange(len(node._untried)))
            new_state     = node.state + (action,)
            new_state_set = frozenset(new_state)
            if max_depth is not None and len(new_state) >= max_depth:
                new_untried = []
            else:
                new_untried = [t for t in titles if t not in new_state_set]
            child         = _Node(state=new_state, parent=node, untried=new_untried)
            node.children[action] = child

            on_expand(_sid(child), _sid(node), len(child.state))
            node = child

        # Rollout (depth-limited)
        node_state_set = frozenset(node.state)
        remaining = [t for t in titles if t not in node_state_set]
        rollout_steps = None
        if max_depth is not None:
            rollout_steps = max_depth - len(node.state)
        score = _rollout(node.state, remaining, vec_map, max_steps=rollout_steps)

        # Backpropagation
        cur = node
        while cur is not None:
            cur.visits += 1
            cur.value  += score
            cur = cur.parent

        # Yield to event loop periodically so SSE can flush
        if i % yield_every == 0:
            await anyio.sleep(0)

    return root, _seq


async def run_generation_streaming(
    topic_pool: List[Dict],
    on_expand: ExpandCallback,
    n_sims: int = 800,
    top_k: int = 10,
    root_label: str = "",
    max_depth: Optional[int] = None,
) -> tuple[list[list[dict]], dict]:
    """
    Async version of run_generation.  Calls `on_expand` for every new node
    so the SSE endpoint can stream them to the client in real time.

    max_depth — sparse MCTS depth limit (same semantics as run_generation).

    Returns (paths, tree_snapshot) — same shape as run_generation.
    """
    if not topic_pool:
        return [], {}

    prepared       = _prepare_pool(topic_pool)
    title_to_topic = {t["title"]: t for t in topic_pool}

    logger.info(
        "MCTS streaming generation: %d topics, %d sims, top_k=%d, max_depth=%s",
        len(prepared), n_sims, top_k, max_depth,
    )
    root, seq_map = await _run_mcts_streaming(prepared, n_sims, on_expand, max_depth=max_depth)

    paths: List[tuple[float, tuple[str, ...]]] = []
    _collect_leaves(root, paths)
    paths.sort(key=lambda x: x[0], reverse=True)

    seen: set[tuple[str, ...]] = set()
    results: List[List[Dict]] = []

    for _, state in paths:
        if state in seen or len(state) == 0:
            continue
        seen.add(state)
        path_topics = [title_to_topic[t] for t in state if t in title_to_topic]
        if path_topics:
            results.append(path_topics)
        if len(results) >= top_k:
            break

    if not results:
        logger.warning("MCTS streaming: no leaf paths; returning score-ordered pool")
        fallback = sorted(
            prepared,
            key=lambda t: sum(_cosine(t["vector"], o["vector"]) for o in prepared),
            reverse=True,
        )
        results = [[title_to_topic[t["title"]] for t in fallback if t["title"] in title_to_topic]]

    logger.info("MCTS streaming generation: returning %d paths", len(results))
    # Pass seq_map so serialise_tree uses the same ids that were emitted via SSE,
    # allowing the frontend to reuse positions assigned during streaming.
    tree_depth = max_depth if max_depth is not None else 3
    return results, serialise_tree(root, max_depth=tree_depth, id_map=seq_map, root_label=root_label)
