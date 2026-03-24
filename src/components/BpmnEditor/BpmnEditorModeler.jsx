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

const LEGACY_TYPE_TO_BPMN = {
  startEvent: 'bpmn:startEvent',
  endEvent: 'bpmn:endEvent',
  intermediateEvent: 'bpmn:intermediateCatchEvent',
  userTask: 'bpmn:userTask',
  serviceTask: 'bpmn:serviceTask',
  scriptTask: 'bpmn:scriptTask',
  manualTask: 'bpmn:manualTask',
  sendTask: 'bpmn:sendTask',
  receiveTask: 'bpmn:receiveTask',
  businessRuleTask: 'bpmn:businessRuleTask',
  exclusiveGateway: 'bpmn:exclusiveGateway',
  parallelGateway: 'bpmn:parallelGateway',
  inclusiveGateway: 'bpmn:inclusiveGateway',
  subProcess: 'bpmn:subProcess',
  callActivity: 'bpmn:callActivity',
  annotation: 'bpmn:textAnnotation',
};

const XML_NODE_TYPE_MAP = {
  startEvent: 'bpmn:startEvent',
  endEvent: 'bpmn:endEvent',
  intermediateCatchEvent: 'bpmn:intermediateCatchEvent',
  intermediateThrowEvent: 'bpmn:intermediateThrowEvent',
  userTask: 'bpmn:userTask',
  serviceTask: 'bpmn:serviceTask',
  scriptTask: 'bpmn:scriptTask',
  manualTask: 'bpmn:manualTask',
  sendTask: 'bpmn:sendTask',
  receiveTask: 'bpmn:receiveTask',
  businessRuleTask: 'bpmn:businessRuleTask',
  task: 'bpmn:task',
  exclusiveGateway: 'bpmn:exclusiveGateway',
  parallelGateway: 'bpmn:parallelGateway',
  inclusiveGateway: 'bpmn:inclusiveGateway',
  eventBasedGateway: 'bpmn:eventBasedGateway',
  subProcess: 'bpmn:subProcess',
  callActivity: 'bpmn:callActivity',
  textAnnotation: 'bpmn:textAnnotation',
};

const BPMN_DEFAULT_SIZE = {
  'bpmn:startEvent': { w: 36, h: 36 },
  'bpmn:endEvent': { w: 36, h: 36 },
  'bpmn:intermediateCatchEvent': { w: 36, h: 36 },
  'bpmn:intermediateThrowEvent': { w: 36, h: 36 },
  'bpmn:userTask': { w: 120, h: 80 },
  'bpmn:serviceTask': { w: 120, h: 80 },
  'bpmn:scriptTask': { w: 120, h: 80 },
  'bpmn:manualTask': { w: 120, h: 80 },
  'bpmn:sendTask': { w: 120, h: 80 },
  'bpmn:receiveTask': { w: 120, h: 80 },
  'bpmn:businessRuleTask': { w: 120, h: 80 },
  'bpmn:task': { w: 120, h: 80 },
  'bpmn:exclusiveGateway': { w: 50, h: 50 },
  'bpmn:parallelGateway': { w: 50, h: 50 },
  'bpmn:inclusiveGateway': { w: 50, h: 50 },
  'bpmn:eventBasedGateway': { w: 50, h: 50 },
  'bpmn:subProcess': { w: 160, h: 100 },
  'bpmn:callActivity': { w: 140, h: 90 },
  'bpmn:textAnnotation': { w: 110, h: 50 },
};

const supportsModelerDiagram = (value) =>
  typeof value === 'string' &&
  value.trim().startsWith('<') &&
  /<(?:[\w.-]+:)?BPMNDiagram\b/i.test(value);

const sanitizeId = (value, fallback = 'Element') => {
  const source = String(value || fallback).trim() || fallback;
  const safe = source.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `Id_${safe}`;
};

const anchorPoints = (shape) => [
  { x: shape.x + shape.w / 2, y: shape.y },
  { x: shape.x + shape.w, y: shape.y + shape.h / 2 },
  { x: shape.x + shape.w / 2, y: shape.y + shape.h },
  { x: shape.x, y: shape.y + shape.h / 2 },
];

const pickWaypoints = (source, target) => {
  let best = null;
  anchorPoints(source).forEach((from) => {
    anchorPoints(target).forEach((to) => {
      const distance = (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
      if (!best || distance < best.distance) {
        best = { from, to, distance };
      }
    });
  });
  return [best.from, best.to];
};

function buildRenderableXml({ processName = 'Process', processId = 'Process_1', nodes = [], flows = [] }) {
  if (!nodes.length) {
    return buildFallbackXml(processName);
  }

  const safeProcessId = sanitizeId(processId, 'Process_1');
  const shapeMarkup = nodes.map((node) => {
    const width = node.w || BPMN_DEFAULT_SIZE[node.type]?.w || 120;
    const height = node.h || BPMN_DEFAULT_SIZE[node.type]?.h || 80;
    return `      <bpmndi:BPMNShape id="${node.id}_di" bpmnElement="${node.id}">
        <dc:Bounds x="${node.x}" y="${node.y}" width="${width}" height="${height}" />
      </bpmndi:BPMNShape>`;
  });

  const edgeMarkup = flows.map((flow) => {
    const source = nodes.find((node) => node.id === flow.from);
    const target = nodes.find((node) => node.id === flow.to);
    if (!source || !target) return null;
    const [from, to] = pickWaypoints(source, target);
    return `      <bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}">
        <di:waypoint x="${from.x}" y="${from.y}" />
        <di:waypoint x="${to.x}" y="${to.y}" />
      </bpmndi:BPMNEdge>`;
  }).filter(Boolean);

  const nodeMarkup = nodes.map((node) => {
    const nameAttr = node.label ? ` name="${escapeXml(node.label)}"` : '';
    return `    <${node.type} id="${node.id}"${nameAttr} />`;
  });

  const flowMarkup = flows.map((flow) => {
    const nameAttr = flow.label ? ` name="${escapeXml(flow.label)}"` : '';
    return `    <bpmn:sequenceFlow id="${flow.id}" sourceRef="${flow.from}" targetRef="${flow.to}"${nameAttr} />`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${safeProcessId}" name="${escapeXml(processName)}" isExecutable="false">
${nodeMarkup.join('\n')}
${flowMarkup.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${safeProcessId}">
${shapeMarkup.join('\n')}
${edgeMarkup.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function buildXmlFromLegacyEditor(rawValue, processName) {
  if (typeof rawValue !== 'string') return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || !Array.isArray(parsed.elements)) return null;

    const idMap = new Map();
    const nodes = parsed.elements
      .map((element, index) => {
        const type = LEGACY_TYPE_TO_BPMN[element.type];
        if (!type) return null;

        const id = sanitizeId(element.id, `Element_${index + 1}`);
        idMap.set(element.id, id);
        return {
          id,
          type,
          label: element.label || element.name || '',
          x: Number.isFinite(element.x) ? element.x : 120 + index * 160,
          y: Number.isFinite(element.y) ? element.y : 160,
          w: Number.isFinite(element.w) ? element.w : BPMN_DEFAULT_SIZE[type]?.w,
          h: Number.isFinite(element.h) ? element.h : BPMN_DEFAULT_SIZE[type]?.h,
        };
      })
      .filter(Boolean);

    if (!nodes.length) return null;

    const validIds = new Set(nodes.map((node) => node.id));
    const flows = Array.isArray(parsed.connections)
      ? parsed.connections
          .map((connection, index) => ({
            id: sanitizeId(connection.id, `Flow_${index + 1}`),
            from: idMap.get(connection.from),
            to: idMap.get(connection.to),
            label: connection.label || '',
          }))
          .filter((connection) => validIds.has(connection.from) && validIds.has(connection.to))
      : [];

    return buildRenderableXml({ processName, nodes, flows });
  } catch {
    return null;
  }
}

function buildXmlFromSimpleBpmn(rawValue, processName) {
  if (typeof rawValue !== 'string' || !rawValue.trim().startsWith('<')) return null;
  if (!/(?:<[\w.-]+:)?process\b/i.test(rawValue)) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawValue, 'application/xml');
    if (doc.querySelector('parsererror')) return null;

    const processElement = Array.from(doc.getElementsByTagName('*')).find((node) => node.localName === 'process');
    if (!processElement) return null;

    const nodes = [];
    const flows = [];
    let order = 0;

    Array.from(processElement.children).forEach((child) => {
      const localName = child.localName;
      if (localName === 'sequenceFlow') {
        flows.push({
          id: sanitizeId(child.getAttribute('id'), `Flow_${flows.length + 1}`),
          from: sanitizeId(child.getAttribute('sourceRef'), `From_${flows.length + 1}`),
          to: sanitizeId(child.getAttribute('targetRef'), `To_${flows.length + 1}`),
          label: child.getAttribute('name') || '',
        });
        return;
      }

      const type = XML_NODE_TYPE_MAP[localName];
      if (!type) return;

      nodes.push({
        id: sanitizeId(child.getAttribute('id'), `${localName}_${order + 1}`),
        type,
        label: child.getAttribute('name') || '',
        order: order++,
      });
    });

    if (!nodes.length) return null;

    const outgoing = new Map();
    const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
    flows.forEach((flow) => {
      outgoing.set(flow.from, [...(outgoing.get(flow.from) || []), flow.to]);
      incomingCount.set(flow.to, (incomingCount.get(flow.to) || 0) + 1);
    });

    const queue = nodes
      .filter((node) => node.type === 'bpmn:startEvent' || (incomingCount.get(node.id) || 0) === 0)
      .map((node) => node.id);
    const levels = new Map(queue.map((id) => [id, 0]));

    while (queue.length) {
      const current = queue.shift();
      const currentLevel = levels.get(current) || 0;
      (outgoing.get(current) || []).forEach((targetId) => {
        const nextLevel = currentLevel + 1;
        if (!levels.has(targetId) || nextLevel > levels.get(targetId)) {
          levels.set(targetId, nextLevel);
          queue.push(targetId);
        }
      });
    }

    let fallbackLevel = Math.max(0, ...levels.values(), 0);
    const rowsByLevel = new Map();
    const positionedNodes = nodes.map((node) => {
      const type = node.type;
      const size = BPMN_DEFAULT_SIZE[type] || { w: 120, h: 80 };
      let level = levels.get(node.id);
      if (level === undefined) {
        fallbackLevel += 1;
        level = fallbackLevel;
      }
      const row = rowsByLevel.get(level) || 0;
      rowsByLevel.set(level, row + 1);
      return {
        id: node.id,
        type,
        label: node.label,
        w: size.w,
        h: size.h,
        x: 120 + level * 180,
        y: 120 + row * 120,
      };
    });

    const validIds = new Set(positionedNodes.map((node) => node.id));
    const validFlows = flows.filter((flow) => validIds.has(flow.from) && validIds.has(flow.to));

    return buildRenderableXml({
      processName: processElement.getAttribute('name') || processName,
      processId: processElement.getAttribute('id') || 'Process_1',
      nodes: positionedNodes,
      flows: validFlows,
    });
  } catch {
    return null;
  }
}

function normalizeProcessXml(rawValue, processName) {
  if (supportsModelerDiagram(rawValue)) return rawValue;
  return (
    buildXmlFromLegacyEditor(rawValue, processName) ||
    buildXmlFromSimpleBpmn(rawValue, processName) ||
    buildFallbackXml(processName)
  );
}

const BpmnEditorModeler = ({ process, onClose, onSave }) => {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const mainContainerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [xml, setXml] = useState(() => normalizeProcessXml(process?.bpmn_xml, process?.name || 'Process'));
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
    setXml(normalizeProcessXml(process?.bpmn_xml, process?.name || 'Process'));
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
