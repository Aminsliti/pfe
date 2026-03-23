import React, { useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import './BpmnEditorModeler.css';

const escapeXml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function buildFallbackXml(processName = 'Process') {
  const safeName = escapeXml(processName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="${safeName}" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
    <bpmn:endEvent id="EndEvent_1" name="End" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="312" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="312" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

const BpmnEditorModeler = ({ process, onClose, onSave }) => {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const mainContainerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [xml, setXml] = useState(process?.bpmn_xml || null);
  const [selectedElement, setSelectedElement] = useState(null);
  const [properties, setProperties] = useState({});
  const [saving, setSaving] = useState(false);
  const [navigationStack, setNavigationStack] = useState([]);
  const [currentSubprocess, setCurrentSubprocess] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredElements, setFilteredElements] = useState([]);

  // BPMN elements database
  const bpmnElements = [
    { id: 'bpmn:StartEvent', name: 'Start Event', category: 'Events', icon: '⭕' },
    { id: 'bpmn:EndEvent', name: 'End Event', category: 'Events', icon: '⭕' },
    { id: 'bpmn:IntermediateThrowEvent', name: 'Intermediate Event', category: 'Events', icon: '⭕' },
    { id: 'bpmn:UserTask', name: 'User Task', category: 'Tasks', icon: '👤' },
    { id: 'bpmn:ServiceTask', name: 'Service Task', category: 'Tasks', icon: '⚙️' },
    { id: 'bpmn:ScriptTask', name: 'Script Task', category: 'Tasks', icon: '📝' },
    { id: 'bpmn:ManualTask', name: 'Manual Task', category: 'Tasks', icon: '✋' },
    { id: 'bpmn:SendTask', name: 'Send Task', category: 'Tasks', icon: '📤' },
    { id: 'bpmn:ReceiveTask', name: 'Receive Task', category: 'Tasks', icon: '📥' },
    { id: 'bpmn:BusinessRuleTask', name: 'Business Rule Task', category: 'Tasks', icon: '📋' },
    { id: 'bpmn:ExclusiveGateway', name: 'Exclusive Gateway', category: 'Gateways', icon: '◇' },
    { id: 'bpmn:ParallelGateway', name: 'Parallel Gateway', category: 'Gateways', icon: '◈' },
    { id: 'bpmn:InclusiveGateway', name: 'Inclusive Gateway', category: 'Gateways', icon: '⬡' },
    { id: 'bpmn:SubProcess', name: 'Sub Process', category: 'Sub Processes', icon: '📦' },
    { id: 'bpmn:CallActivity', name: 'Call Activity', category: 'Sub Processes', icon: '🔄' },
    { id: 'bpmn:BoundaryEvent', name: 'Boundary Event', category: 'Events', icon: '⭕' },
  ];

  // Set XML from process
  useEffect(() => {
    if (process?.bpmn_xml) {
      setXml(process.bpmn_xml);
    }
  }, [process]);

  // Filter elements based on search
  useEffect(() => {
    if (!searchTerm) {
      setFilteredElements(bpmnElements);
    } else {
      const filtered = bpmnElements.filter(element => 
        element.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        element.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredElements(filtered);
    }
  }, [searchTerm]);

  // Group filtered elements by category
  const groupedElements = filteredElements.reduce((groups, element) => {
    if (!groups[element.category]) {
      groups[element.category] = [];
    }
    groups[element.category].push(element);
    return groups;
  }, {});

  // Initialize modeler
  useEffect(() => {
    if (!xml || !containerRef.current) return;

    let disposed = false;

    const initModeler = async () => {
      try {
        const modeler = new BpmnModeler({
          container: containerRef.current,
          palette: true
        });

        if (disposed) {
          modeler.destroy();
          return;
        }

        modelerRef.current = modeler;
        setError(null);
        setLoading(true);
        setSelectedElement(null);
        setProperties({});

        // Import XML
        try {
          await modeler.importXML(xml);
          console.log('✅ BPMN XML imported successfully');
        } catch (err) {
          console.error('❌ BPMN Import Error:', err);
          try {
            await modeler.importXML(buildFallbackXml(process?.name || 'Process'));
            setError('Warning: Using minimal BPMN template');
          } catch (fallbackErr) {
            console.error('âŒ BPMN fallback import error:', fallbackErr);
            try {
              await modeler.createDiagram();
              setError('Warning: Opened a blank BPMN diagram');
            } catch (createErr) {
              console.error('âŒ BPMN create diagram error:', createErr);
              setError('Failed to initialize BPMN editor');
              setLoading(false);
              return;
            }
          }
        }

        if (disposed) {
          modeler.destroy();
          return;
        }

        setLoading(false);
        const canvas = modeler.get('canvas');
        if (canvas) canvas.zoom('fit-viewport');

        // Listen for selection changes
        const eventBus = modeler.get('eventBus');
        eventBus.on('selection.changed', (event) => {
          const selection = event.newSelection;
          if (selection.length === 1) {
            const el = selection[0];
            setSelectedElement(el);
            setProperties({
              id: el.id,
              name: el.businessObject?.name || '',
              type: el.type,
              documentation: el.businessObject?.documentation?.[0]?.text || ''
            });

            // Handle sub-process navigation
            if (el.type === 'bpmn:SubProcess') {
              const subprocessId = el.id;
              const subprocessName = el.businessObject?.name || el.id;
              
              const currentLevel = currentSubprocess || { id: 'root', name: process?.name || 'Main Process' };
              setNavigationStack(prev => [...prev, currentLevel]);
              setCurrentSubprocess({ id: subprocessId, name: subprocessName });
              
              const canvas = modeler.get('canvas');
              if (canvas) canvas.zoom('fit-viewport', { element: el });
            }
          } else {
            setSelectedElement(null);
            setProperties({});
          }
        });

      } catch (initErr) {
        if (!disposed) {
          setError('Failed to initialize BPMN modeler: ' + initErr.message);
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(initModeler, 100);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (modelerRef.current) {
        modelerRef.current.destroy();
        modelerRef.current = null;
      }
    };
  }, [xml, process?.name]);

  const handlePropertyChange = (key, value) => {
    if (!selectedElement || !modelerRef.current) return;

    const modeling = modelerRef.current.get('modeling');
    
    if (key === 'name') {
      modeling.updateLabel(selectedElement, value);
    } else if (key === 'documentation') {
      const commandStack = modelerRef.current.get('commandStack');
      commandStack.execute('element.updateProperties', {
        element: selectedElement,
        properties: { documentation: [{ text: value }] }
      });
    }
    setProperties(prev => ({ ...prev, [key]: value }));
  };

  const navigateBack = () => {
    if (navigationStack.length === 0) return;
    
    const newStack = [...navigationStack];
    const previousLevel = newStack.pop();
    
    setNavigationStack(newStack);
    setCurrentSubprocess(previousLevel.id === 'root' ? null : previousLevel);
    
    const canvas = modelerRef.current?.get('canvas');
    if (previousLevel.id === 'root') {
      canvas?.zoom('fit-viewport');
    } else {
      const elementRegistry = modelerRef.current?.get('elementRegistry');
      const subprocessElement = elementRegistry?.get(previousLevel.id);
      if (subprocessElement) {
        canvas?.zoom('fit-viewport', { element: subprocessElement });
      }
    }
  };

  const navigateToBreadcrumb = (index) => {
    if (index === 0) {
      setNavigationStack([]);
      setCurrentSubprocess(null);
      modelerRef.current?.get('canvas')?.zoom('fit-viewport');
      return;
    }
    
    const targetLevel = navigationStack[index - 1];
    const newStack = navigationStack.slice(0, index);
    
    setNavigationStack(newStack);
    setCurrentSubprocess(targetLevel);
    
    const canvas = modelerRef.current?.get('canvas');
    const elementRegistry = modelerRef.current?.get('elementRegistry');
    const subprocessElement = elementRegistry?.get(targetLevel.id);
    
    if (subprocessElement) {
      canvas?.zoom('fit-viewport', { element: subprocessElement });
    }
  };

  const handleSave = async () => {
    if (!modelerRef.current) return;

    try {
      setSaving(true);
      const { xml: newXml } = await modelerRef.current.saveXML({ format: true });
      
      if (onSave) await onSave(newXml);
      
      // Download option
      const blob = new Blob([newXml], { type: 'application/xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${process?.name || 'process'}.bpmn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setSaving(false);
    } catch (err) {
      alert('Error saving: ' + err.message);
      setSaving(false);
    }
  };

  const downloadXml = async () => {
    if (!modelerRef.current) return;

    try {
      const { xml: newXml } = await modelerRef.current.saveXML({ format: true });
      const blob = new Blob([newXml], { type: 'application/xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${process?.name || 'process'}.bpmn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Error downloading: ' + err.message);
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      mainContainerRef.current?.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  };

  // Add fullscreen event listener
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Add element from palette
  const addSearchElement = (element) => {
    if (!modelerRef.current) return;

    try {
      const modeler = modelerRef.current;
      const elementFactory = modeler.get('elementFactory');
      const canvas = modeler.get('canvas');
      const moddle = modeler.get('moddle');
      
      const rootElement = canvas.getRootElement();
      const viewbox = canvas.viewbox();
      const centerX = -viewbox.x + viewbox.width / 2;
      const centerY = -viewbox.y + viewbox.height / 2;
      const randomOffset = () => (Math.random() - 0.5) * 100;

      const businessObject = moddle.create(element.id, {
        id: `${element.id.replace(':', '_')}_${Date.now()}`,
        name: element.name
      });

      const widths = {
        'bpmn:StartEvent': 36, 'bpmn:EndEvent': 36, 'bpmn:IntermediateThrowEvent': 36,
        'bpmn:UserTask': 100, 'bpmn:ServiceTask': 100, 'bpmn:ScriptTask': 100,
        'bpmn:ManualTask': 100, 'bpmn:SendTask': 100, 'bpmn:ReceiveTask': 100,
        'bpmn:BusinessRuleTask': 100,
        'bpmn:ExclusiveGateway': 50, 'bpmn:ParallelGateway': 50, 'bpmn:InclusiveGateway': 50,
        'bpmn:SubProcess': 120, 'bpmn:CallActivity': 100, 'bpmn:BoundaryEvent': 36,
      };

      const heights = {
        'bpmn:StartEvent': 36, 'bpmn:EndEvent': 36, 'bpmn:IntermediateThrowEvent': 36,
        'bpmn:UserTask': 80, 'bpmn:ServiceTask': 80, 'bpmn:ScriptTask': 80,
        'bpmn:ManualTask': 80, 'bpmn:SendTask': 80, 'bpmn:ReceiveTask': 80,
        'bpmn:BusinessRuleTask': 80,
        'bpmn:ExclusiveGateway': 50, 'bpmn:ParallelGateway': 50, 'bpmn:InclusiveGateway': 50,
        'bpmn:SubProcess': 80, 'bpmn:CallActivity': 80, 'bpmn:BoundaryEvent': 36,
      };

      const createdElement = elementFactory.createShape({
        id: businessObject.id,
        type: element.id,
        businessObject: businessObject,
        x: centerX + randomOffset(),
        y: centerY + randomOffset(),
        width: widths[element.id] || 100,
        height: heights[element.id] || 80
      });

      canvas.addShape(createdElement, rootElement);
      
      const selection = modeler.get('selection');
      selection.select(createdElement);
      
    } catch (error) {
      console.error('Error adding element:', error);
    }
  };

  if (error) {
    return (
      <div className="bpmn-modeler-error">
        <h3>Error</h3>
        <p>{error}</p>
        <button onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div ref={mainContainerRef} className="bpmn-modeler-container">
      {/* Header */}
      <header className="bpmn-modeler-header">
        <div className="bpmn-modeler-header-left">
          <div className="bpmn-modeler-logo">⬡</div>
          <div className="bpmn-modeler-info">
            <span className="bpmn-modeler-tag">Process</span>
            <span className="bpmn-modeler-name">{process?.name || 'Untitled'}</span>
          </div>
          <div className="bpmn-modeler-divider" />
          
          {/* Breadcrumbs */}
          <div className="bpmn-modeler-breadcrumbs">
            <span 
              onClick={() => navigateToBreadcrumb(0)}
              className={!currentSubprocess ? 'active' : ''}
            >
              {process?.name || 'Main Process'}
            </span>
            {navigationStack.map((level, index) => (
              <React.Fragment key={level.id}>
                <span className="breadcrumb-separator">›</span>
                <span 
                  onClick={() => navigateToBreadcrumb(index + 1)}
                  className={currentSubprocess?.id === level.id ? 'active' : ''}
                >
                  {level.name}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="bpmn-modeler-header-right">
          {navigationStack.length > 0 && (
            <button onClick={navigateBack} className="bpmn-modeler-btn-back">
              ← Back
            </button>
          )}
          <button onClick={handleSave} disabled={saving} className="bpmn-modeler-btn-save">
            {saving ? 'Saving...' : '💾 Save'}
          </button>
          <button onClick={downloadXml} className="bpmn-modeler-btn-export">
            ⬇ Export
          </button>
          <button onClick={toggleFullscreen} className="bpmn-modeler-btn-fullscreen">
            {isFullscreen ? '⛶ Exit' : '⛶ Full'}
          </button>
          <button onClick={onClose} className="bpmn-modeler-btn-close">✕</button>
        </div>
      </header>

      {/* Main Body */}
      <div className="bpmn-modeler-body">
        {/* Search Palette */}
        <div className="bpmn-modeler-palette">
          <div className="bpmn-modeler-search">
            <input
              type="text"
              placeholder="🔍 Search elements..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="bpmn-modeler-palette-content">
            {Object.entries(groupedElements).map(([category, elements]) => (
              <div key={category} className="palette-category">
                <div className="palette-category-header">{category}</div>
                {elements.map((element, index) => (
                  <div
                    key={`${element.id}-${index}`}
                    onClick={() => addSearchElement(element)}
                    className="palette-element"
                  >
                    <span className="palette-icon">{element.icon}</span>
                    <span className="palette-name">{element.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="bpmn-modeler-canvas">
          {loading && (
            <div className="bpmn-modeler-loading">
              Loading BPMN Editor...
            </div>
          )}
          <div ref={containerRef} className="bpmn-canvas-container" />
        </div>

        {/* Properties Panel */}
        <div className="bpmn-modeler-properties">
          <div className="properties-header">Properties</div>
          <div className="properties-content">
            {selectedElement ? (
              <div className="properties-form">
                <div className="property-field">
                  <label>Type</label>
                  <div className="property-value type">{properties.type}</div>
                </div>
                <div className="property-field">
                  <label>ID</label>
                  <input type="text" value={properties.id} disabled />
                </div>
                <div className="property-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={properties.name}
                    onChange={(e) => handlePropertyChange('name', e.target.value)}
                    placeholder="Element name..."
                  />
                </div>
                <div className="property-field">
                  <label>Documentation</label>
                  <textarea
                    value={properties.documentation}
                    onChange={(e) => handlePropertyChange('documentation', e.target.value)}
                    placeholder="Add documentation..."
                    rows={4}
                  />
                </div>
              </div>
            ) : (
              <div className="properties-empty">
                <div className="empty-icon">🎯</div>
                <p>Select an element to edit properties</p>
              </div>
            )}
          </div>
          <div className="properties-help">
            <strong>Tips:</strong>
            <ul>
              <li>Double-click to edit names</li>
              <li>Click elements from palette to add</li>
              <li>Click sub-processes to navigate in</li>
              <li>Use Back button to navigate up</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BpmnEditorModeler;
