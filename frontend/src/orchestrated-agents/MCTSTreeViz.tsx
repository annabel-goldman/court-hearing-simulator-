/**
 * MCTSTreeViz
 *
 * Level-first SVG visualization of the MCTS search tree.
 *
 * Layout — Projection tree (live hearing)
 * ----------------------------------------
 * Root sits at the top-center.  Each depth level is a horizontal row;
 * nodes at the same depth share the same Y coordinate.
 *
 * Within each row, nodes are sorted left-to-right by:
 *   1. Parent X (preserves tree structure visually)
 *   2. Weak topics first (leftmost in their parent group)
 *   3. Visit count descending (hot paths on the right within a group)
 *   4. Node ID ascending (tie-breaker for stability)
 *
 * The best path (greedy highest-visits chain from root) is highlighted
 * with gold edges and dashed rings — it reads as a sequential trajectory.
 * Horizontal dashed guide lines mark each depth level.
 *
 * Layout — Preview/generation tree (agenda streaming)
 * -----------------------------------------------------
 * When `agendaItems` are provided, depth-1 (lens) and depth-2 (topic)
 * nodes use the original agenda-aligned radial layout so they align with
 * the Agenda Panel.  Only the structural fallback is level-first.
 *
 * Stability
 * ---------
 * Every node receives its position the first time it appears and that
 * position never changes, so the tree grows without any node jumping.
 *
 * Scroll / zoom
 * -------------
 * Wheel events are registered with { passive: false } via useEffect so
 * that e.preventDefault() actually stops the page from scrolling.
 *
 * Interaction
 * -----------
 *   Scroll wheel  – zoom toward cursor
 *   Drag          – pan
 *   Hover node    – floating detail bubble (labels only shown on hover)
 *   "Reset view"  – restore 1:1 view
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MCTSTree, MCTSNode, AgendaItem } from '../multi-agent/types';

interface Props {
  tree: MCTSTree | null;
  addressedTopics?: string[];
  predictedNext?: string[];
  currentTopic?: string | null;
  title?: string;
  /** Agenda items — used to assign stable angular positions to depth-1 (lens)
   *  and depth-2 (topic) nodes so the tree aligns with the agenda panel. */
  agendaItems?: AgendaItem[];
  /** Topics the advocate addressed with weak quality (< 0.4) — shown as amber. */
  weakTopics?: string[];
  /** Per-topic quality scores (0–1). Used to size the quality ring on hover. */
  topicQualities?: Record<string, number>;
}

const SVG_SIZE   = 800;
const CENTER     = SVG_SIZE / 2;
const MAX_SLOT   = 14;         // max nodes rendered per level; excess are skipped

/** Y coordinate (px from top) for each depth level in the projection tree. */
/** Distance from CENTER for each depth ring. */
const RING_RADIUS: Record<number, number> = {
  1: 130,
  2: 220,
  3: 295,
  4: 350,
  5: 390,
};
const DEFAULT_RING = 410; // depth ≥ 6

/** Angular step (rad) between siblings at each depth level. */
const DEPTH_STEP: Record<number, number> = {
  2: 0.32,   // ≈ 18°
  3: 0.20,   // ≈ 11°
  4: 0.14,   // ≈  8°
  5: 0.10,   // ≈  6°
};
const DEFAULT_STEP = 0.08; // ≈ 4.5° for depth ≥ 6

/** Minimum distance (px) between any two node centres — prevents overlap. */
const MIN_NODE_GAP = 42;

// ── Visual helpers ────────────────────────────────────────────────────────────

function nodeRadius(node: MCTSNode, maxVisits: number): number {
  if (node.depth === 0) return 14;
  const t = maxVisits > 0 ? node.visits / maxVisits : 0;
  return Math.max(3, Math.min(11, 3 + t * 8));
}

function nodeColor(
  node: MCTSNode,
  addressed: Set<string>,
  predicted: Set<string>,
  current: string | null,
  weak: Set<string>,
): string {
  if (node.depth === 0)                       return '#f0c040';  // root
  if (current && node.label === current)      return '#facc15';  // current topic (bright yellow)
  if (predicted.has(node.label))              return '#4ade80';  // predicted next
  if (weak.has(node.label))                   return '#fb923c';  // addressed but weak (amber)
  if (addressed.has(node.label))              return '#22d3ee';  // covered well
  return '#f87171';                                               // not covered
}

// ── Component ─────────────────────────────────────────────────────────────────

export const MCTSTreeViz = memo(function MCTSTreeViz({
  tree,
  addressedTopics = [],
  predictedNext   = [],
  currentTopic    = null,
  title           = 'MCTS Search Tree',
  agendaItems     = [],
  weakTopics      = [],
  topicQualities  = {},
}: Props) {
  // ── Agenda-aligned angle maps ─────────────────────────────────────────────
  // Derive deterministic angular positions from agenda ordering so depth-1
  // (lens) and depth-2 (topic) nodes stay aligned with the Agenda Panel.
  const { lensAngleMap, topicAngleMap } = useMemo(() => {
    const lensMap  = new Map<string, number>();
    const topicMap = new Map<string, number>();
    if (agendaItems.length === 0) return { lensAngleMap: lensMap, topicAngleMap: topicMap };

    const lensCount = agendaItems.length;
    const lensArc   = (2 * Math.PI) / lensCount;

    agendaItems.forEach((item, li) => {
      const lensAngle = -Math.PI / 2 + li * lensArc;
      lensMap.set(item.lens, lensAngle);

      const topics = item.topics;
      if (topics.length === 0) return;
      const sectorHalf = lensArc * 0.42; // 84% of sector — leaves gaps between lenses
      if (topics.length === 1) {
        topicMap.set(topics[0].title, lensAngle);
      } else {
        topics.forEach((t, ti) => {
          const frac  = ti / (topics.length - 1);
          const angle = lensAngle - sectorHalf + frac * 2 * sectorHalf;
          topicMap.set(t.title, angle);
        });
      }
    });
    return { lensAngleMap: lensMap, topicAngleMap: topicMap };
  }, [agendaItems]);
  // ── Position storage (assigned once per node, never updated) ─────────────
  const positionsRef   = useRef(new Map<number, { x: number; y: number }>());
  /** Maps edge.target → edge.source (parent id) */
  const parentIdRef    = useRef(new Map<number, number>());
  const prevTreeRef    = useRef<MCTSTree | null>(null);
  /** Track the agenda item count that positions were last computed against.
   *  When a new lens streams in, the angle maps change, so all positions
   *  must be re-derived with the updated sector sizes. */
  const prevAgendaCountRef = useRef(0);

  // ── View state ────────────────────────────────────────────────────────────
  const [view, setView]           = useState({ scale: 1, tx: 0, ty: 0 });
  const svgRef                    = useRef<SVGSVGElement>(null);
  const isDraggingRef             = useRef(false);
  const dragStartRef              = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // ── Hover ─────────────────────────────────────────────────────────────────
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // ── Relevant-only filter ──────────────────────────────────────────────────
  const [showOnlyRelevant, setShowOnlyRelevant] = useState(false);

  // ── Non-passive wheel listener (prevents page scroll while zooming) ───────
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = el.getBoundingClientRect();
      const mx     = (e.clientX - rect.left) * (SVG_SIZE / rect.width);
      const my     = (e.clientY - rect.top)  * (SVG_SIZE / rect.height);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView(prev => {
        const s = Math.max(0.25, Math.min(8, prev.scale * factor));
        return {
          scale: s,
          tx: mx - (mx - prev.tx) * (s / prev.scale),
          ty: my - (my - prev.ty) * (s / prev.scale),
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // svgRef is always mounted (SVG always in DOM, even when empty)

  // ── Reset position state when tree is cleared or fundamentally replaced ──
  if (tree !== prevTreeRef.current) {
    const nodes = tree?.nodes;
    const shouldClear =
      !tree ||
      !nodes ||
      nodes.length === 0 ||
      // Detect a full replacement (generation→projection, etc.) vs an additive
      // streaming update.  If >40 % of previously-positioned nodes disappeared
      // from the new tree we treat it as a brand-new tree.
      (() => {
        if (positionsRef.current.size === 0) return false;
        const newIds = new Set(nodes.map(n => n.id));
        let gone = 0;
        for (const id of positionsRef.current.keys()) {
          if (!newIds.has(id)) gone++;
        }
        return gone > positionsRef.current.size * 0.4;
      })();

    if (shouldClear) {
      positionsRef.current.clear();
      parentIdRef.current.clear();
    }
    prevTreeRef.current = tree;
  }

  // ── Invalidate positions when agenda changes (preview streaming) ──────────
  // During the generation phase, lenses arrive one at a time.  Each new lens
  // changes the angular sector layout, so we must re-position every node.
  // The tree is small during preview (root + a few lens + topic nodes) so
  // clearing is cheap and keeps the layout in sync with the Agenda Panel.
  if (agendaItems.length !== prevAgendaCountRef.current) {
    positionsRef.current.clear();
    // Keep parentIdRef — edge→parent relationships don't change.
    prevAgendaCountRef.current = agendaItems.length;
  }

  // ── Graph layout ──────────────────────────────────────────────────────────

  /**
   * Assign a stable radial position for `node`.
   *
   * Two layout strategies:
   *
   * **Preview tree** (depth-1 = lens names, depth-2 = topic titles):
   *   Agenda-aligned — lenses get fixed angles from an equal-sector split,
   *   topics are placed at fixed angles within their lens's sector.
   *
   * **Projection tree** (all depths are topic titles):
   *   Structural — depth-1 nodes arc around the full circle, deeper nodes
   *   fan symmetrically from their parent's outward angle.
   */
  function getSiblings(nodeId: number): number[] {
    const parentId = parentIdRef.current.get(nodeId);
    if (parentId === undefined) return [nodeId];
    return (tree?.edges ?? [])
      .filter(e => e.source === parentId)
      .map(e => e.target)
      .sort((a, b) => a - b);
  }

  function assignPosition(node: MCTSNode): { x: number; y: number } | null {
    if (node.depth === 0) return { x: CENTER, y: CENTER };
    if (node.depth > 5) return null;

    const parentId = parentIdRef.current.get(node.id);
    const radius   = RING_RADIUS[node.depth] ?? DEFAULT_RING;

    // ── Agenda-aligned positioning (preview tree only) ──────────────────
    if (node.depth === 1 && node.label && lensAngleMap.has(node.label)) {
      const angle = lensAngleMap.get(node.label)!;
      return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
    }
    if (node.depth === 2 && node.label && topicAngleMap.has(node.label)) {
      const parentNode = parentId !== undefined
        ? tree?.nodes.find(n => n.id === parentId)
        : undefined;
      if (parentNode && lensAngleMap.has(parentNode.label)) {
        const angle = topicAngleMap.get(node.label)!;
        return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
      }
    }

    // ── Structural radial positioning (projection tree) ──────────────────
    const siblings = getSiblings(node.id);
    const sibIdx   = siblings.indexOf(node.id);
    const sibTotal = siblings.length;
    if (sibIdx < 0 || sibIdx >= MAX_SLOT) return null;

    if (node.depth === 1) {
      const angle = -Math.PI / 2 + sibIdx * (2 * Math.PI) / Math.max(sibTotal, 1);
      return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
    }

    const parentPos = parentId !== undefined ? positionsRef.current.get(parentId) : undefined;
    const baseAngle = parentPos
      ? Math.atan2(parentPos.y - CENTER, parentPos.x - CENTER)
      : 0;

    const parentSibCount = parentId !== undefined ? getSiblings(parentId).length : 1;
    const sectorArc      = (2 * Math.PI) / Math.max(parentSibCount, 1);
    const maxStep        = DEPTH_STEP[node.depth] ?? DEFAULT_STEP;
    const step           = sibTotal <= 1
      ? 0
      : Math.min(maxStep, (sectorArc * 0.7) / (sibTotal - 1));

    const totalWidth = (sibTotal - 1) * step;
    const angle      = sibTotal === 1
      ? baseAngle
      : baseAngle - totalWidth / 2 + sibIdx * step;

    return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
  }

  /**
   * Nudge `pos` away from any already-placed node closer than MIN_NODE_GAP.
   *
   * Instead of always pushing radially from CENTER (which chains nodes into
   * a straight line), we push **away from the specific collider**.  When
   * nodes are nearly coincident we fall back to a tangential nudge so they
   * separate along the ring rather than stacking outward.
   */
  function resolveCollisions(pos: { x: number; y: number }): { x: number; y: number } {
    let { x, y } = pos;
    for (let attempt = 0; attempt < 20; attempt++) {
      let collided = false;
      for (const existing of positionsRef.current.values()) {
        const dx = x - existing.x;
        const dy = y - existing.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_NODE_GAP) {
          collided = true;
          const push = MIN_NODE_GAP - dist + 2;
          if (dist > 0.5) {
            // Push directly away from the collider
            x += (dx / dist) * push;
            y += (dy / dist) * push;
          } else {
            // Nearly coincident — push tangentially along the ring
            const radAngle = Math.atan2(y - CENTER, x - CENTER);
            x += -Math.sin(radAngle) * push;
            y +=  Math.cos(radAngle) * push;
          }
          break; // re-check from the start
        }
      }
      if (!collided) break;
    }
    return { x, y };
  }

  // ── Sync refs from current tree before rendering ──────────────────────────
  if (tree?.nodes && tree?.edges) {
    // 1. Build parent map from newly seen edges
    for (const e of tree.edges) {
      if (!parentIdRef.current.has(e.target)) {
        parentIdRef.current.set(e.target, e.source);
      }
    }
    // 2. Assign positions to newly seen nodes, processing shallower depths
    //    first so parent positions are always available for child layout.
    const unpositioned = tree.nodes
      .filter(n => !positionsRef.current.has(n.id))
      .sort((a, b) => a.depth - b.depth);
    for (const node of unpositioned) {
      let pos = assignPosition(node);
      if (pos) {
        pos = resolveCollisions(pos);
        positionsRef.current.set(node.id, pos);
      }
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const maxVisits    = tree?.nodes?.length ? Math.max(1, ...tree.nodes.map(n => n.visits)) : 1;
  const addressedSet = new Set(addressedTopics);
  const predictedSet = new Set(predictedNext);
  const weakSet      = new Set(weakTopics);
  const hasChildren  = new Set<number>();
  if (tree?.edges) for (const e of tree.edges) hasChildren.add(e.source);

  // ── Build "relevant" node ID set (root + current + predicted + ancestors) ─
  const relevantIds = useMemo(() => {
    const ids = new Set<number>();
    if (!tree || !showOnlyRelevant) return ids;
    // Collect seed nodes: root, current, predicted-next
    const seeds: number[] = [];
    for (const node of tree.nodes) {
      if (node.depth === 0) { ids.add(node.id); continue; }
      if (currentTopic && node.label === currentTopic) seeds.push(node.id);
      if (predictedSet.has(node.label))                 seeds.push(node.id);
    }
    // Walk ancestors to root for each seed
    for (const sid of seeds) {
      let cur: number | undefined = sid;
      while (cur !== undefined && !ids.has(cur)) {
        ids.add(cur);
        cur = parentIdRef.current.get(cur);
      }
    }
    return ids;
  }, [
    tree, showOnlyRelevant, currentTopic,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    predictedNext.join(','),
  ]);

  // ── Seed-topic highlight: root → most-visited depth-1 child ────────────
  // On initial tree creation only the starting/seed topic edge is lit —
  // that's the topic with the highest weight that seeds the projection.
  const bestPathIds = useMemo(() => {
    const ids = new Set<number>();
    if (!tree) return ids;
    const root = tree.nodes.find(n => n.depth === 0);
    if (!root) return ids;
    ids.add(root.id);
    const depth1 = tree.edges
      .filter(e => e.source === root.id)
      .map(e => tree.nodes.find(n => n.id === e.target))
      .filter((n): n is MCTSNode => n !== undefined);
    if (depth1.length === 0) return ids;
    const top = depth1.reduce((best, n) => n.visits > best.visits ? n : best);
    ids.add(top.id);
    return ids;
  }, [tree]);

  // Detect projection tree: depth-1 nodes are topic titles, not lens names
  const isProjectionTree = !!(tree?.nodes &&
    tree.nodes.filter(n => n.depth === 1).every(n => !lensAngleMap.has(n.label)));

  const hoveredNode = hoveredId !== null
    ? tree?.nodes.find(n => n.id === hoveredId) ?? null
    : null;

  // ── Pan handlers (drag) ───────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if ((e.target as SVGElement).closest('circle, text, rect')) return;
    isDraggingRef.current = true;
    dragStartRef.current  = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  }
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDraggingRef.current) return;
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx   = (e.clientX - dragStartRef.current.x) * (SVG_SIZE / rect.width);
    const dy   = (e.clientY - dragStartRef.current.y) * (SVG_SIZE / rect.height);
    setView(prev => ({ ...prev, tx: dragStartRef.current.tx + dx, ty: dragStartRef.current.ty + dy }));
  }
  function handleMouseUp() { isDraggingRef.current = false; }

  const { scale, tx, ty } = view;
  const hasCustomView = scale !== 1 || tx !== 0 || ty !== 0;

  // ── Render ────────────────────────────────────────────────────────────────
  // The SVG is ALWAYS in the DOM so svgRef is always set (needed for the
  // non-passive wheel listener mounted in useEffect with [] deps).
  return (
    <div className="mcts-tree-viz">
      {tree?.nodes && tree.nodes.length > 0 && (
        <div className="mcts-tree-viz__header">
          <span className="mcts-tree-viz__title">{title}</span>
          <span className="mcts-tree-viz__meta">
            {tree.nodes.length} nodes · scroll to zoom · drag to pan
          </span>
          <button
            className={`mcts-tree-viz__filter-btn${showOnlyRelevant ? ' mcts-tree-viz__filter-btn--active' : ''}`}
            onClick={() => setShowOnlyRelevant(v => !v)}
            title="Show only current, predicted-next nodes and their path to root"
          >
            {showOnlyRelevant ? '● Relevant only' : '○ Show all'}
          </button>
          {hasCustomView && (
            <button
              className="mcts-tree-viz__reset-btn"
              onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
            >
              Reset view
            </button>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        className={`mcts-tree-viz__svg${(!tree || tree.nodes.length === 0) ? ' mcts-tree-viz__svg--empty' : ''}`}
        aria-label="MCTS search tree"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: 'grab', userSelect: 'none' }}
      >
        {/* Empty state text */}
        {(!tree?.nodes || tree.nodes.length === 0) && (
          <text x={CENTER} y={CENTER} textAnchor="middle" dominantBaseline="middle"
            fill="rgba(255,255,255,0.3)" fontSize={13} fontFamily="system-ui, sans-serif">
            MCTS tree will appear after brief processing…
          </text>
        )}

        {/* All zoomable content */}
        {tree?.nodes && tree.nodes.length > 0 && (
          <g transform={`matrix(${scale},0,0,${scale},${tx},${ty})`}>
            {/* Depth-ring guides */}
            {[1, 2, 3, 4, 5].map(d => (
              <circle key={d} cx={CENTER} cy={CENTER} r={RING_RADIUS[d]}
                fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            ))}

            {/* Edges — curved when a straight line would cross a node */}
            {tree.edges.map(edge => {
              // Skip edges not in the relevant set when filtering
              if (showOnlyRelevant && relevantIds.size > 0 &&
                  (!relevantIds.has(edge.source) || !relevantIds.has(edge.target))) return null;
              const src = positionsRef.current.get(edge.source);
              const tgt = positionsRef.current.get(edge.target);
              if (!src || !tgt) return null;

              // Check if any positioned node sits too close to the straight-line edge.
              // "Too close" = centre within EDGE_CLEAR px of the segment (slightly
              // larger than node radius so circles don't visually touch the line).
              const EDGE_CLEAR = 15;
              const edgeDx = tgt.x - src.x;
              const edgeDy = tgt.y - src.y;
              const edgeLen2 = edgeDx * edgeDx + edgeDy * edgeDy;
              let worstDist  = Infinity;
              let worstNode: { x: number; y: number } | null = null;

              if (edgeLen2 > 1) {
                for (const [nid, npos] of positionsRef.current.entries()) {
                  if (nid === edge.source || nid === edge.target) continue;
                  // Project npos onto the segment [src, tgt]
                  const t = Math.max(0.05, Math.min(0.95,
                    ((npos.x - src.x) * edgeDx + (npos.y - src.y) * edgeDy) / edgeLen2
                  ));
                  const px = src.x + t * edgeDx;
                  const py = src.y + t * edgeDy;
                  const d  = Math.sqrt((npos.x - px) ** 2 + (npos.y - py) ** 2);
                  if (d < EDGE_CLEAR && d < worstDist) {
                    worstDist = d;
                    worstNode = npos;
                  }
                }
              }

              // No collision — straight line
              if (!worstNode) {
                return (
                  <line key={`e-${edge.source}-${edge.target}`}
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                );
              }

              // Collision — curve away from the obstructing node.
              // Control point is at the edge midpoint, offset perpendicular to the
              // edge direction, pushed away from the obstructing node.
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2;
              const edgeLen = Math.sqrt(edgeLen2);
              // Unit perpendicular (rotate edge direction 90°)
              const perpX = -edgeDy / edgeLen;
              const perpY =  edgeDx / edgeLen;
              // Decide which side of the edge to bow toward: away from the blocker
              const toBlockX = worstNode.x - mx;
              const toBlockY = worstNode.y - my;
              const side = (toBlockX * perpX + toBlockY * perpY) > 0 ? -1 : 1;
              // Bow magnitude scales with proximity — closer = more curve
              const bow = Math.max(18, EDGE_CLEAR + 12 - worstDist);
              const cx = mx + perpX * bow * side;
              const cy = my + perpY * bow * side;

              return (
                <path key={`e-${edge.source}-${edge.target}`}
                  d={`M${src.x},${src.y} Q${cx},${cy} ${tgt.x},${tgt.y}`}
                  fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
              );
            })}

            {/* Best-path gold edges — rendered above regular edges, below nodes */}
            {isProjectionTree && tree.edges.map(edge => {
              if (!bestPathIds.has(edge.source) || !bestPathIds.has(edge.target)) return null;
              const src = positionsRef.current.get(edge.source);
              const tgt = positionsRef.current.get(edge.target);
              if (!src || !tgt) return null;
              return (
                <line key={`bp-${edge.source}-${edge.target}`}
                  x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  stroke="#f0c040" strokeWidth={2.5} opacity={0.5} strokeLinecap="round" />
              );
            })}

            {/* Nodes */}
            {tree.nodes.map(node => {
              // Skip nodes not in the relevant set when filtering
              if (showOnlyRelevant && relevantIds.size > 0 && !relevantIds.has(node.id)) return null;
              const pos  = positionsRef.current.get(node.id);
              if (!pos) return null;
              const isCurrent = !!(currentTopic && node.label === currentTopic);
              const r     = isCurrent ? nodeRadius(node, maxVisits) * 1.8 : nodeRadius(node, maxVisits);
              const color = nodeColor(node, addressedSet, predictedSet, currentTopic, weakSet);
              const isHov = node.id === hoveredId;
              const quality = topicQualities[node.label];

              return (
                <g key={node.id}
                  style={{ animation: 'mcts-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Best-path dashed gold ring */}
                  {isProjectionTree && bestPathIds.has(node.id) && node.depth > 0 && !isCurrent && (
                    <circle cx={pos.x} cy={pos.y} r={r + 8}
                      fill="none" stroke="#f0c040" strokeWidth={1.5} opacity={0.45}
                      strokeDasharray="3 4" style={{ pointerEvents: 'none' }} />
                  )}
                  {/* Current-topic pulse ring */}
                  {isCurrent && (
                    <circle cx={pos.x} cy={pos.y} r={r + 10}
                      fill="none" stroke="#facc15" strokeWidth={2}
                      style={{ animation: 'mcts-pulse 1.6s ease-in-out infinite', transformOrigin: `${pos.x}px ${pos.y}px` }} />
                  )}
                  {/* Leaf halo */}
                  {!isCurrent && !hasChildren.has(node.id) && (
                    <circle cx={pos.x} cy={pos.y} r={r + 4}
                      fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                  )}
                  {/* Quality arc — partial ring showing argument strength (0–1) */}
                  {quality !== undefined && quality > 0 && node.depth > 0 && (
                    <circle cx={pos.x} cy={pos.y} r={r + 6}
                      fill="none"
                      stroke={quality >= 0.7 ? '#22d3ee' : quality >= 0.4 ? '#fb923c' : '#f87171'}
                      strokeWidth={2}
                      strokeDasharray={`${quality * 2 * Math.PI * (r + 6)} ${(1 - quality) * 2 * Math.PI * (r + 6)}`}
                      strokeDashoffset={0.25 * 2 * Math.PI * (r + 6)}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none' }} />
                  )}
                  {/* Hover ring */}
                  {isHov && (
                    <circle cx={pos.x} cy={pos.y} r={r + 7}
                      fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
                  )}
                  <circle cx={pos.x} cy={pos.y} r={r} fill={color} opacity={isHov ? 1 : 0.9} />
                  {/* Always-visible label for the current topic */}
                  {isCurrent && (
                    <text x={pos.x} y={pos.y + r + 12}
                      textAnchor="middle" fill="#facc15" fontSize={7.5}
                      fontFamily="system-ui,sans-serif" fontWeight="bold"
                      style={{ pointerEvents: 'none' }}>
                      {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Progress path: current topic → top predicted-next topic */}
            {(() => {
              if (!currentTopic || predictedNext.length === 0) return null;
              const topPredicted = predictedNext[0];
              if (topPredicted === currentTopic) return null;

              let srcPos: { x: number; y: number } | null = null;
              let tgtPos: { x: number; y: number } | null = null;
              let tgtRadius = 5;

              for (const node of tree.nodes) {
                if (node.label === currentTopic) {
                  const p = positionsRef.current.get(node.id);
                  if (p) srcPos = p;
                }
                if (node.label === topPredicted) {
                  const p = positionsRef.current.get(node.id);
                  if (p) { tgtPos = p; tgtRadius = nodeRadius(node, maxVisits); }
                }
              }

              if (!srcPos || !tgtPos) return null;
              const dx = tgtPos.x - srcPos.x;
              const dy = tgtPos.y - srcPos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 20) return null;

              // Stop the line just before the target node edge
              const ux = dx / dist;
              const uy = dy / dist;
              const endX = tgtPos.x - ux * (tgtRadius + 5);
              const endY = tgtPos.y - uy * (tgtRadius + 5);

              // Arrowhead polygon at the tip
              const ARROW = 8;
              const ax1 = endX - ARROW * ux + (ARROW * 0.45) * uy;
              const ay1 = endY - ARROW * uy - (ARROW * 0.45) * ux;
              const ax2 = endX - ARROW * ux - (ARROW * 0.45) * uy;
              const ay2 = endY - ARROW * uy + (ARROW * 0.45) * ux;

              const label = topPredicted.length > 22 ? topPredicted.slice(0, 20) + '…' : topPredicted;

              return (
                <g key="mcts-progress" style={{ pointerEvents: 'none' }}>
                  {/* Glow */}
                  <line x1={srcPos.x} y1={srcPos.y} x2={endX} y2={endY}
                    stroke="#4ade80" strokeWidth={6} opacity={0.1} strokeLinecap="round" />
                  {/* Marching-ants dash */}
                  <line x1={srcPos.x} y1={srcPos.y} x2={endX} y2={endY}
                    stroke="#4ade80" strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round"
                    style={{ animation: 'mcts-flow 0.7s linear infinite' }} />
                  {/* Arrowhead */}
                  <polygon points={`${endX},${endY} ${ax1},${ay1} ${ax2},${ay2}`}
                    fill="#4ade80" opacity={0.9} />
                  {/* Label below target node */}
                  <text x={tgtPos.x} y={tgtPos.y + tgtRadius + 14}
                    textAnchor="middle" fill="#4ade80" fontSize={7.5}
                    fontFamily="system-ui,sans-serif" fontWeight="600">
                    {label}
                  </text>
                  <text x={tgtPos.x} y={tgtPos.y + tgtRadius + 23}
                    textAnchor="middle" fill="rgba(74,222,128,0.55)" fontSize={6.5}
                    fontFamily="system-ui,sans-serif">
                    ↑ predicted next
                  </text>
                </g>
              );
            })()}

            {/* Hover tooltip — rendered last so it's always on top */}
            {hoveredNode && (() => {
              const pos = positionsRef.current.get(hoveredNode.id);
              if (!pos) return null;
              const label = hoveredNode.label || 'Root';
              const hovQuality = topicQualities[hoveredNode.label];
              // Wrap topic at ~32 chars per line
              const wrapTopic = (s: string, maxLen: number): string[] => {
                if (s.length <= maxLen) return [s];
                const out: string[] = [];
                let rest = s;
                while (rest.length > maxLen) {
                  const chunk = rest.slice(0, maxLen);
                  const space = chunk.lastIndexOf(' ');
                  const cut = space > maxLen * 0.5 ? space + 1 : maxLen;
                  out.push(rest.slice(0, cut));
                  rest = rest.slice(cut).trimStart();
                }
                if (rest) out.push(rest);
                return out;
              };
              const topicLines = wrapTopic(label, 32);
              const statusText = hoveredNode.depth === 0 ? 'root' : (currentTopic && hoveredNode.label === currentTopic) ? '▶ current' : weakSet.has(hoveredNode.label) ? '⚠ weak' : addressedSet.has(hoveredNode.label) ? 'covered' : predictedSet.has(hoveredNode.label) ? 'predicted' : 'not covered';
              const W = 240;
              const TOPIC_LINE_HEIGHT = 14;
              const ROW_HEIGHT = 16;
              const topicBlockH = topicLines.length * TOPIC_LINE_HEIGHT;
              const metaRows = 3 + (hovQuality !== undefined ? 1 : 0);
              const H = 24 + topicBlockH + metaRows * ROW_HEIGHT;
              const PAD = 10;
              let bx = pos.x + 18, by = pos.y - H / 2;
              if (bx + W > SVG_SIZE - 4) bx = pos.x - W - 18;
              if (by < 4)               by = 4;
              if (by + H > SVG_SIZE - 4) by = SVG_SIZE - H - 4;
              return (
                <g key="tooltip" style={{ pointerEvents: 'none' }}>
                  <rect x={bx} y={by} width={W} height={H} rx={8}
                    fill="rgba(10,16,30,0.97)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  {/* Topic block — wrapped */}
                  <text x={bx + PAD} y={by + PAD + 10} fill="rgba(130,155,200,0.75)"
                    fontSize={8} fontFamily="system-ui,sans-serif">topic</text>
                  {topicLines.map((line, i) => (
                    <text key={i} x={bx + PAD} y={by + PAD + 14 + 10 + i * TOPIC_LINE_HEIGHT}
                      fill="rgba(255,255,255,0.95)" fontSize={9} fontFamily="system-ui,sans-serif"
                      fontWeight="bold">
                      {line}
                    </text>
                  ))}
                  {(() => {
                    const startY = by + PAD + 14 + topicBlockH + 6;
                    const meta: [string, string][] = [
                      ['status', statusText],
                      ...(hovQuality !== undefined ? [['quality', `${(hovQuality * 100).toFixed(0)}%`] as [string, string]] : []),
                      ['visits', String(hoveredNode.visits)],
                      ['value', hoveredNode.avg_value.toFixed(3)],
                      ['depth', String(hoveredNode.depth)],
                    ];
                    return meta.map(([key, val], i) => (
                      <g key={i}>
                        <text x={bx + PAD} y={startY + i * ROW_HEIGHT}
                          fill="rgba(130,155,200,0.75)" fontSize={8} fontFamily="system-ui,sans-serif">
                          {key}
                        </text>
                        <text x={bx + 52} y={startY + i * ROW_HEIGHT}
                          fill="rgba(215,228,248,0.9)" fontSize={8} fontFamily="system-ui,sans-serif">
                          {val}
                        </text>
                      </g>
                    ));
                  })()}
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      {tree?.nodes && tree.nodes.length > 0 && (
        <div className="mcts-tree-viz__legend">
          <span className="mcts-tree-viz__legend-dot" style={{ background: '#f0c040' }} /> Root
          <span className="mcts-tree-viz__legend-dot mcts-tree-viz__legend-dot--pulse" style={{ background: '#facc15' }} /> Current
          <span className="mcts-tree-viz__legend-dot" style={{ background: '#4ade80' }} /> Predicted next
          <span style={{ color: '#4ade80', fontSize: '0.7rem', marginLeft: 2 }}>⇢ progressing to</span>
          <span className="mcts-tree-viz__legend-dot" style={{ background: '#22d3ee' }} /> Covered
          <span className="mcts-tree-viz__legend-dot" style={{ background: '#fb923c' }} /> Weak
          <span className="mcts-tree-viz__legend-dot" style={{ background: '#f87171' }} /> Not covered
        </div>
      )}
    </div>
  );
});
