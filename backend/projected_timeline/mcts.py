"""
Weighted Sparse Monte Carlo Tree Search over predicted hearing topic sequences.

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

  score = mean_consecutive_cosine + coverage_bonus
          + exploitability_bonus  (static, from brief analysis)
          + opponent_bonus        (dynamic, from opponent argument scores)
          + initial_buff          (one-shot random buff for first topic)
          + lens_continuity       (bonus for staying within a judicial lens)
          + quality adjustments   (dynamic, from live tracker)
"""

from __future__ import annotations

import logging
import math
import random
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import anyio

logger = logging.getLogger("court-simulator.projected_timeline.mcts")

# Re-use the embedding helpers already loaded by the tracker.
# They're module-level callables with lazy model initialisation.
from .tracker import _embed, _cosine  # noqa: PLC2701


# ---------------------------------------------------------------------------
# Consolidated weight configuration
# ---------------------------------------------------------------------------

@dataclass
class MCTSWeights:
    """All weight maps fed into the MCTS value function.

    Keeps the function signatures clean — callers build one MCTSWeights
    and pass it through instead of threading many optional kwargs.
    """
    exploitability: Dict[str, float] = field(default_factory=dict)
    quality: Optional[Dict[str, float]] = None
    opponent_bonus: Dict[str, float] = field(default_factory=dict)
    initial_buff: Dict[str, float] = field(default_factory=dict)
    lens_map: Dict[str, str] = field(default_factory=dict)
    last_path_lens: Optional[str] = None
    # Number of topics already covered in the hearing — used to increase the
    # uncovered-topic bonus so we prioritize remaining topics more as coverage grows.
    covered_count: int = 0


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
    weights: Optional[MCTSWeights] = None,
) -> float:
    """Score an ordered sequence of topic titles.

    Components:
      - mean cosine similarity between consecutive pairs (thematic flow)
      - coverage bonus
      - exploitability bonus (static, brief-based)
      - opponent bonus (dynamic, from opponent argument scores)
      - initial buff (one-shot for first topic)
      - lens continuity (bonus for same-lens consecutive topics)
      - quality adjustments (dynamic, live tracker)
    """
    if len(titles) < 2:
        return 0.0

    w = weights or MCTSWeights()
    total = len(vec_map)
    pairs = [(titles[i], titles[i + 1]) for i in range(len(titles) - 1)]
    sim_sum = sum(
        _cosine(vec_map[a], vec_map[b])
        for a, b in pairs
        if a in vec_map and b in vec_map
    )
    mean_sim = sim_sum / len(pairs)
    coverage_bonus = 0.1 * (len(titles) / max(total, 1))

    extra = 0.0

    # Exploitability: high-exploitability topics boost the path score
    if w.exploitability:
        extra += sum(0.08 * w.exploitability.get(t, 0.5) for t in titles)

    # Opponent bonus: topics the opponent pressed (scaled by strength)
    if w.opponent_bonus:
        extra += sum(w.opponent_bonus.get(t, 0.0) for t in titles)

    # Initial buff: one-shot bonus for the first topic at hearing start
    if w.initial_buff:
        extra += sum(w.initial_buff.get(t, 0.0) for t in titles)

    # Lens continuity: bonus for consecutive topics sharing a lens
    if w.lens_map:
        for i in range(len(titles) - 1):
            lens_a = w.lens_map.get(titles[i])
            lens_b = w.lens_map.get(titles[i + 1])
            if lens_a and lens_b and lens_a == lens_b:
                extra += 0.06

    # Quality adjustments (live projection)
    # Uncovered topics (q is None) get a bonus; scale up as more topics are covered
    # so we increasingly prioritize remaining gaps.
    uncovered_bonus = 0.08 + 0.04 * min(w.covered_count, 10)
    if w.quality:
        for t in titles:
            q = w.quality.get(t)
            if q is None:
                extra += uncovered_bonus
            elif q < 0.4:
                extra += 0.05
            elif q > 0.7:
                extra -= 0.03

    return mean_sim + coverage_bonus + extra


_ROLLOUT_EPSILON = 0.25   # probability of random pick vs. greedy nearest-neighbour


def _rollout(
    node_state: tuple[str, ...],
    remaining: List[str],
    vec_map: Dict,
    weights: Optional[MCTSWeights] = None,
    max_steps: Optional[int] = None,
) -> float:
    """Simulate an epsilon-greedy completion of the path and return its score.

    At each step, with probability (1 - _ROLLOUT_EPSILON) pick the topic
    that scores highest on a composite of cosine similarity, exploitability,
    opponent bonus, lens continuity, and quality signals.
    """
    w = weights or MCTSWeights()
    if not remaining:
        return _score_sequence(list(node_state), vec_map, w)
    path = list(node_state)
    pool = list(remaining)
    steps = 0
    while pool and (max_steps is None or steps < max_steps):
        if path and random.random() > _ROLLOUT_EPSILON:
            last_vec = vec_map.get(path[-1])
            last_lens = w.lens_map.get(path[-1]) if w.lens_map else None
            if last_vec is not None:
                def _pick_score(t, _lv=last_vec, _ll=last_lens, _w=w):
                    s = _cosine(vec_map[t], _lv) if t in vec_map else 0.0
                    # Exploitability pull
                    s += 0.12 * _w.exploitability.get(t, 0.5)
                    # Opponent bonus
                    s += _w.opponent_bonus.get(t, 0.0)
                    # Initial buff
                    s += _w.initial_buff.get(t, 0.0)
                    # Lens continuity
                    if _ll and _w.lens_map.get(t) == _ll:
                        s += 0.06
                    # Quality / coverage signals — uncovered topics get a bonus that
                    # scales with how many topics are already covered
                    if _w.quality:
                        q = _w.quality.get(t)
                        if q is None:
                            uncovered = 0.15 + 0.06 * min(_w.covered_count, 10)
                            s += uncovered
                        elif q < 0.4:
                            s += 0.08
                    return s
                next_title = max(pool, key=_pick_score)
            else:
                next_title = random.choice(pool)
        else:
            next_title = random.choice(pool)
        path.append(next_title)
        pool.remove(next_title)
        steps += 1
    return _score_sequence(path, vec_map, w)


# ---------------------------------------------------------------------------
# Core MCTS loop (shared by both modes)
# ---------------------------------------------------------------------------

def _run_mcts(
    topic_pool: List[Dict],
    n_sims: int,
    weights: Optional[MCTSWeights] = None,
    max_depth: Optional[int] = None,
    path_so_far: tuple[str, ...] = (),
) -> _Node:
    """Run n_sims MCTS simulations.

    topic_pool entries must have keys: "title", "vector"
    (call _prepare_pool first to add vector keys).

    weights — consolidated MCTSWeights (exploitability, quality, opponent, etc.).
    max_depth — limit paths to this many topics (sparse MCTS).
    path_so_far — seed the root with an existing traversal path (live projection).
        Only topics in topic_pool are candidates for expansion; path topics
        provide thematic context (cosine flow from last path topic).
    """
    titles   = [t["title"] for t in topic_pool]
    vec_map  = {t["title"]: t["vector"] for t in topic_pool}

    # For path-seeded projection, include path topic vectors in vec_map
    # so _score_sequence can compute cosine between last path topic and candidates.
    # path_so_far titles won't appear in `titles` (they're already addressed).
    root_state = path_so_far
    root = _Node(
        state=root_state,
        parent=None,
        untried=[t for t in titles if t not in frozenset(root_state)],
    )

    for _ in range(n_sims):
        node = root

        # ── 1. Selection ──────────────────────────────────────────────
        while node.is_fully_expanded() and node.children:
            node = node.best_child()

        # ── 2. Expansion (respect max_depth) ──────────────────────────
        effective_depth = len(node.state) - len(path_so_far)
        at_depth_limit = max_depth is not None and effective_depth >= max_depth
        if node._untried and not at_depth_limit:
            action = node._untried.pop(random.randrange(len(node._untried)))
            new_state     = node.state + (action,)
            new_state_set = frozenset(new_state)
            if max_depth is not None and (len(new_state) - len(path_so_far)) >= max_depth:
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
            rollout_steps = max_depth - (len(node.state) - len(path_so_far))
        score = _rollout(node.state, remaining, vec_map, weights, max_steps=rollout_steps)

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
    exploitability_map: Optional[Dict[str, float]] = None,
) -> tuple[List[List[Dict]], dict]:
    """Run MCTS over the topic pool and return top_k distinct ordered paths.

    exploitability_map — title→float (0–1) from Phase 1 brief analysis.
    """
    if not topic_pool:
        return [], {}

    prepared = _prepare_pool(topic_pool)
    lens_map = {t["title"]: t.get("lens", "") for t in topic_pool}
    weights = MCTSWeights(
        exploitability=exploitability_map or {},
        lens_map=lens_map,
    )

    logger.info("MCTS generation: %d topics, %d sims, top_k=%d, max_depth=%s", len(prepared), n_sims, top_k, max_depth)
    root = _run_mcts(prepared, n_sims, weights=weights, max_depth=max_depth)

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
    weights: Optional[MCTSWeights] = None,
    path_so_far: tuple[str, ...] = (),
    path_vecs: Optional[Dict[str, List]] = None,
) -> tuple[List[str], dict]:
    """Project the next topics given the current hearing state.

    remaining — frontier topics available for MCTS expansion.
    weights — consolidated MCTSWeights with all bias maps.
    path_so_far — ordered tuple of topics already traversed (seeds the root).
    path_vecs — pre-computed embeddings for path topics so cosine flow
        from the last path topic works even though path topics aren't in
        the remaining pool.
    """
    if not remaining:
        return [], {}

    if len(remaining) == 1:
        return [remaining[0]["title"]], {}

    prepared = _prepare_pool(remaining)

    # Inject path topic vectors so _score_sequence / _rollout can compute
    # cosine between the last path topic and candidates.
    if path_vecs:
        for p in prepared:
            pass  # already in list
        # We don't add path topics to `prepared` (they're addressed), but
        # _run_mcts's vec_map needs the last path topic for cosine flow.
        # Patch vec_map after _prepare_pool by adding path_vecs entries.
        _extra_vecs = path_vecs
    else:
        _extra_vecs = {}

    # Build vec_map manually to include path vectors
    vec_map = {t["title"]: t["vector"] for t in prepared}
    vec_map.update(_extra_vecs)

    titles = [t["title"] for t in prepared]

    root_state = path_so_far
    root = _Node(
        state=root_state,
        parent=None,
        untried=[t for t in titles if t not in frozenset(root_state)],
    )

    w = weights or MCTSWeights()

    for _ in range(n_sims):
        node = root

        while node.is_fully_expanded() and node.children:
            node = node.best_child()

        effective_depth = len(node.state) - len(path_so_far)
        if node._untried:
            action = node._untried.pop(random.randrange(len(node._untried)))
            new_state     = node.state + (action,)
            new_state_set = frozenset(new_state)
            new_untried   = [t for t in titles if t not in new_state_set]
            child = _Node(state=new_state, parent=node, untried=new_untried)
            node.children[action] = child
            node = child

        node_state_set = frozenset(node.state)
        rem = [t for t in titles if t not in node_state_set]
        score = _rollout(node.state, rem, vec_map, w)

        cur = node
        while cur is not None:
            cur.visits += 1
            cur.value  += score
            cur = cur.parent

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
    weights: Optional[MCTSWeights] = None,
) -> tuple[_Node, Dict[int, int]]:
    """Async version of _run_mcts that yields to the event loop every
    `yield_every` simulations so SSE events can be flushed to the client.
    """
    titles  = [t["title"] for t in topic_pool]
    vec_map = {t["title"]: t["vector"] for t in topic_pool}

    root = _Node(state=(), parent=None, untried=list(titles))

    _seq: Dict[int, int] = {id(root): 0}
    _ctr = [1]

    def _sid(node: _Node) -> int:
        oid = id(node)
        if oid not in _seq:
            _seq[oid] = _ctr[0]
            _ctr[0] += 1
        return _seq[oid]

    on_expand(0, -1, 0)

    for i in range(n_sims):
        node = root

        while node.is_fully_expanded() and node.children:
            node = node.best_child()

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

        node_state_set = frozenset(node.state)
        remaining = [t for t in titles if t not in node_state_set]
        rollout_steps = None
        if max_depth is not None:
            rollout_steps = max_depth - len(node.state)
        score = _rollout(node.state, remaining, vec_map, weights, max_steps=rollout_steps)

        cur = node
        while cur is not None:
            cur.visits += 1
            cur.value  += score
            cur = cur.parent

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
    exploitability_map: Optional[Dict[str, float]] = None,
) -> tuple[list[list[dict]], dict]:
    """Async version of run_generation with exploitability weights."""
    if not topic_pool:
        return [], {}

    prepared       = _prepare_pool(topic_pool)
    title_to_topic = {t["title"]: t for t in topic_pool}
    lens_map = {t["title"]: t.get("lens", "") for t in topic_pool}
    weights = MCTSWeights(
        exploitability=exploitability_map or {},
        lens_map=lens_map,
    )

    logger.info(
        "MCTS streaming generation: %d topics, %d sims, top_k=%d, max_depth=%s",
        len(prepared), n_sims, top_k, max_depth,
    )
    root, seq_map = await _run_mcts_streaming(
        prepared, n_sims, on_expand, max_depth=max_depth, weights=weights,
    )

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
