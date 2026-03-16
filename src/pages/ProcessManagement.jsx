import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  Container, Row, Col, Button, Modal, Form, Alert, Badge,
  FormControl, Table, Dropdown, InputGroup
} from 'react-bootstrap';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileText, Plus, Minus, Search, List, GitBranch, Edit2, Trash2, Download, Upload, MoreHorizontal } from 'lucide-react';

/* ─── Inline styles / design tokens ──────────────────────────────────────── */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

  :root {
    --vbpm-red:       #dc2626;
    --vbpm-red-dark:  #991b1b;
    --vbpm-red-light: #fef2f2;
    --vbpm-black:     #000000;
    --vbpm-gray-50:   #f9fafb;
    --vbpm-gray-100:  #f3f4f6;
    --vbpm-gray-200:  #e5e7eb;
    --vbpm-gray-300:  #d1d5db;
    --vbpm-gray-400:  #9ca3af;
    --vbpm-gray-500:  #6b7280;
    --vbpm-gray-600:  #4b5563;
    --vbpm-gray-700:  #374151;
    --vbpm-gray-800:  #1f2937;
    --vbpm-gray-900:  #111827;
    --vbpm-border:    var(--vbpm-gray-300);
    --vbpm-text:      var(--vbpm-gray-900);
    --vbpm-muted:     var(--vbpm-gray-500);
    --vbpm-row-h:     var(--vbpm-gray-50);
    --sidebar-w:      72px;
    --toolbar-h:      52px;
    font-family: 'DM Sans', sans-serif;
  }

  /* ── Layout ── */
  .pm-shell          { display:flex; height:100vh; overflow:hidden; background:var(--vbpm-gray-50); }
  .pm-sidebar        { width:var(--sidebar-w); background:var(--vbpm-gray-900); display:flex; flex-direction:column; align-items:center; padding:0; flex-shrink:0; }
  .pm-sidebar-logo   { width:100%; padding:12px 0; background:var(--vbpm-red); display:flex; align-items:center; justify-content:center; }
  .pm-sidebar-logo span { color:#fff; font-size:11px; font-weight:700; letter-spacing:.04em; text-align:center; line-height:1.3; padding:0 6px; }
  .pm-sidebar-item   { width:100%; display:flex; flex-direction:column; align-items:center; padding:14px 4px 10px; cursor:pointer; gap:5px; color:var(--vbpm-gray-400); transition:all .15s; border-left:3px solid transparent; }
  .pm-sidebar-item:hover { color:#fff; background:rgba(255,255,255,.05); }
  .pm-sidebar-item.active { color:#fff; border-left-color:var(--vbpm-red); background:rgba(220,38,38,.1); }
  .pm-sidebar-item span  { font-size:9.5px; text-align:center; line-height:1.2; }

  /* ── Main area ── */
  .pm-main           { flex:1; display:flex; flex-direction:column; overflow:hidden; }

  /* ── Top toolbar ── */
  .pm-toolbar        { height:var(--toolbar-h); background:var(--vbpm-red); display:flex; align-items:center; padding:0 20px; gap:16px; flex-shrink:0; }
  .pm-toolbar h1     { color:#fff; font-size:15px; font-weight:600; margin:0; }
  .pm-toolbar-search { margin-left:auto; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.2); border-radius:4px; display:flex; align-items:center; padding:0 10px; gap:8px; }
  .pm-toolbar-search input { background:transparent; border:none; outline:none; color:#fff; font-size:13px; width:220px; }
  .pm-toolbar-search input::placeholder { color:rgba(255,255,255,.7); }
  .pm-toolbar-search svg { color:rgba(255,255,255,.8); }

  /* ── Secondary toolbar ── */
  .pm-bar            { background:#fff; border-bottom:1px solid var(--vbpm-border); padding:8px 20px; display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .pm-view-tab       { padding:5px 16px; border-radius:4px; border:1px solid var(--vbpm-border); font-size:13px; cursor:pointer; background:#fff; color:var(--vbpm-muted); font-weight:500; display:flex; align-items:center; gap:6px; transition:all .15s; }
  .pm-view-tab:hover { background:var(--vbpm-gray-50); }
  .pm-view-tab.active { background:var(--vbpm-red); color:#fff; border-color:var(--vbpm-red); }
  .pm-icon-btn       { width:30px; height:30px; border-radius:4px; border:1px solid var(--vbpm-border); background:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--vbpm-muted); transition:all .15s; }
  .pm-icon-btn:hover { background:var(--vbpm-gray-50); color:var(--vbpm-gray-700); }
  .pm-bar-right      { margin-left:auto; display:flex; align-items:center; gap:8px; }
  .pm-search-bar     { border:1px solid var(--vbpm-border); border-radius:4px; display:flex; align-items:center; padding:0 10px; gap:6px; height:30px; }
  .pm-search-bar input { border:none; outline:none; font-size:13px; color:var(--vbpm-text); width:180px; }

  /* ── Content ── */
  .pm-content        { flex:1; overflow-y:auto; background:#fff; }

  /* ── Tree ── */
  .pm-tree           { padding:0; }
  .pm-node           { border-bottom:1px solid var(--vbpm-border); }
  .pm-node-row       { display:flex; align-items:center; min-height:40px; padding:0 16px; gap:0; cursor:pointer; transition:background .1s; user-select:none; }
  .pm-node-row:hover { background:var(--vbpm-row-h); }
  .pm-node-row.selected { background:var(--vbpm-red-light); }

  .pm-indent         { display:flex; align-items:stretch; flex-shrink:0; }
  .pm-indent-line    { width:24px; display:flex; align-items:center; justify-content:center; position:relative; }
  .pm-indent-line::before { content:''; position:absolute; left:50%; top:0; bottom:0; width:1px; background:var(--vbpm-border); }

  .pm-toggle         { width:20px; height:20px; border:1px solid var(--vbpm-border); border-radius:3px; background:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-right:8px; color:var(--vbpm-red); cursor:pointer; }
  .pm-toggle:hover   { background:var(--vbpm-red-light); }
  .pm-toggle.leaf    { opacity:0; pointer-events:none; }

  .pm-node-icon      { margin-right:8px; flex-shrink:0; }
  .pm-node-icon.folder   { color:var(--vbpm-gray-600); }
  .pm-node-icon.process  { color:var(--vbpm-red); }

  .pm-node-label     { flex:1; font-size:13.5px; color:var(--vbpm-text); }
  .pm-node-label.category { font-weight:600; color:var(--vbpm-gray-700); }

  .pm-node-actions   { display:none; align-items:center; gap:4px; margin-left:8px; }
  .pm-node-row:hover .pm-node-actions { display:flex; }
  .pm-action-btn     { width:26px; height:26px; border-radius:3px; border:1px solid var(--vbpm-border); background:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--vbpm-muted); transition:all .1s; }
  .pm-action-btn:hover { background:var(--vbpm-red); color:#fff; border-color:var(--vbpm-red); }
  .pm-action-btn.danger:hover { background:var(--vbpm-gray-800); border-color:var(--vbpm-gray-800); }

  .pm-add-btn        { width:22px; height:22px; border-radius:3px; border:1px solid var(--vbpm-red); background:transparent; cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--vbpm-red); margin-left:12px; opacity:0; transition:opacity .1s; }
  .pm-node-row:hover .pm-add-btn { opacity:1; }
  .pm-add-btn:hover  { background:var(--vbpm-red); color:#fff; }

  /* ── Status badges ── */
  .pm-status { font-size:10.5px; font-weight:600; padding:2px 8px; border-radius:10px; font-family:'DM Mono', monospace; letter-spacing:.03em; margin-right:8px; }
  .pm-status.draft    { background:var(--vbpm-gray-100); color:var(--vbpm-gray-600); }
  .pm-status.active   { background:var(--vbpm-red-light); color:var(--vbpm-red-dark); }
  .pm-status.archived { background:var(--vbpm-gray-800); color:#fff; }

  /* ── Table view ── */
  .pm-table          { width:100%; border-collapse:collapse; font-size:13.5px; }
  .pm-table th       { background:var(--vbpm-gray-50); padding:10px 16px; text-align:left; font-weight:600; font-size:12px; color:var(--vbpm-gray-700); text-transform:uppercase; letter-spacing:.05em; border-bottom:2px solid var(--vbpm-border); position:sticky; top:0; z-index:1; }
  .pm-table td       { padding:10px 16px; border-bottom:1px solid var(--vbpm-border); color:var(--vbpm-text); vertical-align:middle; }
  .pm-table tr:hover td { background:var(--vbpm-row-h); }

  /* ── Empty ── */
  .pm-empty          { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:80px 20px; color:var(--vbpm-muted); gap:12px; }
  .pm-empty svg      { opacity:.3; }
  .pm-empty p        { font-size:14px; }

  /* ── Modal tweaks ── */
  .pm-modal .modal-header { background:var(--vbpm-red); color:#fff; }
  .pm-modal .modal-header .btn-close { filter:invert(1); }
  .pm-modal .modal-title { font-size:15px; font-weight:600; }

  /* ── Btn primary override ── */
  .btn-vbpm { background:var(--vbpm-red); border-color:var(--vbpm-red); color:#fff; font-size:13px; font-weight:500; }
  .btn-vbpm:hover { background:var(--vbpm-red-dark); border-color:var(--vbpm-red-dark); color:#fff; }
  .btn-outline-vbpm { border-color:var(--vbpm-red); color:var(--vbpm-red); font-size:13px; background:#fff; }
  .btn-outline-vbpm:hover { background:var(--vbpm-red-light); }

  /* scrollbar */
  .pm-content::-webkit-scrollbar { width:6px; }
  .pm-content::-webkit-scrollbar-track { background:transparent; }
  .pm-content::-webkit-scrollbar-thumb { background:var(--vbpm-gray-300); border-radius:3px; }
`;

/* ─── Sample data matching the HOPEX screenshot ──────────────────────────── */
const SAMPLE_DATA = [
  {
    id: 'cat-root', type: 'root', label: 'Catégories de processus', children: [
      {
        id: 'cat-1', type: 'category', label: 'Administration de la Sécurité Informatique', status: 'active', children: [
          { id: 'p-1', type: 'process', label: 'Gérer les Habilitations', status: 'active', company: 'IT Dept', version: 2 },
          { id: 'p-2', type: 'process', label: 'Gérer les Patchs', status: 'active', company: 'IT Dept', version: 1 },
        ]
      },
      { id: 'cat-2', type: 'category', label: 'Analyse Interne et Externe (Veille Concurrentielle)', status: 'draft', children: [] },
      {
        id: 'cat-3', type: 'category', label: "Assistance à la Maitrise d'Ouvrage des Projets", status: 'active', children: [
          { id: 'p-3', type: 'process', label: "Assister à la Maitrise d'Ouvrage des Projets (Dans le Cadre des Projets de Construction/ Aménagement)", status: 'active', company: 'PMO', version: 3 },
          { id: 'p-4', type: 'process', label: "Assister à la Maitrise d'Ouvrage des Projets (Hors Projets de Construction /Aménagement)", status: 'active', company: 'PMO', version: 2 },
        ]
      },
      { id: 'cat-4', type: 'category', label: 'Catégorie de processus-1', status: 'draft', children: [] },
      { id: 'cat-5', type: 'category', label: 'City Energy management (EN)', status: 'active', children: [] },
      { id: 'cat-6', type: 'category', label: 'City equipment management (EN)', status: 'active', children: [] },
    ]
  }
];

/* ─── Flatten tree for table view ─────────────────────────────────────────── */
function flattenTree(nodes, result = []) {
  for (const n of nodes) {
    result.push(n);
    if (n.children) flattenTree(n.children, result);
  }
  return result;
}

/* ─── Recursive tree node ─────────────────────────────────────────────────── */
function TreeNode({ node, depth = 0, expanded, onToggle, onEdit, onDelete, onAddChild, selected, onSelect }) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isRoot = node.type === 'root';

  return (
    <div className="pm-node">
      <div
        className={`pm-node-row ${selected === node.id ? 'selected' : ''}`}
        onClick={() => onSelect(node.id)}
      >
        {/* Indent lines */}
        <div className="pm-indent">
          {Array.from({ length: depth }).map((_, i) => (
            <div key={i} className="pm-indent-line" />
          ))}
        </div>

        {/* Expand/collapse toggle */}
        <div
          className={`pm-toggle ${!hasChildren && !isRoot ? 'leaf' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
        >
          {isExpanded ? <Minus size={10} /> : <Plus size={10} />}
        </div>

        {/* Icon */}
        <span className="pm-node-icon folder">
          {node.type === 'process'
            ? <FileText size={15} color="#4a90c4" />
            : isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />
          }
        </span>

        {/* Label */}
        <span className={`pm-node-label ${node.type !== 'process' ? 'category' : ''}`}>
          {node.label}
        </span>

        {/* Status for processes */}
        {node.type === 'process' && node.status && (
          <span className={`pm-status ${node.status}`}>{node.status}</span>
        )}

        {/* Add child button (categories only) */}
        {node.type !== 'process' && (
          <button
            className="pm-add-btn"
            title="Add process"
            onClick={(e) => { e.stopPropagation(); onAddChild(node); }}
          >
            <Plus size={12} />
          </button>
        )}

        {/* Action buttons */}
        {node.type !== 'root' && (
          <div className="pm-node-actions">
            <button className="pm-action-btn" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(node); }}>
              <Edit2 size={12} />
            </button>
            <button className="pm-action-btn danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}>
              <Trash2 size={12} />
            </button>
            {node.type === 'process' && (
              <button className="pm-action-btn" title="Export" onClick={() => handleExport(node.id)}>
                <Download size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export function ProcessManagement() {
  const { hasPermission, company } = useAuth();
  const canManage = hasPermission('manage_processes');

  const [treeData, setTreeData] = useState([{ id: 'cat-root', type: 'root', label: 'Catégories de processus', children: [] }]);
  const [viewMode, setViewMode] = useState('hierarchy');
  const [expanded, setExpanded] = useState(new Set(['cat-root']));
  const [selected, setSelected] = useState(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [message, setMessage] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [parentNode, setParentNode] = useState(null);
  const [formData, setFormData] = useState({ label: '', description: '', status: 'draft', type: 'process' });
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [companies, setCompanies] = useState([]);

  // Load data from backend
  const loadData = useCallback(async () => {
    if (!canManage) return;
    
    setLoading(true);
    try {
      // Load categories, processes, and companies
      const [categoriesRes, processesRes, companiesRes] = await Promise.all([
        fetch('http://localhost:3001/api/process-categories'),
        fetch('http://localhost:3001/api/processes?hierarchical=true'),
        fetch('http://localhost:3001/api/companies')
      ]);

      if (categoriesRes.ok && processesRes.ok && companiesRes.ok) {
        const categories = await categoriesRes.json();
        const processes = await processesRes.json();
        const companies = await companiesRes.json();

        setCategories(categories);
        setCompanies(companies);

        // Build tree structure
        const tree = {
          id: 'cat-root',
          type: 'root',
          label: 'Catégories de processus',
          children: categories.map(cat => ({
            id: `cat-${cat.id}`,
            type: 'category',
            label: cat.name,
            status: cat.status || 'active',
            children: (processes.filter(p => p.category_id == cat.id) || []).map(process => ({
              id: `proc-${process.id}`,
              type: 'process',
              label: process.name,
              description: process.description,
              status: process.status || 'draft',
              company: process.company_name || 'Unknown',
              version: process.version || 1,
              category_id: process.category_id,
              company_id: process.company_id
            }))
          }))
        };

        setTreeData([tree]);
      } else {
        setMessage('Failed to load data');
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setMessage('Network error');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* Toggle expand/collapse */
  const toggleNode = useCallback((id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /* Expand / collapse all */
  const expandAll = () => {
    const ids = new Set();
    flattenTree(treeData).forEach(n => ids.add(n.id));
    setExpanded(ids);
  };
  const collapseAll = () => setExpanded(new Set());

  /* Find & update node in tree */
  const updateTree = (nodes, id, updater) =>
    nodes.map(n => {
      if (n.id === id) return updater(n);
      if (n.children) return { ...n, children: updateTree(n.children, id, updater) };
      return n;
    });

  const deleteFromTree = (nodes, id) =>
    nodes
      .filter(n => n.id !== id)
      .map(n => n.children ? { ...n, children: deleteFromTree(n.children, id) } : n);

  /* CRUD operations */
  const handleEdit = (node) => {
    setEditingNode(node);
    setFormData({ 
      label: node.label, 
      description: node.description || '', 
      status: node.status || 'draft', 
      type: node.type,
      category_id: node.category_id,
      company_id: node.company_id
    });
    setShowModal(true);
  };

  const handleAddChild = (parent) => {
    setEditingNode(null);
    setParentNode(parent);
    setFormData({ 
      label: '', 
      description: '', 
      status: 'draft', 
      type: parent.type === 'root' ? 'category' : 'process',
      category_id: parent.type === 'category' ? parent.id.replace('cat-', '') : undefined,
      company_id: company?.id
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this item and all its children?')) return;
    
    try {
      const isProcess = id.startsWith('proc-');
      const actualId = id.replace('proc-', '').replace('cat-', '');
      const url = `http://localhost:3001/api/${isProcess ? 'processes' : 'process-categories'}/${actualId}`;
      
      const response = await fetch(url, { method: 'DELETE' });
      
      if (response.ok) {
        setMessage('Deleted successfully');
        loadData(); // Reload data
      } else {
        const error = await response.json();
        setMessage(error.error || 'Failed to delete');
      }
    } catch (error) {
      console.error('Error deleting:', error);
      setMessage('Network error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.label.trim()) { 
      setMessage('Name is required'); 
      return; 
    }

    try {
      let response;
      
      if (editingNode) {
        // Update existing item
        const isProcess = editingNode.id.startsWith('proc-');
        const actualId = editingNode.id.replace('proc-', '').replace('cat-', '');
        const url = `http://localhost:3001/api/${isProcess ? 'processes' : 'process-categories'}/${actualId}`;
        
        const payload = isProcess ? {
          name: formData.label,
          description: formData.description,
          status: formData.status,
          category_id: formData.category_id,
          company_id: formData.company_id
        } : {
          name: formData.label,
          description: formData.description,
          status: formData.status
        };
        
        response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Create new item
        const isProcess = formData.type === 'process';
        const url = `http://localhost:3001/api/${isProcess ? 'processes' : 'process-categories'}`;
        
        const payload = isProcess ? {
          name: formData.label,
          description: formData.description,
          status: formData.status,
          category_id: formData.category_id,
          company_id: formData.company_id || company?.id
        } : {
          name: formData.label,
          description: formData.description,
          status: formData.status
        };
        
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (response.ok) {
        setMessage(`${editingNode ? 'Updated' : 'Created'} successfully`);
        setShowModal(false);
        loadData(); // Reload data
        
        // Auto-expand parent if creating new item
        if (!editingNode && parentNode) {
          setExpanded(prev => new Set([...prev, parentNode.id]));
        }
      } else {
        const error = await response.json();
        setMessage(error.error || 'Failed to save');
      }
    } catch (error) {
      console.error('Error saving:', error);
      setMessage('Network error');
    }
  };

  const handleExport = async (nodeId) => {
    try {
      const actualId = nodeId.replace('proc-', '');
      const response = await fetch(`http://localhost:3001/api/processes/${actualId}/export`);
      
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `process-${actualId}.bpmn`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        setMessage('Process exported successfully');
      } else {
        setMessage('Failed to export process');
      }
    } catch (error) {
      console.error('Error exporting:', error);
      setMessage('Network error');
    }
  };

  /* Table flat list */
  const flatList = flattenTree(treeData)
    .filter(n => n.type === 'process')
    .filter(n => !tableSearch || n.label.toLowerCase().includes(tableSearch.toLowerCase()));

  if (!canManage) {
    return (
      <div style={{ padding: 32 }}>
        <Alert variant="danger">You don't have permission to manage processes.</Alert>
      </div>
    );
  }

  return (
    <>
      <style>{css}</style>
      <div className="pm-shell">

        {/* ── Sidebar ── */}
        <div className="pm-sidebar">
          <div className="pm-sidebar-logo">
            <span>v-bpm<br />Business<br />Process</span>
          </div>
          {[
            { icon: <GitBranch size={20} />, label: 'Processus', active: true },
            { icon: <FileText size={20} />, label: 'Parcours' },
            { icon: <List size={20} />, label: 'Contrôles' },
          ].map(({ icon, label, active }) => (
            <div key={label} className={`pm-sidebar-item ${active ? 'active' : ''}`}>
              {icon}
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* ── Main ── */}
        <div className="pm-main">

          {/* Top toolbar */}
          <div className="pm-toolbar">
            <h1>Processus</h1>
            <div className="pm-toolbar-search">
              <Search size={14} />
              <input placeholder="Rechercher..." />
            </div>
          </div>

          {/* Secondary bar */}
          <div className="pm-bar">
            {/* Hierarchy / Liste tabs */}
            <button
              className={`pm-view-tab ${viewMode === 'hierarchy' ? 'active' : ''}`}
              onClick={() => setViewMode('hierarchy')}
            >
              <GitBranch size={13} /> Hiérarchie
            </button>
            <button
              className={`pm-view-tab ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              <List size={13} /> Liste
            </button>

            {viewMode === 'hierarchy' && (
              <>
                <button className="pm-icon-btn" title="Collapse all" onClick={collapseAll}><Minus size={13} /></button>
                <button className="pm-icon-btn" title="Expand all" onClick={expandAll}><Plus size={13} /></button>
              </>
            )}

            <div className="pm-bar-right">
              {message && (
                <span style={{ fontSize: 12, color: message.includes('success') || message.includes('success') ? 'var(--vbpm-red-dark)' : 'var(--vbpm-red)' }}>
                  {message}
                </span>
              )}
              <button
                className="pm-icon-btn"
                title="Import BPMN"
                style={{ width: 'auto', padding: '0 10px', gap: 6, fontSize: 12, color: 'var(--vbpm-red)' }}
                onClick={() => {}}
              >
                <Upload size={13} /> Import
              </button>
              <button
                className="pm-icon-btn btn-vbpm"
                title="New category"
                style={{ width: 'auto', padding: '0 12px', gap: 6, fontSize: 13, background: 'var(--vbpm-red)', color: '#fff', border: 'none' }}
                onClick={() => handleAddChild(treeData[0])}
              >
                <Plus size={13} /> Nouveau
              </button>

              {viewMode === 'hierarchy' && (
                <div className="pm-search-bar">
                  <Search size={13} style={{ color: 'var(--vbpm-muted)' }} />
                  <input
                    placeholder="Rechercher..."
                    value={treeSearch}
                    onChange={e => setTreeSearch(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="pm-content">
            {loading ? (
              <div className="pm-empty">
                <div style={{ fontSize: 14 }}>Loading data...</div>
              </div>
            ) : viewMode === 'hierarchy' ? (
              <div className="pm-tree">
                {treeData.map(node => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggleNode}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onAddChild={handleAddChild}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            ) : (
              <div style={{ padding: '0 0 40px' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--vbpm-border)' }}>
                  <div className="pm-search-bar" style={{ display: 'inline-flex' }}>
                    <Search size={13} style={{ color: 'var(--vbpm-muted)' }} />
                    <input
                      placeholder="Filter processes..."
                      value={tableSearch}
                      onChange={e => setTableSearch(e.target.value)}
                      style={{ width: 260 }}
                    />
                  </div>
                </div>
                {flatList.length === 0 ? (
                  <div className="pm-empty">
                    <FileText size={48} />
                    <p>No processes found</p>
                  </div>
                ) : (
                  <table className="pm-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Company</th>
                        <th>Version</th>
                        <th style={{ width: 100 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatList.map(node => (
                        <tr key={node.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <FileText size={14} color="#4a90c4" />
                              {node.label}
                            </div>
                          </td>
                          <td><span className={`pm-status ${node.status || 'draft'}`}>{node.status || 'draft'}</span></td>
                          <td style={{ color: 'var(--hopex-muted)', fontSize: 13 }}>{node.company || '—'}</td>
                          <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>v{node.version || 1}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="pm-action-btn" onClick={() => handleEdit(node)}><Edit2 size={12} /></button>
                              <button className="pm-action-btn" title="Export" onClick={() => handleExport(node.id)}><Download size={12} /></button>
                              <button className="pm-action-btn danger" onClick={() => handleDelete(node.id)}><Trash2 size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      <Modal show={showModal} onHide={() => setShowModal(false)} className="pm-modal">
        <Modal.Header closeButton>
          <Modal.Title>{editingNode ? 'Edit' : 'Create'} {formData.type === 'category' ? 'Category' : 'Process'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message && !showModal && <Alert variant="danger">{message}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: 13, fontWeight: 500 }}>Name *</Form.Label>
              <Form.Control
                size="sm"
                value={formData.label}
                onChange={e => setFormData({ ...formData, label: e.target.value })}
                placeholder="Enter name"
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: 13, fontWeight: 500 }}>Description</Form.Label>
              <Form.Control
                as="textarea"
                size="sm"
                rows={3}
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
              />
            </Form.Group>
            {formData.type === 'process' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: 13, fontWeight: 500 }}>Category</Form.Label>
                  <Form.Select 
                    size="sm" 
                    value={formData.category_id || ''} 
                    onChange={e => setFormData({ ...formData, category_id: e.target.value })}
                  >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: 13, fontWeight: 500 }}>Company</Form.Label>
                  <Form.Select 
                    size="sm" 
                    value={formData.company_id || company?.id || ''} 
                    onChange={e => setFormData({ ...formData, company_id: e.target.value })}
                  >
                    <option value="">Select company</option>
                    {companies.map(comp => (
                      <option key={comp.id} value={comp.id}>{comp.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: 13, fontWeight: 500 }}>Status</Form.Label>
                  <Form.Select size="sm" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </Form.Select>
                </Form.Group>
              </>
            )}
            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button variant="outline-secondary" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" size="sm" className="btn-vbpm">{editingNode ? 'Update' : 'Create'}</Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </>
  );
}

export default ProcessManagement;