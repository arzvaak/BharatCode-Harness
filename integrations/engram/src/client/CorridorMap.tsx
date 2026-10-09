/**
 * Corridor bird's-eye map: a moderate force-directed layout + drag + hover neighbor highlighting
 * + a responsive viewBox.
 *
 * Design notes:
 * 1. A cooling schedule takes alpha 1.0 → 0.1 (240 ticks) so convergence does not jitter.
 * 2. Dragging a node: mousedown grabs it → mousemove rewrites vx/vy to 0 (snap to the mouse) → mouseup releases it.
 * 3. Hovering a node: that node + its one-hop neighbors + the related edges are highlighted; the rest fade to 0.15 opacity.
 * 4. The tooltip shows the full placard (it keeps the SVG <title> tag and adds a custom <foreignObject> HTML tooltip for readability).
 * 5. The viewBox adapts to the container width (preserveAspectRatio="xMidYMid meet"), with a fixed 560x320 logical coordinate space.
 *
 * @module @kenz1117/dsh-engram/client/CorridorMap
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import styles from './panel.module.css'
import { KIND_KEY, type EngramKey } from './locales.ts'

/** The translation function used by the corridor map (a narrow signature synthesized by the renderer). */
type CorridorT = (key: EngramKey, params?: Record<string, unknown>) => string

/** kind → localized room name (falls back to the data value when the dictionary is missing). */
function roomLabel(t: CorridorT, kind: string): string {
  const key = KIND_KEY[kind]
  return key === undefined ? kind : t(key as EngramKey)
}

interface CorridorNode {
  readonly id: string
  readonly scope: string
  readonly kind: string
  readonly status: string
  readonly importance: number
  readonly confidence: number
  readonly title: string
  /** Optional backend field: the full placard (used for the tooltip). */
  readonly content?: string
}
interface CorridorEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: string
}

/** Room palette: 5 semantic hues (grouped by kind). */
const KIND_PALETTE: Readonly<Record<string, string>> = {
  fact: '#5b8def',
  preference: '#f0a85c',
  decision: '#9b6bd9',
  episode: '#3cb489',
  skill: '#e26b86',
}

/** Visual semantics of an edge. dash is explicitly allowed to be undefined: under exactOptionalPropertyTypes a literal table does not need each key deleted. */
type EdgeStyle = { color: string; dash?: string | undefined; width: number }
const EDGE_STYLE: Readonly<Record<string, EdgeStyle>> = {
  related:   { color: 'rgba(120, 130, 150, 0.6)',  dash: undefined, width: 1 },
  refines:   { color: 'rgba(120, 130, 150, 0.6)',  dash: undefined, width: 1 },
  supports:  { color: 'rgba(120, 130, 150, 0.6)',  dash: undefined, width: 1 },
  supersedes:{ color: 'rgba(91, 141, 239, 0.85)', dash: undefined, width: 1.8 },
  contradicts:{ color: 'rgba(226, 107, 134, 0.9)', dash: '4 4',     width: 1.4 },
}

interface PositionedNode extends CorridorNode {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** Whether the user is dragging it (tick force updates are disabled while dragging). */
  fixed: boolean
}

interface CorridorMapProps {
  readonly scope: 'user' | 'project' | 'shared'
  readonly nodes: readonly CorridorNode[]
  readonly edges: readonly CorridorEdge[]
  readonly onSelect?: (id: string) => void
  readonly selectedId?: string
  /** UI copy (room names and the legend go through the host locale dictionary). */
  readonly t: CorridorT
}

/** Node radius. */
function nodeRadius(n: CorridorNode): number {
  return Math.max(4, Math.min(14, 4 + 10 * n.importance * n.confidence))
}

/** Single force-update step (with a cooling alpha). */
function step(nodes: PositionedNode[], edges: readonly CorridorEdge[], width: number, height: number, alpha: number): void {
  const REPLUSION = 4800
  const SPRING_LEN = 64
  const SPRING_K = 0.04
  const CENTER_K = 0.003
  const FLOOR_K = 0.005
  // Repulsion: inverse-square (with an alpha cooling).
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]!
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]!
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01
      const force = (REPLUSION * alpha) / (dist * dist)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
  }
  // Spring force.
  const nodeMap = new Map<string, PositionedNode>(nodes.map(n => [n.id, n]))
  for (const edge of edges) {
    const a = nodeMap.get(edge.from)
    const b = nodeMap.get(edge.to)
    if (a === undefined || b === undefined) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.01
    const force = (dist - SPRING_LEN) * SPRING_K * alpha
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  }
  // Center gravity + horizontal clustering by room.
  const kinds = [...new Set(nodes.map(n => n.kind))]
  const band = width / Math.max(kinds.length, 1)
  for (const n of nodes) {
    if (n.fixed) continue
    n.vx += (width / 2 - n.x) * CENTER_K * alpha
    n.vy += (height / 2 - n.y) * CENTER_K * alpha
    const idx = kinds.indexOf(n.kind)
    if (idx >= 0) {
      const target = band * (idx + 0.5)
      n.vx += (target - n.x) * FLOOR_K * alpha
    }
  }
  // Damping + boundaries.
  const DAMPING = 0.82
  for (const n of nodes) {
    if (n.fixed) { n.vx = 0; n.vy = 0; continue }
    n.vx *= DAMPING
    n.vy *= DAMPING
    n.x = Math.max(20, Math.min(width - 20, n.x + n.vx))
    n.y = Math.max(20, Math.min(height - 20, n.y + n.vy))
  }
}

/** The corridor bird's-eye component. */
export function CorridorMap(props: CorridorMapProps): ReactElement {
  const { scope, nodes, edges, onSelect, selectedId, t } = props
  const width = 560
  const height = 320
  /** Neighbor table: node id → set of neighbor ids (one hop). */
  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const n of nodes) map.set(n.id, new Set())
    for (const e of edges) {
      if (!map.has(e.from)) map.set(e.from, new Set())
      if (!map.has(e.to)) map.set(e.to, new Set())
      map.get(e.from)!.add(e.to)
      map.get(e.to)!.add(e.from)
    }
    return map
  }, [nodes, edges])
  /** Initial layout: bands divided horizontally by room, with vertical jitter. */
  const initialNodes = useMemo<PositionedNode[]>(() => {
    const kinds = [...new Set(nodes.map(n => n.kind))]
    const band = width / Math.max(kinds.length, 1)
    return nodes.map((n, index) => ({
      ...n,
      x: kinds.indexOf(n.kind) >= 0 ? band * (kinds.indexOf(n.kind) + 0.5) : width / 2,
      y: 30 + ((index * 47) % (height - 60)),
      vx: 0, vy: 0,
      r: nodeRadius(n),
      fixed: false,
    }))
  }, [nodes, width, height])
  const positionsRef = useRef<PositionedNode[]>(initialNodes.map(n => ({ ...n })))
  const [, forceRender] = useState(0)
  const animRef = useRef<number | null>(null)
  const tickRef = useRef(0)
  const totalTicks = 280
  // Initialize / reset: copy the new layout and zero the tick counter.
  useEffect(() => {
    positionsRef.current = initialNodes.map(n => ({ ...n }))
    tickRef.current = 0
    forceRender(value => value + 1)
  }, [initialNodes])
  // Force-directed main loop: requestAnimationFrame, alpha 1.0 → 0.1.
  useEffect(() => {
    const tick = (): void => {
      const nodesArr = positionsRef.current
      tickRef.current += 1
      const alpha = Math.max(0.1, 1 - (tickRef.current / totalTicks) * 0.9)
      step(nodesArr, edges, width, height, alpha)
      // Trigger a React re-render (immutable snapshot: copy the references once).
      positionsRef.current = nodesArr.map(n => ({ ...n }))
      forceRender(value => value + 1)
      if (tickRef.current < totalTicks) animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick only restarts on new nodes/edges
  }, [initialNodes, edges])
  const positions = positionsRef.current
  const posMap = useMemo(() => new Map(positions.map(p => [p.id, p])), [positions])
  const roomKinds = useMemo(() => [...new Set(nodes.map(n => n.kind))], [nodes])
  /** Hover highlight: current node id → set of neighbor ids; null = no highlighting. */
  const [hoverId, setHoverId] = useState<string | null>(null)
  const hoverNeighbors = useMemo(() => {
    if (hoverId === null) return null
    return neighborMap.get(hoverId) ?? new Set<string>()
  }, [hoverId, neighborMap])
  const isFaded = (nId: string): boolean => hoverId !== null && nId !== hoverId && !(hoverNeighbors?.has(nId) ?? false)
  const isEdgeHighlighted = (e: CorridorEdge): boolean => {
    if (hoverId === null) return false
    return e.from === hoverId || e.to === hoverId
  }
  /** drag: mousedown grabs the node → mousemove sets vx/vy to 0 → mouseup releases it. */
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const svgToScreen = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    if (svg === null) return null
    const rect = svg.getBoundingClientRect()
    // viewBox 0 0 width height, preserveAspectRatio meet → proportional scaling; logical coords = screen coords * (width / rect.width)
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }
  const onNodeMouseDown = (event: React.MouseEvent<SVGGElement>, nodeId: string): void => {
    event.preventDefault()
    dragIdRef.current = nodeId
    const node = positionsRef.current.find(n => n.id === nodeId)
    if (node !== undefined) node.fixed = true
  }
  useEffect(() => {
    const handleMove = (event: MouseEvent): void => {
      const id = dragIdRef.current
      if (id === null) return
      const pos = svgToScreen(event.clientX, event.clientY)
      if (pos === null) return
      const node = positionsRef.current.find(n => n.id === id)
      if (node === undefined) return
      node.x = Math.max(20, Math.min(width - 20, pos.x))
      node.y = Math.max(20, Math.min(height - 20, pos.y))
      node.vx = 0
      node.vy = 0
      forceRender(value => value + 1)
    }
    const handleUp = (): void => {
      const id = dragIdRef.current
      if (id === null) return
      const node = positionsRef.current.find(n => n.id === id)
      if (node !== undefined) node.fixed = false
      dragIdRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (nodes.length === 0) {
    return <div className={styles.empty}>{t('corridorEmpty')}</div>
  }

  return (
    <div className={styles.mapWrap}>
      <svg ref={svgRef} viewBox={`0 0 ${String(width)} ${String(height)}`} className={styles.map}
        preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('corridorAria')} key={scope}>
        {/* Room background bands (zebra-striping for separation). A scope switch re-mounts via the parent svg key, triggering a fade-in. */}
        {roomKinds.map((kind, idx) => {
          const band = width / Math.max(roomKinds.length, 1)
          return <rect key={kind} x={band * idx} y={0} width={band} height={height} fill={idx % 2 === 0 ? 'rgba(127,127,127,0.04)' : 'transparent'} />
        })}
        {/* Room label strip along the top. */}
        {roomKinds.map((kind, idx) => {
          const band = width / Math.max(roomKinds.length, 1)
          return (
            <text key={`${kind}-label`} x={band * (idx + 0.5)} y={14} textAnchor="middle"
              fill="rgba(127,127,127,0.7)" fontSize="10" fontFamily="ui-sans-serif, system-ui">
              {roomLabel(t, kind)}
            </text>
          )
        })}
        {/* Corridor edges: when highlighted, draw a spring arc (quadratic curve + 6px vertical bulge); other edges stay straight.
            A stagger-delay fades the edges in one by one by their from-node index, reinforcing the "map refresh" feel. */}
        {edges.map((edge, idx) => {
          const a = posMap.get(edge.from)
          const b = posMap.get(edge.to)
          if (a === undefined || b === undefined) return null
          const style = EDGE_STYLE[edge.type] ?? EDGE_STYLE.related!
          const highlighted = isEdgeHighlighted(edge)
          const faded = hoverId !== null && !highlighted
          if (highlighted) {
            // Vertical midpoint offset: constructs the spring visual.
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            const dx = b.x - a.x
            const dy = b.y - a.y
            const length = Math.sqrt(dx * dx + dy * dy) || 1
            const offsetX = (-dy / length) * 6
            const offsetY = (dx / length) * 6
            return (
              <path key={edge.id} d={`M ${String(a.x)} ${String(a.y)} Q ${String(mx + offsetX)} ${String(my + offsetY)} ${String(b.x)} ${String(b.y)}`}
                fill="none" stroke={style.color}
                strokeWidth={style.width + 1.2} strokeDasharray={style.dash}
                style={{ transition: 'stroke-width 200ms ease, d 240ms ease' }}>
                <title>{`${a.title} --${edge.type}--> ${b.title}`}</title>
              </path>
            )
          }
          return (
            <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={style.color} strokeWidth={style.width}
              strokeDasharray={style.dash} opacity={faded ? 0.1 : 1}
              className={styles.edgeFade}
              style={{ transition: 'opacity 200ms ease, stroke-width 200ms ease', animationDelay: `${String(Math.min(idx, 24) * 24)}ms` }}>
              <title>{`${a.title} --${edge.type}--> ${b.title}`}</title>
            </line>
          )
        })}
        {/* Room nodes. */}
        {positions.map((n, index) => {
          const color = KIND_PALETTE[n.kind] ?? '#7d8590'
          const isSelected = selectedId === n.id
          const isHovered = hoverId === n.id
          const faded = isFaded(n.id)
          return (
            <g key={n.id} className={styles.node} transform={`translate(${String(n.x)} ${String(n.y)})`}
              style={{ cursor: dragIdRef.current === n.id ? 'grabbing' : 'grab', opacity: faded ? 0.15 : 1, transition: 'opacity 200ms ease', animationDelay: `${String(Math.min(index, 24) * 24)}ms` }}
              onMouseEnter={() => { setHoverId(n.id) }}
              onMouseLeave={() => { setHoverId(prev => prev === n.id ? null : prev) }}
              onMouseDown={event => onNodeMouseDown(event, n.id)}
              onClick={() => onSelect?.(n.id)}>
              {/* On hover, draw a soft glow halo around it. */}
              {(isHovered || isSelected) && (
                <circle r={String(n.r + 6)} fill={color} fillOpacity={0.18} />
              )}
              <circle r={String(n.r)} fill={color} fillOpacity={n.status === 'active' ? 0.88 : 0.42}
                stroke={isSelected ? 'var(--dsw-alias-brand-primary)' : isHovered ? color : 'rgba(255,255,255,0.9)'}
                strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 1}
                style={{ transition: 'stroke 160ms ease, stroke-width 160ms ease' }}>
                <title>{`${n.title}（${n.kind}/${n.status}）`}</title>
              </circle>
              {isSelected && <circle r={String(n.r + 4)} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1} />}
            </g>
          )
        })}
        {/* Hover tooltip: an HTML overlay showing the full placard (rendered simply with SVG <text>). */}
        {hoverId !== null && (() => {
          const node = posMap.get(hoverId)
          if (node === undefined) return null
          const tx = Math.min(width - 180, Math.max(8, node.x + 14))
          const ty = Math.min(height - 60, Math.max(28, node.y - 16))
          const fullContent = (node.content ?? node.title).slice(0, 120)
          return (
            <g className={styles.tooltip} transform={`translate(${String(tx)} ${String(ty)})`}>
              <rect x={0} y={0} width={176} height={48} rx={6} ry={6}
                fill="var(--dsw-alias-bg-base)" stroke="var(--dsw-alias-border-l2)" strokeWidth={1} opacity={0.96} />
              <text x={8} y={16} fill="var(--dsw-alias-label-primary)" fontSize="11" fontWeight={600}
                fontFamily="ui-sans-serif, system-ui">{roomLabel(t, node.kind)}</text>
              <text x={8} y={32} fill="var(--dsw-alias-label-secondary)" fontSize="10"
                fontFamily="ui-sans-serif, system-ui">{`${fullContent}${(node.content ?? node.title).length > 120 ? '…' : ''}`}</text>
            </g>
          )
        })()}
      </svg>
      <div className={styles.legend}>
        {roomKinds.map(kind => (
          <span key={kind} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: KIND_PALETTE[kind] ?? '#7d8590' }} />
            {roomLabel(t, kind)}
          </span>
        ))}
        <span className={styles.legendItem}>{t('corridorSummary', { nodes: nodes.length, edges: edges.length })}</span>
      </div>
      <div className={styles.legend} style={{ marginTop: 2 }}>
        {Object.entries(EDGE_STYLE).map(([type, style]) => (
          <span key={type} className={styles.legendItem}>
            <svg width={20} height={6} aria-hidden="true">
              <line x1={0} y1={3} x2={20} y2={3} stroke={style.color} strokeWidth={style.width} strokeDasharray={style.dash} />
            </svg>
            <span>{type === 'supersedes' ? t('edgeSupersedes') : type === 'contradicts' ? t('edgeContradicts') : t('edgeOther')}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
