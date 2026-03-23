// src/pages/OrgChart.jsx
// Fixed: no foreignObject (causes grey screen), correct parent_id type coercion,
// pure SVG text wrapping, stable layout algorithm.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API = 'http://localhost:3001/api';

// ─── Colors per category ──────────────────────────────────────────────────────
const CAT_PALETTE = [
  '#dc2626', '#1d4ed8', '#15803d', '#b45309',
  '#7c3aed', '#0e7490', '#be185d', '#374151',
];
const catColorCache = {};
let catColorIndex = 0;
function catColor(name) {
  if (!name) return '#374151';
  if (!catColorCache[name]) {
    catColorCache[name] = CAT_PALETTE[catColorIndex % CAT_PALETTE.length];
    catColorIndex++;
  }
  return catColorCache[name];
}

const STATUS = {
  draft:     { fill: '#fef9c3', text: '#854d0e', stroke: '#fde047', label: 'Draft'     },
  published: { fill: '#dcfce7', text: '#166534', stroke: '#86efac', label: 'Published' },
  active:    { fill: '#dcfce7', text: '#166534', stroke: '#86efac', label: 'Active'    },
  archived:  { fill: '#f1f5f9', text: '#475569', stroke: '#cbd5e1', label: 'Archived'  },
  review:    { fill: '#dbeafe', text: '#1e40af', stroke: '#93c5fd', label: 'Review'    },
};
function getStatus(s) { return STATUS[s] || STATUS.draft; }

function initials(name = '') {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const NW = 210;   // node width
const NH = 100;   // node height
const HG = 30;    // horizontal gap between siblings
const VG = 60;    // vertical gap between levels

// ─── Build tree, measure widths, assign positions ─────────────────────────────
function buildTree(processes) {
  // Coerce all ids to numbers for safe comparison
  const byId = {};
  processes.forEach(p => {
    byId[+p.id] = { ...p, id: +p.id, parent_id: p.parent_id != null ? +p.parent_id : null, _children: [] };
  });

  const roots = [];
  Object.values(byId).forEach(p => {
    if (p.parent_id != null && byId[p.parent_id]) {
      byId[p.parent_id]._children.push(p);
    } else {
      roots.push(p);
    }
  });

  function measure(node) {
    if (!node._children.length) { node._w = NW; return NW; }
    let total = node._children.reduce((sum, c, i) => sum + measure(c) + (i > 0 ? HG : 0), 0);
    node._w = Math.max(total, NW);
    return node._w;
  }

  function place(node, x, y) {
    node._x = x + (node._w - NW) / 2;
    node._y = y;
    let cx = x;
    node._children.forEach((c, i) => {
      place(c, cx, y + NH + VG);
      cx += c._w + (i < node._children.length - 1 ? HG : 0);
    });
  }

  roots.forEach(r => measure(r));

  let rx = 0;
  roots.forEach((r, i) => {
    place(r, rx, 0);
    rx += r._w + (i < roots.length - 1 ? HG * 3 : 0);
  });

  const nodes = [], edges = [];
  function collect(n) {
    nodes.push(n);
    n._children.forEach(c => { edges.push([n, c]); collect(c); });
  }
  roots.forEach(collect);

  const totalW = roots.reduce((s, r, i) => s + r._w + (i < roots.length - 1 ? HG * 3 : 0), 0);
  const totalH = nodes.reduce((m, n) => Math.max(m, n._y + NH), 0);

  return { nodes, edges, totalW: Math.max(totalW, 600), totalH };
}

// ─── SVG text wrap helper (pure SVG, no foreignObject) ───────────────────────
function SvgText({ x, y, text, maxW, fontSize, fontWeight, fill, lineHeight = 14, maxLines = 2 }) {
  // Approximate char width
  const charW   = fontSize * 0.55;
  const maxChar = Math.floor(maxW / charW);
  const words   = (text || '').split(' ');
  const lines   = [];
  let cur = '';

  words.forEach(w => {
    const test = cur ? cur + ' ' + w : w;
    if (test.length > maxChar && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  });
  if (cur) lines.push(cur);

  const display = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    display[maxLines - 1] = display[maxLines - 1].slice(0, -3) + '…';
  }

  const startY = y - ((display.length - 1) * lineHeight) / 2;

  return (
    <>
      {display.map((line, i) => (
        <text key={i} x={x} y={startY + i * lineHeight}
          textAnchor="middle" fontSize={fontSize}
          fontWeight={fontWeight} fill={fill}
          fontFamily="'Segoe UI', system-ui, sans-serif">
          {line}
        </text>
      ))}
    </>
  );
}

// ─── Single node SVG group ────────────────────────────────────────────────────
function OrgNode({ node, isSelected, onClick, userMap }) {
  const cc    = catColor(node.category_name);
  const st    = getStatus(node.status);
  const owner = userMap[+node.created_by];
  const ownerName = owner ? (owner.fullName || owner.full_name || '') : '';
  const ownerInitials = initials(ownerName);
  const ownerRole = owner?.role || '';
  const roleAbbr = ownerRole.split(' ').map(w => w[0]).join('');

  const cardFill   = isSelected ? cc : '#1e293b';
  const cardStroke = isSelected ? cc : '#334155';
  const textMain   = '#f1f5f9';
  const textDim    = isSelected ? 'rgba(255,255,255,0.7)' : '#94a3b8';

  return (
    <g transform={`translate(${node._x},${node._y})`}
      onClick={onClick} style={{ cursor: 'pointer' }}>

      {/* Glow when selected */}
      {isSelected && (
        <rect x={-4} y={-4} width={NW + 8} height={NH + 8}
          rx={16} fill="none" stroke={cc} strokeWidth={2} opacity={0.3} />
      )}

      {/* Card body */}
      <rect x={0} y={0} width={NW} height={NH} rx={12}
        fill={cardFill} stroke={cardStroke} strokeWidth={1.5}
        style={{ filter: isSelected ? `drop-shadow(0 0 12px ${cc}66)` : 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}
      />

      {/* Top colour bar */}
      <rect x={0} y={0} width={NW} height={6} rx={12} fill={cc} />
      <rect x={0} y={3} width={NW} height={3} fill={cc} />

      {/* Category label */}
      <text x={NW / 2} y={20} textAnchor="middle"
        fontSize={9} fontWeight={700} fill={isSelected ? 'rgba(255,255,255,0.75)' : cc}
        fontFamily="'Segoe UI', system-ui, sans-serif"
        style={{ textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {(node.category_name || 'Uncategorized').toUpperCase()}
      </text>

      {/* Process name — wrapped, 2 lines max */}
      <SvgText
        x={NW / 2} y={43}
        text={node.name}
        maxW={NW - 20}
        fontSize={13} fontWeight={700}
        fill={textMain}
        lineHeight={15}
        maxLines={2}
      />

      {/* Divider */}
      <line x1={14} y1={66} x2={NW - 14} y2={66}
        stroke={isSelected ? 'rgba(255,255,255,0.15)' : '#334155'} strokeWidth={1} />

      {/* Owner circle */}
      <circle cx={20} cy={82} r={9}
        fill={isSelected ? 'rgba(255,255,255,0.2)' : cc + '33'}
        stroke={isSelected ? 'rgba(255,255,255,0.4)' : cc} strokeWidth={1.2}
      />
      <text x={20} y={86} textAnchor="middle"
        fontSize={7.5} fontWeight={800}
        fill={isSelected ? '#fff' : cc}
        fontFamily="'Segoe UI', system-ui, sans-serif">
        {ownerInitials}
      </text>

      {/* Owner name + abbr */}
      <text x={36} y={79} fontSize={9} fontWeight={600} fill={textMain}
        fontFamily="'Segoe UI', system-ui, sans-serif">
        {ownerName.split(' ')[0] || '—'}
      </text>
      <text x={36} y={91} fontSize={8} fill={textDim}
        fontFamily="'Segoe UI', system-ui, sans-serif">
        {roleAbbr || '—'}
      </text>

      {/* Status badge */}
      <rect x={NW - 68} y={72} width={62} height={16} rx={8}
        fill={isSelected ? 'rgba(255,255,255,0.15)' : st.fill}
        stroke={isSelected ? 'rgba(255,255,255,0.25)' : st.stroke} strokeWidth={1}
      />
      <text x={NW - 37} y={83} textAnchor="middle"
        fontSize={8.5} fontWeight={700}
        fill={isSelected ? '#fff' : st.text}
        fontFamily="'Segoe UI', system-ui, sans-serif">
        {st.label}
      </text>

      {/* Children badge */}
      {node._children.length > 0 && (
        <>
          <circle cx={NW - 10} cy={10} r={9} fill={cc} stroke="#0f172a" strokeWidth={1.5} />
          <text x={NW - 10} y={14} textAnchor="middle"
            fontSize={8} fontWeight={800} fill="#fff"
            fontFamily="'Segoe UI', system-ui, sans-serif">
            {node._children.length}
          </text>
        </>
      )}
    </g>
  );
}

// ─── Full SVG canvas ──────────────────────────────────────────────────────────
function OrgCanvas({ processes, userMap, selectedId, onSelect }) {
  const { nodes, edges, totalW, totalH } = buildTree(processes);
  const PAD = 30;
  const svgW = totalW + PAD * 2;
  const svgH = totalH + PAD * 2;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxWidth: '100%' }}>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: 'block', minWidth: svgW }}
      >
        <g transform={`translate(${PAD},${PAD})`}>
          {/* Edges first (behind nodes) */}
          {edges.map(([from, to], i) => {
            const x1 = from._x + NW / 2;
            const y1 = from._y + NH;
            const x2 = to._x   + NW / 2;
            const y2 = to._y;
            const my = (y1 + y2) / 2;
            return (
              <path key={i}
                d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                fill="none" stroke="#334155" strokeWidth={2}
                strokeDasharray={from.status === 'archived' ? '6 3' : undefined}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map(node => (
            <OrgNode key={node.id}
              node={node}
              isSelected={selectedId === node.id}
              onClick={() => onSelect(node)}
              userMap={userMap}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

// ─── Process detail drawer ────────────────────────────────────────────────────
function ProcessDrawer({ process, userMap, allProcesses, onClose, onNavigate }) {
  if (!process) return null;
  const cc     = catColor(process.category_name);
  const st     = getStatus(process.status);
  const owner  = userMap[+process.created_by];
  const parent = process.parent_id != null
    ? allProcesses.find(p => +p.id === +process.parent_id)
    : null;
  const children = allProcesses.filter(p => +p.parent_id === +process.id);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 1040, backdropFilter: 'blur(3px)',
      }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
        background: '#0f172a', borderLeft: '1px solid #1e293b',
        zIndex: 1050, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        animation: 'drawerIn .22s cubic-bezier(.22,.68,0,1.1)',
      }}>
        {/* Header */}
        <div style={{ background: cc, padding: '20px 24px 16px', color: '#fff', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.8,
                textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
                {process.category_name || 'Uncategorized'}
              </div>
              <h4 style={{ margin: 0, fontWeight: 800, fontSize: 18, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {process.name}
              </h4>
              <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)' }}>
                  {st.label}
                </span>
                <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11,
                  background: 'rgba(255,255,255,0.15)', fontFamily: 'monospace' }}>
                  v{process.version || 1}
                </span>
              </div>
            </div>
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)',
              color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, outline: 'none', marginLeft: 12,
            }}>✕</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {process.description && (
            <Section title="Description">
              <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, margin: 0 }}>
                {process.description}
              </p>
            </Section>
          )}

          {owner && (
            <Section title="Process Owner">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', background: '#1e293b', borderRadius: 10,
                border: '1px solid #334155' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: cc,
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                  {initials(owner.fullName || owner.full_name || '')}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>
                    {owner.fullName || owner.full_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{owner.email}</div>
                  <div style={{ fontSize: 11, color: cc, fontWeight: 600, marginTop: 2 }}>{owner.role}</div>
                </div>
              </div>
            </Section>
          )}

          <Section title="Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { k: 'Status',  v: st.label,                     c: st.text,  bg: st.fill,    border: st.stroke  },
                { k: 'Version', v: `v${process.version || 1}`,   c: '#94a3b8', bg: '#1e293b', border: '#334155'  },
                { k: 'Created', v: process.created_at ? new Date(process.created_at).toLocaleDateString() : '—', c: '#94a3b8', bg: '#1e293b', border: '#334155' },
                { k: 'Updated', v: process.updated_at ? new Date(process.updated_at).toLocaleDateString() : '—', c: '#94a3b8', bg: '#1e293b', border: '#334155' },
              ].map(m => (
                <div key={m.k} style={{ padding: '10px 12px', borderRadius: 9,
                  background: m.bg, border: `1px solid ${m.border}` }}>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{m.k}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: m.c }}>{m.v}</div>
                </div>
              ))}
            </div>
          </Section>

          {parent && (
            <Section title="Parent Process">
              <NavCard process={parent} cc={catColor(parent.category_name)} onClick={() => onNavigate(parent)} />
            </Section>
          )}

          {children.length > 0 && (
            <Section title={`Sub-Processes (${children.length})`}>
              {children.map(c => (
                <NavCard key={c.id} process={c} cc={catColor(c.category_name)} onClick={() => onNavigate(c)} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function NavCard({ process, cc, onClick }) {
  const [hov, setHov] = useState(false);
  const st = getStatus(process.status);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
        background: hov ? '#1e293b' : '#0f172a',
        border: `1px solid ${hov ? cc : '#1e293b'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        transition: 'all .15s', marginBottom: 6,
      }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{process.name}</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{process.category_name || '—'}</div>
      </div>
      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600,
        background: st.fill, color: st.text, border: `1px solid ${st.stroke}`, flexShrink: 0 }}>
        {st.label}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function OrgChart() {
  const { getAllUsers } = useAuth();

  const [users,     setUsers]     = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [selected,  setSelected]  = useState(null);
  const [search,    setSearch]    = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [zoom,      setZoom]      = useState(0.85);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [userList, procRes] = await Promise.all([
        getAllUsers(),
        fetch(`${API}/processes`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      ]);
      const procList = Array.isArray(procRes) ? procRes : (procRes.processes || []);
      setUsers(Array.isArray(userList) ? userList : []);
      setProcesses(procList);
      setLastFetch(new Date());
    } catch (e) {
      console.error(e);
      setError('Could not reach the server on port 3001. Is the backend running?');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [getAllUsers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const userMap = {};
  users.forEach(u => { userMap[+u.id] = u; });

  const cats = ['all', ...new Set(processes.map(p => p.category_name).filter(Boolean).sort())];

  const filtered = processes.filter(p => {
    const ok1 = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const ok2 = catFilter === 'all' || p.category_name === catFilter;
    return ok1 && ok2;
  });

  return (
    <div style={{
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      background: '#0f172a', minHeight: '100vh', color: '#e2e8f0',
    }}>
      <style>{`
        @keyframes drawerIn {
          from { transform: translateX(50px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.3) !important; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        padding: '14px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(135deg,#dc2626,#b91c1c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, boxShadow: '0 2px 12px rgba(220,38,38,0.4)',
          }}>
            <i className="bi bi-diagram-3-fill" style={{ color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>Process Organigram</div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
              {processes.length} processes · {users.length} members
              {lastFetch && ` · updated ${lastFetch.toLocaleTimeString()}`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <i className="bi bi-search" style={{
              position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
              color: '#475569', fontSize: 12, pointerEvents: 'none',
            }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search processes…"
              style={{
                paddingLeft: 28, paddingRight: 10, height: 34, width: 190,
                background: '#1e293b', border: '1px solid #334155',
                borderRadius: 8, color: '#e2e8f0', fontSize: 12, outline: 'none',
              }}
            />
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            background: '#1e293b', border: '1px solid #334155',
            borderRadius: 8, padding: '0 8px', height: 34,
          }}>
            <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.1).toFixed(1)))}
              style={{ background: 'none', border: 'none', color: '#64748b',
                cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '0 2px', fontWeight: 700 }}>−</button>
            <span style={{ fontSize: 11, color: '#475569', minWidth: 34, textAlign: 'center',
              fontFamily: 'monospace', fontWeight: 600 }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))}
              style={{ background: 'none', border: 'none', color: '#64748b',
                cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '0 2px', fontWeight: 700 }}>+</button>
          </div>

          <button onClick={() => fetchData()} style={{
            height: 34, padding: '0 12px', borderRadius: 8,
            border: '1px solid #334155', background: '#1e293b',
            color: '#64748b', cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 6, outline: 'none',
          }}>
            <i className="bi bi-arrow-clockwise" />Refresh
          </button>
        </div>
      </div>

      {/* Category chips */}
      <div style={{
        padding: '10px 24px', background: '#0b1120',
        borderBottom: '1px solid #1e293b',
        display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#475569',
          textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 4 }}>Category:</span>
        {cats.map(c => {
          const on = catFilter === c;
          const cc2 = c === 'all' ? '#dc2626' : catColor(c);
          return (
            <button key={c} onClick={() => setCatFilter(c)} style={{
              padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              border: `1.5px solid ${on ? cc2 : '#1e293b'}`,
              background: on ? cc2 : '#1e293b',
              color: on ? '#fff' : '#475569',
              cursor: 'pointer', outline: 'none', transition: 'all .12s',
            }}>{c === 'all' ? 'All' : c}</button>
          );
        })}
      </div>

      {/* Canvas */}
      <div style={{
        padding: '32px 24px 80px',
        minHeight: 'calc(100vh - 130px)',
        background: `radial-gradient(circle at 20px 20px, rgba(255,255,255,0.015) 1px, transparent 1px)`,
        backgroundSize: '28px 28px',
      }}>

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 400, gap: 14, color: '#475569' }}>
            <div style={{ width: 36, height: 36, border: '3px solid #1e293b',
              borderTopColor: '#dc2626', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            Loading organigram…
          </div>
        )}

        {error && (
          <div style={{ maxWidth: 420, margin: '60px auto', padding: '24px',
            background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
            borderRadius: 14, textAlign: 'center' }}>
            <i className="bi bi-exclamation-triangle-fill"
              style={{ fontSize: 28, color: '#fca5a5', display: 'block', marginBottom: 10 }} />
            <div style={{ fontWeight: 700, color: '#fca5a5', marginBottom: 6 }}>Failed to load</div>
            <div style={{ fontSize: 13, color: '#475569' }}>{error}</div>
            <button onClick={() => fetchData()} style={{
              marginTop: 16, padding: '8px 20px', borderRadius: 8,
              background: '#dc2626', border: 'none', color: '#fff',
              cursor: 'pointer', fontWeight: 600, fontSize: 13,
            }}>Try Again</button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 400, gap: 12, color: '#334155' }}>
            <i className="bi bi-diagram-3" style={{ fontSize: 56 }} />
            <div style={{ fontWeight: 600, fontSize: 16, color: '#475569' }}>
              {search || catFilter !== 'all'
                ? 'No processes match your filters'
                : 'No processes yet — create some in Process Management'}
            </div>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

            {/* Company root node */}
            <div style={{
              background: 'linear-gradient(135deg,#dc2626,#b91c1c)',
              color: '#fff', padding: '11px 30px', borderRadius: 12,
              fontWeight: 800, fontSize: 15,
              boxShadow: '0 4px 24px rgba(220,38,38,0.45)',
              display: 'inline-flex', alignItems: 'center', gap: 9,
              marginBottom: 0,
            }}>
              <i className="bi bi-building" style={{ fontSize: 17 }} />
              Company Organisation
            </div>

            {/* Stem */}
            <div style={{ width: 2, height: 28, background: '#334155' }} />

            {/* Zoomed tree */}
            <div style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              transition: 'transform 0.2s ease',
              width: '100%',
            }}>
              <OrgCanvas
                processes={filtered}
                userMap={userMap}
                selectedId={selected?.id}
                onSelect={node => setSelected(s => s?.id === node.id ? null : node)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Drawer */}
      {selected && (
        <ProcessDrawer
          process={selected}
          userMap={userMap}
          allProcesses={processes}
          onClose={() => setSelected(null)}
          onNavigate={node => setSelected(node)}
        />
      )}
    </div>
  );
}

export default OrgChart;