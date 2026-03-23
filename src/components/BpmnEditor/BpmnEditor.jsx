import { useState, useRef, useCallback, useEffect } from 'react';
import './BpmnEditor.css';

// ─── Element definitions ──────────────────────────────────────────────────────
const DEFS = {
  startEvent:        { label: 'Start Event',      w: 44,  h: 44,  color: '#16a34a', icon: '▶', group: 'Events'     },
  endEvent:          { label: 'End Event',         w: 44,  h: 44,  color: '#dc2626', icon: '■', group: 'Events'     },
  intermediateEvent: { label: 'Intermediate',      w: 44,  h: 44,  color: '#d97706', icon: '◎', group: 'Events'     },
  userTask:          { label: 'User Task',         w: 130, h: 66,  color: '#2563eb', icon: '👤', group: 'Tasks'      },
  serviceTask:       { label: 'Service Task',      w: 130, h: 66,  color: '#7c3aed', icon: '⚙',  group: 'Tasks'      },
  scriptTask:        { label: 'Script Task',       w: 130, h: 66,  color: '#6d28d9', icon: '📜', group: 'Tasks'      },
  manualTask:        { label: 'Manual Task',       w: 130, h: 66,  color: '#0891b2', icon: '✋', group: 'Tasks'      },
  sendTask:          { label: 'Send Task',         w: 130, h: 66,  color: '#0284c7', icon: '📤', group: 'Tasks'      },
  receiveTask:       { label: 'Receive Task',      w: 130, h: 66,  color: '#0d9488', icon: '📥', group: 'Tasks'      },
  businessRuleTask:  { label: 'Business Rule',     w: 130, h: 66,  color: '#b45309', icon: '📋', group: 'Tasks'      },
  exclusiveGateway:  { label: 'Exclusive Gateway', w: 52,  h: 52,  color: '#d97706', icon: '✕',  group: 'Gateways'   },
  parallelGateway:   { label: 'Parallel Gateway',  w: 52,  h: 52,  color: '#059669', icon: '+',  group: 'Gateways'   },
  inclusiveGateway:  { label: 'Inclusive Gateway', w: 52,  h: 52,  color: '#db2777', icon: '○',  group: 'Gateways'   },
  subProcess:        { label: 'Sub-Process',       w: 160, h: 80,  color: '#475569', icon: '⊞',  group: 'Containers' },
  pool:              { label: 'Pool',              w: 420, h: 130, color: '#334155', icon: '▬',  group: 'Containers' },
  dataObject:        { label: 'Data Object',       w: 42,  h: 56,  color: '#64748b', icon: '📄', group: 'Data'       },
  annotation:        { label: 'Annotation',        w: 130, h: 52,  color: '#64748b', icon: '📝', group: 'Data'       },
};

const GROUPS = ['Events', 'Tasks', 'Gateways', 'Containers', 'Data'];

let _ctr = 3000;
const uid  = () => `el_${++_ctr}_${Math.random().toString(36).slice(2, 5)}`;
const snap = (v, g = 10) => Math.round(v / g) * g;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Get the 4 anchor points of an element in SVG coords
const anchors = (el) => [
  { id: 'top',    x: el.x + el.w / 2, y: el.y          },
  { id: 'right',  x: el.x + el.w,     y: el.y + el.h / 2 },
  { id: 'bottom', x: el.x + el.w / 2, y: el.y + el.h   },
  { id: 'left',   x: el.x,            y: el.y + el.h / 2 },
];

// ─── Shape ────────────────────────────────────────────────────────────────────
function Shape({ el, selected, connectMode, pendingSrc, onDragStart, onAnchorClick }) {
  const def = DEFS[el.type] || DEFS.userTask;
  const { x, y, w, h, label, type } = el;
  const isSource = pendingSrc === el.id;

  const gClass = [
    'bpmn-shape',
    selected    ? 'is-selected' : '',
    isSource    ? 'is-src'      : '',
    connectMode ? 'connect-mode' : '',
  ].filter(Boolean).join(' ');

  // Anchor dots (shown when connectMode is active)
  const AnchorDots = () => connectMode ? (
    <>
      {anchors(el).map(a => (
        <circle key={a.id} cx={a.x} cy={a.y} r={6}
          className="bpmn-anchor"
          onPointerDown={e => { e.stopPropagation(); onAnchorClick(el.id, a.x, a.y); }} />
      ))}
    </>
  ) : null;

  // ── Event (circle) ──
  if (type.endsWith('Event')) {
    const r  = Math.min(w, h) / 2 - 2;
    const cx = x + w / 2, cy = y + h / 2;
    const fill = type === 'startEvent' ? '#dcfce7' : type === 'endEvent' ? '#fee2e2' : '#fef3c7';
    return (
      <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
        {selected && <circle cx={cx} cy={cy} r={r + 8} className="bpmn-sel-ring" />}
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={def.color}
          strokeWidth={type === 'endEvent' ? 3.5 : 1.8} />
        <text x={cx} y={cy + 5} className="bpmn-txt-ico-sm" fill={def.color}>{def.icon}</text>
        {label && <text x={cx} y={y + h + 16} className="bpmn-txt-lbl">{label}</text>}
        <AnchorDots />
      </g>
    );
  }

  // ── Gateway (diamond) ──
  if (type.endsWith('Gateway')) {
    const cx = x + w / 2, cy = y + h / 2;
    const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
    return (
      <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
        {selected && <polygon
          points={`${cx},${y - 8} ${x + w + 8},${cy} ${cx},${y + h + 8} ${x - 8},${cy}`}
          className="bpmn-sel-ring" />}
        <polygon points={pts} fill="#fffbeb" stroke={def.color} strokeWidth={1.8} />
        <text x={cx} y={cy + 6} className="bpmn-txt-ico-lg" fill={def.color}>{def.icon}</text>
        {label && <text x={cx} y={y + h + 16} className="bpmn-txt-lbl">{label}</text>}
        <AnchorDots />
      </g>
    );
  }

  // ── Data Object ──
  if (type === 'dataObject') {
    const fold = 11;
    return (
      <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
        <polygon points={`${x},${y} ${x+w-fold},${y} ${x+w},${y+fold} ${x+w},${y+h} ${x},${y+h}`}
          fill="#f8fafc" stroke="#64748b" strokeWidth={1.5} />
        <polyline points={`${x+w-fold},${y} ${x+w-fold},${y+fold} ${x+w},${y+fold}`}
          fill="none" stroke="#64748b" strokeWidth={1.2} />
        {selected && <rect x={x-3} y={y-3} width={w+6} height={h+6} className="bpmn-sel-ring" rx={2} />}
        {label && <text x={x+w/2} y={y+h+16} className="bpmn-txt-lbl">{label}</text>}
      </g>
    );
  }

  // ── Annotation ──
  if (type === 'annotation') {
    return (
      <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
        <rect x={x} y={y} width={w} height={h} fill="#fffbeb" rx={3} />
        {selected && <rect x={x-2} y={y-2} width={w+4} height={h+4} className="bpmn-sel-ring" rx={4} />}
        <polyline points={`${x+14},${y+6} ${x+6},${y+6} ${x+6},${y+h-6} ${x+14},${y+h-6}`}
          fill="none" stroke="#d97706" strokeWidth={1.8} />
        <foreignObject x={x+18} y={y+6} width={w-24} height={h-12}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize:11, color:'#78350f', lineHeight:1.4, overflow:'hidden', fontFamily:'inherit' }}>
            {label || 'Note…'}
          </div>
        </foreignObject>
      </g>
    );
  }

  // ── Pool ──
  if (type === 'pool') {
    return (
      <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
        <rect x={x} y={y} width={w} height={h} fill="#f8fafc" stroke="#334155" strokeWidth={1.8} rx={3} />
        <rect x={x} y={y} width={34} height={h} fill="#e2e8f0" stroke="#334155" strokeWidth={1} rx={3} />
        {selected && <rect x={x-3} y={y-3} width={w+6} height={h+6} className="bpmn-sel-ring" rx={5} />}
        <text transform={`rotate(-90,${x+17},${y+h/2})`} x={x+17} y={y+h/2+5}
          className="bpmn-txt-pool">{label || 'Pool'}</text>
        <AnchorDots />
      </g>
    );
  }

  // ── Sub-Process ──
  if (type === 'subProcess') {
    return (
      <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
        <rect x={x} y={y} width={w} height={h} fill="#f8fafc" stroke="#475569"
          strokeWidth={1.8} strokeDasharray="7 3" rx={8} />
        {selected && <rect x={x-4} y={y-4} width={w+8} height={h+8} className="bpmn-sel-ring" rx={11} />}
        <rect x={x+w/2-9} y={y+h-17} width={18} height={13} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} rx={3} />
        <text x={x+w/2} y={y+h-7} textAnchor="middle" fontSize={10} fill="#64748b" pointerEvents="none">+</text>
        <text x={x+w/2} y={y+24} className="bpmn-txt-task">{label || 'Sub-Process'}</text>
        <AnchorDots />
      </g>
    );
  }

  // ── Task (default) ──
  return (
    <g className={gClass} onPointerDown={e => onDragStart(e, el.id)}>
      {selected && <rect x={x-5} y={y-5} width={w+10} height={h+10} className="bpmn-sel-ring" rx={13} />}
      <rect x={x} y={y} width={w} height={h} rx={8} fill="white"
        stroke={selected ? '#3b5bdb' : def.color} strokeWidth={selected ? 2.2 : 1.7} />
      {/* colour strip */}
      <rect x={x+1} y={y+1} width={w-2} height={8} rx={7} fill={def.color} opacity={0.12} />
      {/* icon badge */}
      <rect x={x+8} y={y+10} width={24} height={20} rx={5} fill={def.color} opacity={0.12} />
      <text x={x+20} y={y+24} className="bpmn-txt-ico-sm" fill={def.color}>{def.icon}</text>
      {/* label */}
      <foreignObject x={x+36} y={y+9} width={w-44} height={h-14}>
        <div xmlns="http://www.w3.org/1999/xhtml" className="bpmn-fo-label">
          {label || def.label}
        </div>
      </foreignObject>
      <AnchorDots />
    </g>
  );
}

// ─── Arrow ────────────────────────────────────────────────────────────────────
function Arrow({ conn, elements, selected, onClick }) {
  const src = elements.find(e => e.id === conn.from);
  const tgt = elements.find(e => e.id === conn.to);
  if (!src || !tgt) return null;

  // Pick the nearest anchor pair so arrows attach cleanly
  const srcAnchors = anchors(src);
  const tgtAnchors = anchors(tgt);
  let best = { d: Infinity, sx: 0, sy: 0, tx: 0, ty: 0 };
  for (const sa of srcAnchors) {
    for (const ta of tgtAnchors) {
      const d = (sa.x - ta.x) ** 2 + (sa.y - ta.y) ** 2;
      if (d < best.d) best = { d, sx: sa.x, sy: sa.y, tx: ta.x, ty: ta.y };
    }
  }
  const { sx, sy, tx, ty } = best;
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;

  return (
    <g onClick={onClick} className={`bpmn-arrow${selected ? ' is-selected' : ''}`}>
      {/* fat invisible hit area */}
      <line x1={sx} y1={sy} x2={tx} y2={ty} stroke="transparent" strokeWidth={16} />
      <line x1={sx} y1={sy} x2={tx} y2={ty}
        stroke={selected ? '#3b5bdb' : '#94a3b8'}
        strokeWidth={selected ? 2.2 : 1.6}
        markerEnd={selected ? 'url(#ah-sel)' : 'url(#ah)'} />
      {conn.label && (
        <text x={mx} y={my - 8} className="bpmn-txt-flow">{conn.label}</text>
      )}
    </g>
  );
}

// ─── Live draw arrow (while connecting) ───────────────────────────────────────
function LiveArrow({ from, to }) {
  if (!from || !to) return null;
  return (
    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
      stroke="#3b5bdb" strokeWidth={1.8} strokeDasharray="6 3"
      markerEnd="url(#ah-draw)" pointerEvents="none" />
  );
}

// ─── Properties panel ─────────────────────────────────────────────────────────
function PropsPanel({ selId, elements, connections, onUpdate, onDelete }) {
  const el     = elements.find(e => e.id === selId) || connections.find(c => c.id === selId);
  const isConn = !!connections.find(c => c.id === selId);
  const def    = !isConn && el ? (DEFS[el.type] || DEFS.userTask) : null;

  if (!el) return (
    <div className="bpmn-props-empty">
      <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
      <p>Select a shape or arrow<br />to edit its properties</p>
    </div>
  );

  return (
    <div className="bpmn-props-body">
      {/* badge */}
      <div className="bpmn-badge" style={{ '--bc': def?.color || '#3b5bdb' }}>
        <span className="bpmn-badge-ico">{isConn ? '→' : def?.icon}</span>
        <div>
          <div className="bpmn-badge-type">{isConn ? 'Sequence Flow' : def?.label}</div>
          <div className="bpmn-badge-id">{el.id}</div>
        </div>
      </div>

      {/* name */}
      <label className="bpmn-pf-lbl">Name</label>
      <input className="bpmn-pf-ctrl" value={el.label || ''} placeholder="Enter name…"
        onChange={e => onUpdate(el.id, { label: e.target.value })} />

      {/* assignee */}
      {!isConn && ['userTask','manualTask'].includes(el.type) && <>
        <label className="bpmn-pf-lbl">Assignee</label>
        <input className="bpmn-pf-ctrl" value={el.assignee || ''} placeholder="${initiator}"
          onChange={e => onUpdate(el.id, { assignee: e.target.value })} />
      </>}

      {/* condition (flow only) */}
      {isConn && <>
        <label className="bpmn-pf-lbl">Condition</label>
        <input className="bpmn-pf-ctrl" value={el.condition || ''} placeholder="e.g. approved == true"
          onChange={e => onUpdate(el.id, { condition: e.target.value })} />
      </>}

      {/* status */}
      {!isConn && <>
        <label className="bpmn-pf-lbl">Status</label>
        <select className="bpmn-pf-ctrl" value={el.status || ''}
          onChange={e => onUpdate(el.id, { status: e.target.value })}>
          <option value="">— None —</option>
          <option value="todo">To Do</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
        </select>
      </>}

      {/* docs */}
      <label className="bpmn-pf-lbl">Documentation</label>
      <textarea className="bpmn-pf-ctrl bpmn-pf-ta" rows={3}
        value={el.docs || ''} placeholder="Add notes…"
        onChange={e => onUpdate(el.id, { docs: e.target.value })} />

      {/* coords */}
      {!isConn && <>
        <label className="bpmn-pf-lbl">Position &amp; Size</label>
        <div className="bpmn-pf-grid">
          {['x','y','w','h'].map(k => (
            <div key={k}>
              <span className="bpmn-pf-coord-key">{k.toUpperCase()}</span>
              <input className="bpmn-pf-ctrl bpmn-pf-num" type="number"
                value={Math.round(el[k] || 0)}
                onChange={e => onUpdate(el.id, { [k]: +e.target.value })} />
            </div>
          ))}
        </div>
      </>}

      <button className="bpmn-pf-del" onClick={() => onDelete(el.id)}>🗑 Delete</button>
    </div>
  );
}

// ─── BpmnEditor ───────────────────────────────────────────────────────────────
export default function BpmnEditor({ process, onClose, onSave }) {
  const svgRef  = useRef(null);
  const wrapRef = useRef(null);

  // ── Diagram state ──
  const [elements, setElements] = useState(() => {
    try {
      const d = process?.bpmn_xml ? JSON.parse(process.bpmn_xml) : null;
      if (d?.elements?.length) return d.elements;
    } catch { /**/ }
    // default example diagram
    return [
      { id: 'el_s', type: 'startEvent',      x: 80,  y: 200, w: 44,  h: 44,  label: 'Start' },
      { id: 'el_1', type: 'userTask',         x: 200, y: 180, w: 130, h: 66,  label: 'Review Request' },
      { id: 'el_g', type: 'exclusiveGateway', x: 400, y: 186, w: 52,  h: 52,  label: 'Approved?' },
      { id: 'el_2', type: 'userTask',         x: 530, y: 120, w: 130, h: 66,  label: 'Approve' },
      { id: 'el_3', type: 'userTask',         x: 530, y: 234, w: 130, h: 66,  label: 'Reject'  },
      { id: 'el_e', type: 'endEvent',         x: 740, y: 200, w: 44,  h: 44,  label: 'End'     },
    ];
  });

  const [connections, setConnections] = useState(() => {
    try {
      const d = process?.bpmn_xml ? JSON.parse(process.bpmn_xml) : null;
      if (d?.connections?.length) return d.connections;
    } catch { /**/ }
    return [
      { id: 'c_1', from: 'el_s', to: 'el_1', label: '' },
      { id: 'c_2', from: 'el_1', to: 'el_g', label: '' },
      { id: 'c_3', from: 'el_g', to: 'el_2', label: 'Yes' },
      { id: 'c_4', from: 'el_g', to: 'el_3', label: 'No'  },
      { id: 'c_5', from: 'el_2', to: 'el_e', label: '' },
      { id: 'c_6', from: 'el_3', to: 'el_e', label: '' },
    ];
  });

  // ── UI state ──
  const [selected,   setSelected]   = useState(null);
  const [tool,       setTool]       = useState('select'); // select | connect | pan
  const [zoom,       setZoom]       = useState(1);
  const [pan,        setPan]        = useState({ x: 40, y: 20 });
  const [dragging,   setDragging]   = useState(null);  // { id, ox, oy }
  const [panning,    setPanning]    = useState(null);  // { mx, my, px, py }
  const [connSrc,    setConnSrc]    = useState(null);  // { elId, x, y }  — pending connection source
  const [mousePt,    setMousePt]    = useState(null);  // SVG-space mouse pos
  const [search,     setSearch]     = useState('');
  const [history,    setHistory]    = useState([]);
  const [future,     setFuture]     = useState([]);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error

  // ── SVG coordinate helper ──
  const toSvg = useCallback((clientX, clientY) => {
    const r = svgRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    return {
      x: (clientX - r.left - pan.x) / zoom,
      y: (clientY - r.top  - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // ── History ──
  const commit = useCallback(() => {
    setHistory(h => [...h.slice(-50), { elements, connections }]);
    setFuture([]);
  }, [elements, connections]);

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture(f => [{ elements, connections }, ...f.slice(0, 30)]);
      setElements(prev.elements);
      setConnections(prev.connections);
      return h.slice(0, -1);
    });
  }, [elements, connections]);

  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f;
      const next = f[0];
      setHistory(h => [...h, { elements, connections }]);
      setElements(next.elements);
      setConnections(next.connections);
      return f.slice(1);
    });
  }, [elements, connections]);

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if ((e.ctrlKey||e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='Z'))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey||e.metaKey) && e.key === 's') { e.preventDefault(); doSave(); }
      if ((e.key==='Delete'||e.key==='Backspace') && selected) {
        commit();
        setElements(els => els.filter(el => el.id !== selected));
        setConnections(cs => cs.filter(c => c.id!==selected && c.from!==selected && c.to!==selected));
        setSelected(null);
      }
      if (e.key === 'Escape') { setConnSrc(null); setSelected(null); if(tool==='connect') setTool('select'); }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key==='v'||e.key==='V') setTool('select');
        if (e.key==='c'||e.key==='C') { setTool('connect'); setSelected(null); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Wheel zoom ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fn = (e) => {
      e.preventDefault();
      setZoom(z => Math.min(6, Math.max(0.1, z * (e.deltaY < 0 ? 1.12 : 0.89))));
    };
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  });

  // ── Drop from palette ──
  const onDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('bpmn-type');
    if (!type) return;
    const def = DEFS[type];
    const pt  = toSvg(e.clientX, e.clientY);
    commit();
    setElements(els => [...els, {
      id: uid(), type,
      x: snap(pt.x - def.w / 2), y: snap(pt.y - def.h / 2),
      w: def.w, h: def.h, label: def.label,
    }]);
  };

  // ── CONNECT: anchor dot clicked ───────────────────────────────────────────
  // This is intentionally separate from drag — it uses pointerDown on the dot itself
  const onAnchorClick = useCallback((elId, ax, ay) => {
    if (!connSrc) {
      // First click → remember source
      setConnSrc({ elId, x: ax, y: ay });
    } else {
      // Second click → create connection (allow self-connect? no)
      if (connSrc.elId !== elId) {
        commit();
        setConnections(cs => [...cs, { id: uid(), from: connSrc.elId, to: elId, label: '' }]);
      }
      setConnSrc(null);
    }
  }, [connSrc, commit]);

  // ── DRAG shape ────────────────────────────────────────────────────────────
  // NOTE: in connect mode we do NOT drag, we just track the anchor clicks
  const onDragStart = useCallback((e, id) => {
    e.stopPropagation();
    setSelected(id);

    if (tool === 'connect') {
      // In connect mode, clicking the shape body (not an anchor) does nothing special
      // The user should click the anchor dots instead
      return;
    }

    // select tool — start drag
    const el = elements.find(el => el.id === id);
    const pt = toSvg(e.clientX, e.clientY);
    setDragging({ id, ox: pt.x - el.x, oy: pt.y - el.y });
  }, [tool, elements, toSvg]);

  // ── SVG background click ──
  const onBgDown = (e) => {
    // Middle button or Pan tool → pan
    if (e.button === 1 || (e.button === 0 && tool === 'pan')) {
      e.preventDefault();
      setPanning({ mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y });
      return;
    }
    // Left click on background → deselect; if connecting → cancel
    if (e.button === 0) {
      setSelected(null);
      setConnSrc(null);
    }
  };

  // ── Pointer move ──
  const onMove = (e) => {
    const pt = toSvg(e.clientX, e.clientY);
    setMousePt(pt);

    if (dragging) {
      setElements(els => els.map(el =>
        el.id === dragging.id
          ? { ...el, x: snap(pt.x - dragging.ox), y: snap(pt.y - dragging.oy) }
          : el
      ));
    }
    if (panning) {
      setPan({ x: panning.px + e.clientX - panning.mx, y: panning.py + e.clientY - panning.my });
    }
  };

  const onUp = () => {
    if (dragging) commit();
    setDragging(null);
    setPanning(null);
  };

  // ── Update / Delete ──
  const updateEl = (id, patch) => {
    setElements(els => els.map(e => e.id === id ? { ...e, ...patch } : e));
    setConnections(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const deleteEl = (id) => {
    commit();
    setElements(els => els.filter(e => e.id !== id));
    setConnections(cs => cs.filter(c => c.id !== id && c.from !== id && c.to !== id));
    setSelected(null);
  };

  // ── Add element from palette click ──
  const addEl = (type) => {
    const def = DEFS[type];
    const r   = svgRef.current?.getBoundingClientRect() || { width: 800, height: 500 };
    commit();
    setElements(els => [...els, {
      id: uid(), type,
      x: snap((r.width  / 2 - pan.x) / zoom - def.w / 2),
      y: snap((r.height / 2 - pan.y) / zoom - def.h / 2),
      w: def.w, h: def.h, label: def.label,
    }]);
  };

  // ── Fit view ──
  const fitView = () => {
    if (!elements.length) return;
    const xs = elements.map(e => e.x), ys = elements.map(e => e.y);
    const x2 = elements.map(e => e.x + e.w), y2 = elements.map(e => e.y + e.h);
    const r   = svgRef.current?.getBoundingClientRect() || { width: 800, height: 500 };
    const pad = 60;
    const nz  = Math.min(
      (r.width  - pad * 2) / (Math.max(...x2) - Math.min(...xs) || 1),
      (r.height - pad * 2) / (Math.max(...y2) - Math.min(...ys) || 1),
      2.5
    );
    setZoom(nz);
    setPan({ x: pad - Math.min(...xs) * nz, y: pad - Math.min(...ys) * nz });
  };

  // ── Save (sends JSON to server via onSave callback) ──
  const doSave = async () => {
    setSaveStatus('saving');
    try {
      if (onSave) await onSave(JSON.stringify({ elements, connections }));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err) {
      console.error('Save error:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // ── Export BPMN XML ──
  const exportXML = () => {
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_1">`,
      `  <bpmn:process id="Process_1" name="${process?.name || 'Process'}" isExecutable="false">`,
      ...elements.map(el => {
        if (el.type === 'startEvent')    return `    <bpmn:startEvent id="${el.id}" name="${el.label||''}"/>`;
        if (el.type === 'endEvent')      return `    <bpmn:endEvent id="${el.id}" name="${el.label||''}"/>`;
        if (el.type === 'intermediateEvent') return `    <bpmn:intermediateCatchEvent id="${el.id}" name="${el.label||''}"/>`;
        if (el.type.endsWith('Gateway')) return `    <bpmn:${el.type} id="${el.id}" name="${el.label||''}"/>`;
        if (el.type.endsWith('Task'))    return `    <bpmn:${el.type} id="${el.id}" name="${el.label||''}"/>`;
        return `    <bpmn:${el.type} id="${el.id}" name="${el.label||''}"/>`;
      }),
      ...connections.map(c =>
        `    <bpmn:sequenceFlow id="${c.id}" name="${c.label||''}" sourceRef="${c.from}" targetRef="${c.to}"/>`
      ),
      `  </bpmn:process>`,
      `</bpmn:definitions>`,
    ].join('\n');
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `${process?.name||'process'}.bpmn`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── Palette groups ──
  const paletteGroups = GROUPS.map(g => ({
    g,
    items: Object.entries(DEFS)
      .filter(([, d]) => d.group === g && (!search || d.label.toLowerCase().includes(search.toLowerCase())))
      .map(([type, def]) => ({ type, def })),
  })).filter(g => g.items.length);

  const saveLbl = { idle: '💾 Save', saving: '⏳ Saving…', saved: '✓ Saved!', error: '✗ Error' }[saveStatus];

  return (
    <div className="bpmn-editor">

      {/* ── Header ── */}
      <header className="bpmn-hdr">
        <div className="bpmn-hdr-l">
          <div className="bpmn-logo">⬡</div>
          <div className="bpmn-pinfo">
            <span className="bpmn-ptag">Process</span>
            <span className="bpmn-pname">{process?.name || 'Untitled'}</span>
          </div>
          <div className="bpmn-vline" />
          {/* Tool buttons */}
          <div className="bpmn-tools">
            {[
              ['select',  '↖', 'Select & Move (V)'],
              ['connect', '↔', 'Connect Elements (C) — click anchor dots'],
              ['pan',     '✥', 'Pan canvas'],
            ].map(([t, ico, tip]) => (
              <button key={t} title={tip}
                className={`bpmn-tool${tool===t?' active':''}`}
                onClick={() => { setTool(t); setConnSrc(null); setSelected(null); }}>
                {ico}
              </button>
            ))}
          </div>
        </div>

        <div className="bpmn-hdr-r">
          <div className="bpmn-cluster">
            <button className="bpmn-hb" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)">↩</button>
            <button className="bpmn-hb" onClick={redo} disabled={!future.length}  title="Redo (Ctrl+Y)">↪</button>
          </div>
          <div className="bpmn-cluster">
            <button className="bpmn-hb" onClick={() => setZoom(z => Math.max(0.1, z-0.15))}>−</button>
            <span className="bpmn-zpct">{Math.round(zoom*100)}%</span>
            <button className="bpmn-hb" onClick={() => setZoom(z => Math.min(6,   z+0.15))}>+</button>
            <button className="bpmn-hb" onClick={fitView} title="Fit view">⊡</button>
            <button className="bpmn-hb" onClick={() => { setZoom(1); setPan({x:40,y:20}); }} title="Reset view">↺</button>
          </div>
          <button className="bpmn-hb-sec" onClick={exportXML}>⬇ BPMN</button>
          <button className={`bpmn-hb-pri${saveStatus!=='idle'?` st-${saveStatus}`:''}`}
            onClick={doSave} disabled={saveStatus==='saving'}>
            {saveLbl}
          </button>
          <button className="bpmn-hb-cls" onClick={onClose} title="Close editor">✕</button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="bpmn-body">

        {/* Palette */}
        <aside className="bpmn-pal">
          <div className="bpmn-pal-top">
            <input className="bpmn-pal-srch" value={search}
              onChange={e => setSearch(e.target.value)} placeholder="🔍 Search…" />
          </div>
          <div className="bpmn-pal-list">
            {paletteGroups.map(({ g, items }) => (
              <div key={g} className="bpmn-pal-grp">
                <div className="bpmn-pal-grp-hd">{g}</div>
                {items.map(({ type, def }) => (
                  <div key={type} className="bpmn-pal-item"
                    draggable onDragStart={e => e.dataTransfer.setData('bpmn-type', type)}
                    onClick={() => addEl(type)}
                    title={`Add ${def.label} — or drag onto canvas`}>
                    <span className="bpmn-pal-ico"
                      style={{ background: def.color+'18', color: def.color }}>
                      {def.icon}
                    </span>
                    <span className="bpmn-pal-lbl">{def.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Connect hint */}
          {tool === 'connect' && (
            <div className={`bpmn-conn-banner${connSrc ? ' has-src' : ''}`}>
              {connSrc
                ? <><span>✔ Source selected — click a target anchor</span><button onClick={() => setConnSrc(null)}>✕</button></>
                : <span>↔ Click an anchor dot on any shape to start a connection</span>
              }
            </div>
          )}
        </aside>

        {/* Canvas */}
        <div ref={wrapRef} className="bpmn-cvs-wrap"
          onDragOver={e => e.preventDefault()} onDrop={onDrop}
          onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>

          {/* Dot grid */}
          <svg className="bpmn-dotgrid" aria-hidden="true">
            <defs>
              <pattern id="dg-sm" x={pan.x%(20*zoom)} y={pan.y%(20*zoom)}
                width={20*zoom} height={20*zoom} patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.9" fill="#cbd5e1" opacity="0.55" />
              </pattern>
              <pattern id="dg-lg" x={pan.x%(100*zoom)} y={pan.y%(100*zoom)}
                width={100*zoom} height={100*zoom} patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1.5" fill="#94a3b8" opacity="0.45" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dg-sm)" />
            <rect width="100%" height="100%" fill="url(#dg-lg)" />
          </svg>

          {/* Main SVG */}
          <svg ref={svgRef}
            className={`bpmn-svg tool-${tool}${panning?' is-pan':''}`}
            onPointerDown={onBgDown}>
            <defs>
              <marker id="ah" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
                <polygon points="0 0, 9 4, 0 8" fill="#94a3b8" />
              </marker>
              <marker id="ah-sel" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
                <polygon points="0 0, 9 4, 0 8" fill="#3b5bdb" />
              </marker>
              <marker id="ah-draw" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
                <polygon points="0 0, 9 4, 0 8" fill="#3b5bdb" opacity="0.7" />
              </marker>
            </defs>

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {/* Existing arrows */}
              {connections.map(c => (
                <Arrow key={c.id} conn={c} elements={elements}
                  selected={selected === c.id}
                  onClick={() => { setSelected(c.id); }} />
              ))}

              {/* Live arrow while connecting */}
              {connSrc && mousePt && (
                <LiveArrow from={connSrc} to={mousePt} />
              )}

              {/* Shapes */}
              {elements.map(el => (
                <Shape key={el.id} el={el}
                  selected={selected === el.id}
                  connectMode={tool === 'connect'}
                  pendingSrc={connSrc?.elId}
                  onDragStart={onDragStart}
                  onAnchorClick={onAnchorClick} />
              ))}
            </g>
          </svg>

          {/* Status bar */}
          <div className="bpmn-statusbar">
            <span>{elements.length} shapes</span>
            <span className="bpmn-sb-sep">·</span>
            <span>{connections.length} flows</span>
            <span className="bpmn-sb-sep">·</span>
            <span>{Math.round(zoom*100)}%</span>
            {connSrc && <><span className="bpmn-sb-sep">·</span><span className="bpmn-sb-conn">Connecting…</span></>}
          </div>
        </div>

        {/* Properties */}
        <aside className="bpmn-props">
          <div className="bpmn-props-hd">Properties</div>
          <PropsPanel
            selId={selected}
            elements={elements}
            connections={connections}
            onUpdate={updateEl}
            onDelete={deleteEl} />
        </aside>
      </div>
    </div>
  );
}
