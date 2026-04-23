import React, { useEffect, useMemo, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import './BpmnEditorModeler.css';
import {
  buildBpmnSubprocessTrail,
  getBpmnSubprocesses,
  getSubprocessIdFromPlaneId,
  toSubprocessPlaneId,
} from '../../utils/bpmnSubprocesses';
import { apiUrl } from '../../utils/api';

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
  adHocSubProcess: 'bpmn:AdHocSubProcess',
  transaction: 'bpmn:Transaction',
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
  adHocSubProcess: 'bpmn:AdHocSubProcess',
  transaction: 'bpmn:Transaction',
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
  'bpmn:AdHocSubProcess': { w: 160, h: 100 },
  'bpmn:Transaction': { w: 160, h: 100 },
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

function parseBpmnDocument(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim().startsWith('<')) {
    return null;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawValue, 'application/xml');
    return doc.querySelector('parsererror') ? null : doc;
  } catch {
    return null;
  }
}

function extractTopLevelProcessReference(rawValue, fallbackName = 'Process', fallbackId = 'Process_1') {
  const document = parseBpmnDocument(rawValue);
  if (!document) {
    return {
      processId: sanitizeId(fallbackId, 'Process_1'),
      processName: fallbackName || fallbackId || 'Process',
    };
  }

  const hasProcessAncestor = (node) => {
    let current = node?.parentElement || null;

    while (current) {
      if (current.localName === 'process') {
        return true;
      }
      current = current.parentElement;
    }

    return false;
  };

  const processNode = Array.from(document.getElementsByTagName('*')).find(
    (node) => node.localName === 'process' && !hasProcessAncestor(node)
  ) || Array.from(document.getElementsByTagName('*')).find((node) => node.localName === 'process');

  const processId = sanitizeId(processNode?.getAttribute?.('id') || fallbackId, 'Process_1');
  const processName = processNode?.getAttribute?.('name') || fallbackName || processId;

  return {
    processId,
    processName,
  };
}

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

async function extractImportableDiagram(rawValue, processName = 'Imported Process') {
  const xml = normalizeProcessXml(rawValue, processName);
  const mountNode = document.createElement('div');
  mountNode.style.position = 'absolute';
  mountNode.style.width = '1px';
  mountNode.style.height = '1px';
  mountNode.style.overflow = 'hidden';
  mountNode.style.opacity = '0';
  mountNode.style.pointerEvents = 'none';
  document.body.appendChild(mountNode);

  const tempModeler = new BpmnModeler({ container: mountNode });

  try {
    await tempModeler.importXML(xml);
    const canvas = tempModeler.get('canvas');
    const elementRegistry = tempModeler.get('elementRegistry');
    const root = canvas.getRootElement();
    const rootElements = elementRegistry.filter((element) => element.parent === root && !element.labelTarget);
    const shapes = rootElements.filter((element) => Number.isFinite(element.x) && Number.isFinite(element.y) && Number.isFinite(element.width) && Number.isFinite(element.height));
    const allowedShapeIds = new Set(shapes.map((shape) => shape.id));
    const connections = rootElements.filter(
      (element) =>
        Array.isArray(element.waypoints) &&
        allowedShapeIds.has(element.source?.id) &&
        allowedShapeIds.has(element.target?.id)
    );

    return {
      shapes: shapes.map((shape) => ({
        id: shape.id,
        type: shape.type,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        name: shape.businessObject?.name || '',
        documentation: shape.businessObject?.documentation?.[0]?.text || '',
        calledElement: shape.businessObject?.calledElement || '',
        triggeredByEvent: Boolean(shape.businessObject?.triggeredByEvent),
        isExpanded: getElementDisplayMode(shape) !== 'collapsed',
        linkedProcessMetadata: getLinkedProcessMetadata(shape.businessObject),
        actorMetadata: getActorMetadata(shape.businessObject),
        riskMetadata: getRiskMetadata(shape.businessObject),
      })),
      connections: connections.map((connection) => ({
        id: connection.id,
        type: connection.type,
        sourceId: connection.source.id,
        targetId: connection.target.id,
        name: connection.businessObject?.name || '',
      })),
    };
  } finally {
    tempModeler.destroy();
    mountNode.remove();
  }
}

const PALETTE_ELEMENTS = [
  { id: 'bpmn:StartEvent', name: 'Start Event', category: 'Events', icon: '○' },
  { id: 'bpmn:EndEvent', name: 'End Event', category: 'Events', icon: '◎' },
  { id: 'bpmn:IntermediateThrowEvent', name: 'Intermediate / Boundary Event', category: 'Events', icon: '◌' },
  { id: 'bpmn:Task', name: 'Task', category: 'Tasks', icon: '□' },
  { id: 'bpmn:UserTask', name: 'User Task', category: 'Tasks', icon: '👤' },
  { id: 'bpmn:ServiceTask', name: 'Service Task', category: 'Tasks', icon: '⚙' },
  { id: 'bpmn:ScriptTask', name: 'Script Task', category: 'Tasks', icon: '📝' },
  { id: 'bpmn:ManualTask', name: 'Manual Task', category: 'Tasks', icon: '✋' },
  { id: 'bpmn:SendTask', name: 'Send Task', category: 'Tasks', icon: '📤' },
  { id: 'bpmn:ReceiveTask', name: 'Receive Task', category: 'Tasks', icon: '📥' },
  { id: 'bpmn:BusinessRuleTask', name: 'Business Rule Task', category: 'Tasks', icon: '📋' },
  { id: 'bpmn:ExclusiveGateway', name: 'Exclusive Gateway', category: 'Gateways', icon: '◇' },
  { id: 'bpmn:ParallelGateway', name: 'Parallel Gateway', category: 'Gateways', icon: '◆' },
  { id: 'bpmn:InclusiveGateway', name: 'Inclusive Gateway', category: 'Gateways', icon: '⬡' },
  { id: 'bpmn:EventBasedGateway', name: 'Event-Based Gateway', category: 'Gateways', icon: '⬢' },
  { key: 'bpmn-subprocess-expanded', id: 'bpmn:SubProcess', name: 'Expanded Sub-Process', category: 'Camunda Subprocesses', icon: '[+]', shapeOptions: { isExpanded: true } },
  { key: 'bpmn-subprocess-collapsed', id: 'bpmn:SubProcess', name: 'Collapsed Sub-Process', category: 'Camunda Subprocesses', icon: '[-]', shapeOptions: { isExpanded: false } },
  { key: 'bpmn-subprocess-event', id: 'bpmn:SubProcess', name: 'Event Sub-Process', category: 'Camunda Subprocesses', icon: '(!)', shapeOptions: { isExpanded: true }, businessObjectAttrs: { triggeredByEvent: true } },
  { key: 'bpmn-subprocess-adhoc', id: 'bpmn:AdHocSubProcess', name: 'Ad-Hoc Sub-Process', category: 'Camunda Subprocesses', icon: '~', shapeOptions: { isExpanded: true } },
  { key: 'bpmn-subprocess-transaction', id: 'bpmn:Transaction', name: 'Transaction Sub-Process', category: 'Camunda Subprocesses', icon: 'Tx', shapeOptions: { isExpanded: true } },
  { key: 'bpmn-call-activity', id: 'bpmn:CallActivity', name: 'Call Activity', category: 'Camunda Subprocesses', icon: '->' },
  { id: 'bpmn:Participant', name: 'Pool / Participant', category: 'Collaboration', icon: '▭' },
  { id: 'bpmn:DataObjectReference', name: 'Data Object', category: 'Data & Artifacts', icon: '📄' },
  { id: 'bpmn:DataStoreReference', name: 'Data Store', category: 'Data & Artifacts', icon: '🗄' },
  { id: 'bpmn:Group', name: 'Group', category: 'Data & Artifacts', icon: '▤' },
  { id: 'bpmn:TextAnnotation', name: 'Text Annotation', category: 'Data & Artifacts', icon: '🗒' },
];

const createPaletteShape = (modeler, element) => {
  const elementFactory = modeler.get('elementFactory');
  const moddle = modeler.get('moddle');
  const type = element?.id;

  if (type === 'bpmn:Participant') {
    return elementFactory.createParticipantShape();
  }

  const businessObject = element?.businessObjectAttrs
    ? moddle.create(type, element.businessObjectAttrs)
    : undefined;

  return elementFactory.createShape({
    type,
    ...(element?.shapeOptions || {}),
    ...(businessObject ? { businessObject } : {}),
  });
};

const PFE_NAMESPACE_PREFIX = 'pfe';
const PFE_NAMESPACE_URI = 'https://pfe.local/schema/bpmn';
const ACTOR_NODE_TYPES = new Set(['manager', 'function', 'org_unit', 'structure']);
const ASSIGNABLE_ACTOR_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ManualTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:BusinessRuleTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:AdHocSubProcess',
  'bpmn:Transaction',
]);
const RISK_SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];
const RISK_CATEGORY_OPTIONS = [
  { value: 'operational', label: 'Operational' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'financial', label: 'Financial' },
  { value: 'security', label: 'Security' },
  { value: 'quality', label: 'Quality' },
  { value: 'other', label: 'Other' },
];
const RISK_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'mitigated', label: 'Mitigated' },
  { value: 'accepted', label: 'Accepted' },
];
const RISK_SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const pfeAttrKey = (key) => `${PFE_NAMESPACE_PREFIX}:${key}`;

const isActorAssignableElement = (element) => ASSIGNABLE_ACTOR_TYPES.has(element?.type);
const isSubprocessLikeElement = (element) => ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'].includes(element?.type);
const isCallActivityElement = (element) => element?.type === 'bpmn:CallActivity';
const isRiskAssignableElement = (element) =>
  Boolean(element?.businessObject) &&
  Boolean(element?.parent) &&
  !element?.labelTarget &&
  !Array.isArray(element?.waypoints);

const shouldSyncActorNameToLabel = (element) => ['bpmn:Participant', 'bpmn:Lane'].includes(element?.type);
const createEmptyRiskDraft = () => ({
  title: '',
  severity: 'medium',
  category: 'operational',
  status: 'open',
  description: '',
  mitigation: '',
});
const createRiskId = () => `risk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function getActorMetadata(businessObject) {
  const attrs = businessObject?.$attrs || {};
  return {
    actorNodeId: String(attrs[pfeAttrKey('actorNodeId')] || ''),
    actorUserId: String(attrs[pfeAttrKey('actorUserId')] || ''),
    actorName: attrs[pfeAttrKey('actorName')] || '',
    actorType: attrs[pfeAttrKey('actorType')] || '',
    actorPath: attrs[pfeAttrKey('actorPath')] || '',
  };
}

function buildActorOptions(nodes = []) {
  const byId = new Map(nodes.map((node) => [Number(node.id), node]));

  const toPath = (node) => {
    const lineage = [];
    let current = node;

    while (current) {
      lineage.unshift(current.name || current.userName || current.title || `Node ${current.id}`);
      current = current.parentId ? byId.get(Number(current.parentId)) : null;
    }

    return lineage.join(' / ');
  };

  return nodes
    .filter((node) => node?.userId || ACTOR_NODE_TYPES.has(node?.nodeType))
    .map((node) => {
      const name = node.name || node.userName || `Actor ${node.id}`;
      const subtitle = [node.title, node.userRole].filter(Boolean).join(' - ');

      return {
        id: String(node.id),
        nodeId: Number(node.id),
        userId: Number.isInteger(Number(node.userId)) ? Number(node.userId) : null,
        name,
        title: node.title || '',
        userName: node.userName || '',
        userRole: node.userRole || '',
        nodeType: node.nodeType || 'function',
        isVacant: Boolean(node.isVacant),
        path: toPath(node),
        subtitle,
        searchText: [name, node.title, node.userName, node.userRole, node.nodeType, toPath(node)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name));
}

function buildDiagramActorSummary(elementRegistry, actorOptions = []) {
  if (!elementRegistry) {
    return [];
  }

  const actorById = new Map(actorOptions.map((actor) => [String(actor.nodeId), actor]));
  const grouped = new Map();

  elementRegistry
    .filter((element) => !element.labelTarget && element.businessObject)
    .forEach((element) => {
      const metadata = getActorMetadata(element.businessObject);
      if (!metadata.actorNodeId) {
        return;
      }

      const actor = actorById.get(metadata.actorNodeId);
      const actorKey = metadata.actorNodeId;
      const bucket = grouped.get(actorKey) || {
        actorNodeId: metadata.actorNodeId,
        actorName: actor?.name || metadata.actorName || `Actor ${metadata.actorNodeId}`,
        actorType: actor?.nodeType || metadata.actorType || '',
        actorPath: actor?.path || metadata.actorPath || '',
        elements: [],
      };

      bucket.elements.push({
        id: element.id,
        type: element.type,
        label: element.businessObject?.name || element.id,
      });

      grouped.set(actorKey, bucket);
    });

  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      count: entry.elements.length,
      elements: entry.elements.sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.actorName.localeCompare(right.actorName));
}

function normalizeRiskEntry(risk = {}, index = 0) {
  const severity = RISK_SEVERITY_OPTIONS.some((option) => option.value === risk?.severity) ? risk.severity : 'medium';
  const category = RISK_CATEGORY_OPTIONS.some((option) => option.value === risk?.category) ? risk.category : 'operational';
  const status = RISK_STATUS_OPTIONS.some((option) => option.value === risk?.status) ? risk.status : 'open';
  const title = String(risk?.title || '').trim() || `Risk ${index + 1}`;

  return {
    id: String(risk?.id || `risk_${index + 1}`),
    title,
    severity,
    category,
    status,
    description: String(risk?.description || ''),
    mitigation: String(risk?.mitigation || ''),
  };
}

function serializeRiskMetadata(risks = []) {
  if (!Array.isArray(risks) || !risks.length) {
    return '';
  }

  return JSON.stringify(risks.map((risk, index) => normalizeRiskEntry(risk, index)));
}

function getRiskMetadata(businessObject) {
  const attrs = businessObject?.$attrs || {};
  const raw = attrs[pfeAttrKey('risks')];

  if (!raw) {
    return { risks: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { risks: [] };
    }

    return {
      risks: parsed.map((risk, index) => normalizeRiskEntry(risk, index)),
    };
  } catch {
    return { risks: [] };
  }
}

function getLinkedProcessMetadata(businessObject) {
  const attrs = businessObject?.$attrs || {};

  return {
    calledElement: String(businessObject?.calledElement || ''),
    linkedProcessId: String(attrs[pfeAttrKey('linkedProcessId')] || ''),
    linkedProcessName: String(attrs[pfeAttrKey('linkedProcessName')] || ''),
  };
}

function getElementDisplayMode(element) {
  if (!isSubprocessLikeElement(element)) {
    return '';
  }

  const di = element?.businessObject?.di || element?.di;
  if (typeof di?.isExpanded === 'boolean') {
    return di.isExpanded ? 'expanded' : 'collapsed';
  }

  if (typeof element?.collapsed === 'boolean') {
    return element.collapsed ? 'collapsed' : 'expanded';
  }

  return 'expanded';
}

function getElementVariantLabel(element) {
  if (isCallActivityElement(element)) {
    return 'Call activity';
  }

  if (element?.type === 'bpmn:AdHocSubProcess') {
    return 'Ad-hoc sub-process';
  }

  if (element?.type === 'bpmn:Transaction') {
    return 'Transaction';
  }

  if (element?.businessObject?.triggeredByEvent) {
    return 'Event sub-process';
  }

  if (element?.type === 'bpmn:SubProcess') {
    return 'Embedded sub-process';
  }

  return '';
}

function buildDiagramRiskSummary(elementRegistry) {
  if (!elementRegistry) {
    return [];
  }

  const diagramRisks = [];

  elementRegistry
    .filter((element) => isRiskAssignableElement(element))
    .forEach((element) => {
      const { risks } = getRiskMetadata(element.businessObject);

      risks.forEach((risk, index) => {
        const normalizedRisk = normalizeRiskEntry(risk, index);
        diagramRisks.push({
          ...normalizedRisk,
          elementId: element.id,
          elementType: element.type,
          elementLabel: element.businessObject?.name || element.id,
        });
      });
    });

  return diagramRisks.sort(
    (left, right) =>
      (RISK_SEVERITY_RANK[right.severity] || 0) - (RISK_SEVERITY_RANK[left.severity] || 0) ||
      left.title.localeCompare(right.title) ||
      left.elementLabel.localeCompare(right.elementLabel)
  );
}

function getHighestRiskSeverity(risks = []) {
  return risks.reduce((highest, risk) => {
    if ((RISK_SEVERITY_RANK[risk.severity] || 0) > (RISK_SEVERITY_RANK[highest] || 0)) {
      return risk.severity;
    }

    return highest;
  }, 'low');
}

function ensurePfeNamespace(modeler) {
  const definitions = modeler?.getDefinitions?.();
  if (!definitions) {
    return;
  }

  const attrs = definitions.$attrs || {};
  attrs[`xmlns:${PFE_NAMESPACE_PREFIX}`] = PFE_NAMESPACE_URI;
}

function applyActorAssignment(modeler, element, actor, options = {}) {
  if (!modeler || !element?.businessObject) {
    return;
  }

  ensurePfeNamespace(modeler);

  const nextAttrs = element.businessObject.$attrs || {};

  if (actor) {
    nextAttrs[pfeAttrKey('actorNodeId')] = String(actor.nodeId);
    nextAttrs[pfeAttrKey('actorName')] = actor.name;
    nextAttrs[pfeAttrKey('actorType')] = actor.nodeType || '';
    nextAttrs[pfeAttrKey('actorPath')] = actor.path || '';

    if (actor.userId) {
      nextAttrs[pfeAttrKey('actorUserId')] = String(actor.userId);
    } else {
      delete nextAttrs[pfeAttrKey('actorUserId')];
    }
  } else {
    delete nextAttrs[pfeAttrKey('actorNodeId')];
    delete nextAttrs[pfeAttrKey('actorUserId')];
    delete nextAttrs[pfeAttrKey('actorName')];
    delete nextAttrs[pfeAttrKey('actorType')];
    delete nextAttrs[pfeAttrKey('actorPath')];
  }

  if (actor && options.syncLabel && shouldSyncActorNameToLabel(element)) {
    modeler.get('modeling').updateLabel(element, actor.name);
  } else {
    modeler.get('eventBus').fire('elements.changed', { elements: [element] });
  }
}

function applyRiskAssignment(modeler, element, risks = []) {
  if (!modeler || !element?.businessObject) {
    return;
  }

  ensurePfeNamespace(modeler);

  const nextAttrs = element.businessObject.$attrs || {};
  const serializedRisks = serializeRiskMetadata(risks);

  if (serializedRisks) {
    nextAttrs[pfeAttrKey('risks')] = serializedRisks;
  } else {
    delete nextAttrs[pfeAttrKey('risks')];
  }

  modeler.get('eventBus').fire('elements.changed', { elements: [element] });
}

function applyCallActivityLink(modeler, element, link = null, options = {}) {
  if (!modeler || !isCallActivityElement(element) || !element?.businessObject) {
    return;
  }

  ensurePfeNamespace(modeler);

  const nextAttrs = element.businessObject.$attrs || {};
  const previousLinkedProcessName = String(nextAttrs[pfeAttrKey('linkedProcessName')] || '');
  const nextCalledElement = String(link?.calledElement || '').trim();
  const nextLinkedProcessId = String(link?.linkedProcessId || '').trim();
  const nextLinkedProcessName = String(link?.linkedProcessName || '').trim();

  if (nextLinkedProcessId) {
    nextAttrs[pfeAttrKey('linkedProcessId')] = nextLinkedProcessId;
  } else {
    delete nextAttrs[pfeAttrKey('linkedProcessId')];
  }

  if (nextLinkedProcessName) {
    nextAttrs[pfeAttrKey('linkedProcessName')] = nextLinkedProcessName;
  } else {
    delete nextAttrs[pfeAttrKey('linkedProcessName')];
  }

  modeler.get('modeling').updateProperties(element, {
    calledElement: nextCalledElement || undefined,
  });

  const currentName = String(element.businessObject?.name || '').trim();
  if (
    nextLinkedProcessName &&
    options.syncLabel &&
    (!currentName || currentName === previousLinkedProcessName || /^call activity$/i.test(currentName))
  ) {
    modeler.get('modeling').updateLabel(element, nextLinkedProcessName);
    return;
  }

  modeler.get('eventBus').fire('elements.changed', { elements: [element] });
}

function syncRiskOverlays(modeler, overlayIdsRef) {
  if (!modeler || !overlayIdsRef) {
    return;
  }

  const overlays = modeler.get('overlays');
  const elementRegistry = modeler.get('elementRegistry');

  if (!overlays || !elementRegistry) {
    return;
  }

  overlayIdsRef.current.forEach((overlayId) => overlays.remove(overlayId));
  overlayIdsRef.current = [];

  elementRegistry
    .filter((element) => isRiskAssignableElement(element))
    .forEach((element) => {
      const { risks } = getRiskMetadata(element.businessObject);

      if (!risks.length) {
        return;
      }

      const highestSeverity = getHighestRiskSeverity(risks);
      const badge = document.createElement('div');
      badge.className = `bpmn-risk-overlay bpmn-risk-overlay--${highestSeverity}`;
      badge.textContent = String(risks.length);
      badge.title = `${risks.length} risk${risks.length > 1 ? 's' : ''}: ${risks
        .slice(0, 3)
        .map((risk) => risk.title)
        .join(', ')}${risks.length > 3 ? '...' : ''}`;

      const overlayId = overlays.add(element, {
        position: { top: -10, right: -10 },
        html: badge,
      });

      overlayIdsRef.current.push(overlayId);
    });
}

const BpmnEditorModeler = ({
  process,
  onClose,
  onSave,
  importOptions = [],
  onImportExisting = null,
  onOpenLinkedProcess = null,
  onReturnToMainProcess = null,
  readOnly = false,
  reviewActionLabel = 'Approve',
  onReviewAction = null,
  reviewActionBusy = false,
  initialSubprocessId = null,
}) => {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const mainContainerRef = useRef(null);
  const mainRootIdRef = useRef(null);
  const fileInputRef = useRef(null);
  const riskOverlayIdsRef = useRef([]);
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
  const [actorOptions, setActorOptions] = useState([]);
  const [actorLoading, setActorLoading] = useState(false);
  const [actorError, setActorError] = useState('');
  const [diagramActors, setDiagramActors] = useState([]);
  const [diagramRisks, setDiagramRisks] = useState([]);
  const [riskDraft, setRiskDraft] = useState(createEmptyRiskDraft);
  const [editingRiskId, setEditingRiskId] = useState('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState('');
  const [importing, setImporting] = useState(false);
  const editorSubprocesses = useMemo(() => getBpmnSubprocesses(xml), [xml]);
  const callActivityOptions = useMemo(
    () =>
      importOptions.map((option) => {
        const fallbackId = `Process_${option.id || 'Ref'}`;
        const { processId } = extractTopLevelProcessReference(option?.bpmn_xml, option?.name || 'Process', fallbackId);

        return {
          id: String(option.id),
          name: option.name || processId,
          calledElement: processId,
        };
      }),
    [importOptions]
  );

  const bpmnElements = PALETTE_ELEMENTS;
  /*
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
  */

  // Set XML from process
  useEffect(() => {
    setXml(normalizeProcessXml(process?.bpmn_xml, process?.name || 'Process'));
  }, [process]);

  useEffect(() => {
    setShowImportPanel(false);
    setSelectedImportId('');
  }, [process?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadActors = async () => {
      setActorLoading(true);
      setActorError('');

      try {
        const response = await fetch(apiUrl('/orgchart/nodes'));
        if (!response.ok) {
          throw new Error('Failed to load actors from the organigram.');
        }

        const nodes = await response.json();
        if (!cancelled) {
          setActorOptions(buildActorOptions(Array.isArray(nodes) ? nodes : []));
        }
      } catch (loadError) {
        if (!cancelled) {
          setActorError(loadError.message || 'Failed to load actors from the organigram.');
          setActorOptions([]);
        }
      } finally {
        if (!cancelled) {
          setActorLoading(false);
        }
      }
    };

    loadActors();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const selectedActor = useMemo(
    () =>
      actorOptions.find((actor) => String(actor.nodeId) === String(properties.actorNodeId || '')) ||
      (properties.actorNodeId
        ? {
            nodeId: properties.actorNodeId,
            name: properties.actorName || `Actor ${properties.actorNodeId}`,
            subtitle: properties.actorType || '',
            nodeType: properties.actorType || '',
            path: properties.actorPath || '',
          }
        : null),
    [actorOptions, properties.actorNodeId, properties.actorName, properties.actorPath, properties.actorType]
  );
  const selectedLinkedProcess = useMemo(
    () =>
      callActivityOptions.find((option) => String(option.id) === String(properties.linkedProcessId || '')) ||
      callActivityOptions.find((option) => option.calledElement === String(properties.calledElement || '')) ||
      (properties.linkedProcessId || properties.calledElement
        ? {
            id: String(properties.linkedProcessId || ''),
            name: properties.linkedProcessName || properties.calledElement || `Process ${properties.linkedProcessId}`,
            calledElement: properties.calledElement || '',
          }
        : null),
    [callActivityOptions, properties.calledElement, properties.linkedProcessId, properties.linkedProcessName]
  );
  const isLinkedProcessView =
    Number(process?.rootProcessId || process?.id || 0) > 0 &&
    Number(process?.rootProcessId || process?.id || 0) !== Number(process?.id || 0);
  const canReturnToMainProcess = Boolean(currentSubprocess || isLinkedProcessView);
  const mainProcessName = process?.rootProcessName || process?.name || 'Main Process';

  useEffect(() => {
    if (!modelerRef.current) {
      return;
    }

    const elementRegistry = modelerRef.current.get('elementRegistry');
    setDiagramActors(buildDiagramActorSummary(elementRegistry, actorOptions));
    setDiagramRisks(buildDiagramRiskSummary(elementRegistry));
    syncRiskOverlays(modelerRef.current, riskOverlayIdsRef);
  }, [actorOptions, xml]);

  useEffect(() => {
    setEditingRiskId('');
    setRiskDraft(createEmptyRiskDraft());
  }, [selectedElement?.id]);

  const syncNavigationFromRoot = (rootElement) => {
    const activeSubprocessId = getSubprocessIdFromPlaneId(rootElement?.id);
    const trail = buildBpmnSubprocessTrail(editorSubprocesses, activeSubprocessId);
    setNavigationStack(trail);
    setCurrentSubprocess(trail.length ? trail[trail.length - 1] : null);
  };

  const openDiagramLevel = (subprocessId = null) => {
    const canvas = modelerRef.current?.get('canvas');
    if (!canvas) {
      return;
    }

    const targetRoot = subprocessId
      ? canvas.findRoot(toSubprocessPlaneId(subprocessId))
      : mainRootIdRef.current
        ? canvas.findRoot(mainRootIdRef.current)
        : null;

    if (targetRoot) {
      canvas.setRootElement(targetRoot);
    }

    canvas.zoom('fit-viewport');
  };

  // Initialize modeler
  useEffect(() => {
    if (!xml || !containerRef.current) return;

    let disposed = false;

    const initModeler = async () => {
      try {
        const modeler = new BpmnModeler({
          container: containerRef.current,
          palette: !readOnly
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

        const canvas = modeler.get('canvas');
        const eventBus = modeler.get('eventBus');
        const elementRegistry = modeler.get('elementRegistry');

        const refreshDiagramActors = () => {
          setDiagramActors(buildDiagramActorSummary(elementRegistry, actorOptions));
        };
        const refreshDiagramRisks = () => {
          setDiagramRisks(buildDiagramRiskSummary(elementRegistry));
          syncRiskOverlays(modeler, riskOverlayIdsRef);
        };
        const refreshDerivedPanels = () => {
          refreshDiagramActors();
          refreshDiagramRisks();
        };

        if (canvas) {
          mainRootIdRef.current = canvas.getRootElement()?.id || null;
        }

        setLoading(false);
        refreshDerivedPanels();

        // Listen for selection changes
        eventBus.on('selection.changed', (event) => {
          const selection = event.newSelection;
          if (selection.length === 1) {
            const el = selection[0];
            const actorMetadata = getActorMetadata(el.businessObject);
            const riskMetadata = getRiskMetadata(el.businessObject);
            const linkedProcessMetadata = getLinkedProcessMetadata(el.businessObject);
            setSelectedElement(el);
            setProperties({
              id: el.id,
              name: el.businessObject?.name || '',
              type: el.type,
              documentation: el.businessObject?.documentation?.[0]?.text || '',
              actorNodeId: actorMetadata.actorNodeId,
              actorName: actorMetadata.actorName,
              actorType: actorMetadata.actorType,
              actorPath: actorMetadata.actorPath,
              calledElement: linkedProcessMetadata.calledElement,
              linkedProcessId: linkedProcessMetadata.linkedProcessId,
              linkedProcessName: linkedProcessMetadata.linkedProcessName,
              elementVariant: getElementVariantLabel(el),
              displayMode: getElementDisplayMode(el),
              risks: riskMetadata.risks,
            });
          } else {
            setSelectedElement(null);
            setProperties({});
          }
        });

        eventBus.on('root.set', (event) => {
          syncNavigationFromRoot(event.element);
        });

        eventBus.on('commandStack.changed', refreshDerivedPanels);
        eventBus.on('elements.changed', refreshDerivedPanels);

        if (initialSubprocessId && canvas) {
          const initialRoot = canvas.findRoot(toSubprocessPlaneId(initialSubprocessId));
          if (initialRoot) {
            canvas.setRootElement(initialRoot);
          }
        }

        canvas?.zoom('fit-viewport');
        syncNavigationFromRoot(canvas?.getRootElement());
        refreshDerivedPanels();

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
      riskOverlayIdsRef.current = [];
    };
  }, [xml, process?.name, readOnly, initialSubprocessId, editorSubprocesses]);

  const handlePropertyChange = (key, value) => {
    if (readOnly || !selectedElement || !modelerRef.current) return;

    const modeling = modelerRef.current.get('modeling');
    
    if (key === 'name') {
      modeling.updateLabel(selectedElement, value);
    } else if (key === 'documentation') {
      const commandStack = modelerRef.current.get('commandStack');
      commandStack.execute('element.updateProperties', {
        element: selectedElement,
        properties: { documentation: [{ text: value }] }
      });
    } else if (key === 'actorNodeId') {
      const actor = actorOptions.find((option) => String(option.nodeId) === String(value)) || null;
      applyActorAssignment(modelerRef.current, selectedElement, actor, {
        syncLabel: shouldSyncActorNameToLabel(selectedElement),
      });
    } else if (key === 'linkedProcessId') {
      const linkedProcess = callActivityOptions.find((option) => String(option.id) === String(value)) || null;
      applyCallActivityLink(
        modelerRef.current,
        selectedElement,
        linkedProcess
          ? {
              calledElement: linkedProcess.calledElement,
              linkedProcessId: linkedProcess.id,
              linkedProcessName: linkedProcess.name,
            }
          : null,
        { syncLabel: true }
      );
      setProperties((prev) => ({
        ...prev,
        linkedProcessId: linkedProcess?.id || '',
        linkedProcessName: linkedProcess?.name || '',
        calledElement: linkedProcess?.calledElement || '',
      }));
      return;
    } else if (key === 'calledElement') {
      const normalizedValue = String(value || '').trim();
      const linkedProcess = callActivityOptions.find((option) => option.calledElement === normalizedValue) || null;
      applyCallActivityLink(
        modelerRef.current,
        selectedElement,
        normalizedValue
          ? {
              calledElement: normalizedValue,
              linkedProcessId: linkedProcess?.id || '',
              linkedProcessName: linkedProcess?.name || '',
            }
          : null
      );
      setProperties((prev) => ({
        ...prev,
        calledElement: normalizedValue,
        linkedProcessId: linkedProcess?.id || '',
        linkedProcessName: linkedProcess?.name || '',
      }));
      return;
    }

    if (key === 'actorNodeId') {
      const actor = actorOptions.find((option) => String(option.nodeId) === String(value)) || null;
      setProperties((prev) => ({
        ...prev,
        actorNodeId: actor ? String(actor.nodeId) : '',
        actorName: actor?.name || '',
        actorType: actor?.nodeType || '',
        actorPath: actor?.path || '',
        name: shouldSyncActorNameToLabel(selectedElement) && actor ? actor.name : prev.name,
      }));
      return;
    }

    setProperties(prev => ({ ...prev, [key]: value }));
  };

  const resetRiskEditor = () => {
    setEditingRiskId('');
    setRiskDraft(createEmptyRiskDraft());
  };

  const startRiskEdit = (risk) => {
    setEditingRiskId(risk.id);
    setRiskDraft({
      title: risk.title || '',
      severity: risk.severity || 'medium',
      category: risk.category || 'operational',
      status: risk.status || 'open',
      description: risk.description || '',
      mitigation: risk.mitigation || '',
    });
  };

  const saveRiskForSelectedElement = () => {
    if (readOnly || !selectedElement || !modelerRef.current) {
      return;
    }

    const title = riskDraft.title.trim();
    if (!title) {
      alert('Please enter a risk title before saving.');
      return;
    }

    const currentRisks = Array.isArray(properties.risks) ? properties.risks : [];
    const nextRisk = normalizeRiskEntry(
      {
        id: editingRiskId || createRiskId(),
        ...riskDraft,
        title,
      },
      currentRisks.length
    );

    const nextRisks = editingRiskId
      ? currentRisks.map((risk) => (risk.id === editingRiskId ? nextRisk : risk))
      : [...currentRisks, nextRisk];

    applyRiskAssignment(modelerRef.current, selectedElement, nextRisks);
    setProperties((prev) => ({ ...prev, risks: nextRisks }));
    resetRiskEditor();
  };

  const removeRiskFromSelectedElement = (riskId) => {
    if (readOnly || !selectedElement || !modelerRef.current) {
      return;
    }

    const currentRisks = Array.isArray(properties.risks) ? properties.risks : [];
    const nextRisks = currentRisks.filter((risk) => risk.id !== riskId);

    applyRiskAssignment(modelerRef.current, selectedElement, nextRisks);
    setProperties((prev) => ({ ...prev, risks: nextRisks }));

    if (editingRiskId === riskId) {
      resetRiskEditor();
    }
  };

  const navigateBack = () => {
    if (navigationStack.length === 0) return;
    openDiagramLevel(currentSubprocess?.parentId || null);
  };

  const navigateToBreadcrumb = (index) => {
    if (index === 0) {
      openDiagramLevel(null);
      return;
    }

    openDiagramLevel(navigationStack[index - 1]?.id || null);
  };

  const handleReturnToMainProcess = () => {
    if (isLinkedProcessView && onReturnToMainProcess) {
      onReturnToMainProcess();
      return;
    }

    openDiagramLevel(null);
  };

  const handleSave = async () => {
    if (readOnly || !modelerRef.current) return;

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
    if (readOnly || !modelerRef.current) return;

    try {
      const modeler = modelerRef.current;
      const canvas = modeler.get('canvas');
      const modeling = modeler.get('modeling');
      const selection = modeler.get('selection');
      
      const rootElement = canvas.getRootElement();
      const viewbox = canvas.viewbox();
      const centerX = -viewbox.x + viewbox.width / 2;
      const centerY = -viewbox.y + viewbox.height / 2;
      const randomOffset = () => (Math.random() - 0.5) * 100;

      const createdElement = createPaletteShape(modeler, element);

      modeling.createShape(
        createdElement,
        {
          x: centerX + randomOffset(),
          y: centerY + randomOffset(),
        },
        rootElement
      );

      selection.select(createdElement);
      
    } catch (error) {
      console.error('Error adding element:', error);
    }
  };

  const applyImportedDiagram = async (rawValue, sourceName = 'Process') => {
    if (!modelerRef.current) {
      setXml(normalizeProcessXml(rawValue, sourceName));
      setSelectedElement(null);
      setProperties({});
      setShowImportPanel(false);
      setSelectedImportId('');
      return;
    }

    const imported = await extractImportableDiagram(rawValue, sourceName);
    if (!imported.shapes.length) {
      throw new Error('No importable BPMN elements were found in that diagram.');
    }

    const modeler = modelerRef.current;
    const canvas = modeler.get('canvas');
    const elementRegistry = modeler.get('elementRegistry');
    const elementFactory = modeler.get('elementFactory');
    const modeling = modeler.get('modeling');
    const moddle = modeler.get('moddle');
    const selection = modeler.get('selection');
    const root = canvas.getRootElement();
    const existingRootShapes = elementRegistry.filter(
      (element) => element.parent === root && !element.labelTarget && Number.isFinite(element.x) && Number.isFinite(element.width)
    );
    const currentRightEdge = existingRootShapes.reduce((max, shape) => Math.max(max, shape.x + shape.width), 120);
    const importedLeftEdge = imported.shapes.reduce((min, shape) => Math.min(min, shape.x), imported.shapes[0].x);
    const offsetX = currentRightEdge - importedLeftEdge + 140;
    const offsetY = 40;
    const timestamp = Date.now();
    const importedShapeMap = new Map();

    imported.shapes.forEach((shape, index) => {
      const businessObjectProperties = {
        id: sanitizeId(`${shape.type.replace(':', '_')}_${timestamp}_${index + 1}`),
        name: shape.name || undefined,
      };

      if (shape.type === 'bpmn:CallActivity' && shape.calledElement) {
        businessObjectProperties.calledElement = shape.calledElement;
      }

      if ((shape.type === 'bpmn:SubProcess' || shape.type === 'bpmn:Transaction') && shape.triggeredByEvent) {
        businessObjectProperties.triggeredByEvent = true;
      }

      const businessObject = moddle.create(shape.type, businessObjectProperties);

      if (shape.documentation) {
        businessObject.documentation = [moddle.create('bpmn:Documentation', { text: shape.documentation })];
      }

      const importedActorMetadata = shape.actorMetadata || {};
      if (importedActorMetadata.actorNodeId) {
        ensurePfeNamespace(modeler);
        const nextAttrs = businessObject.$attrs || {};

        nextAttrs[pfeAttrKey('actorNodeId')] = importedActorMetadata.actorNodeId;
        nextAttrs[pfeAttrKey('actorName')] = importedActorMetadata.actorName || '';
        nextAttrs[pfeAttrKey('actorType')] = importedActorMetadata.actorType || '';
        nextAttrs[pfeAttrKey('actorPath')] = importedActorMetadata.actorPath || '';

        if (importedActorMetadata.actorUserId) {
          nextAttrs[pfeAttrKey('actorUserId')] = importedActorMetadata.actorUserId;
        } else {
          delete nextAttrs[pfeAttrKey('actorUserId')];
        }
      }

      const importedRiskMetadata = shape.riskMetadata || {};
      if (Array.isArray(importedRiskMetadata.risks) && importedRiskMetadata.risks.length) {
        ensurePfeNamespace(modeler);
        const nextAttrs = businessObject.$attrs || {};
        nextAttrs[pfeAttrKey('risks')] = serializeRiskMetadata(importedRiskMetadata.risks);
      }

      const linkedProcessMetadata = shape.linkedProcessMetadata || {};
      if (linkedProcessMetadata.linkedProcessId || linkedProcessMetadata.linkedProcessName) {
        ensurePfeNamespace(modeler);
        const nextAttrs = businessObject.$attrs || {};

        if (linkedProcessMetadata.linkedProcessId) {
          nextAttrs[pfeAttrKey('linkedProcessId')] = String(linkedProcessMetadata.linkedProcessId);
        }

        if (linkedProcessMetadata.linkedProcessName) {
          nextAttrs[pfeAttrKey('linkedProcessName')] = String(linkedProcessMetadata.linkedProcessName);
        }
      }

      const createdShape = elementFactory.createShape({
        type: shape.type,
        businessObject,
        width: shape.width,
        height: shape.height,
        ...(isSubprocessLikeElement({ type: shape.type }) ? { isExpanded: shape.isExpanded !== false } : {}),
      });

      modeling.createShape(
        createdShape,
        {
          x: shape.x + offsetX + (shape.width / 2),
          y: shape.y + offsetY + (shape.height / 2),
        },
        root
      );

      importedShapeMap.set(shape.id, createdShape);
    });

    imported.connections.forEach((connection, index) => {
      const source = importedShapeMap.get(connection.sourceId);
      const target = importedShapeMap.get(connection.targetId);
      if (!source || !target) {
        return;
      }

      const businessObject = moddle.create('bpmn:SequenceFlow', {
        id: sanitizeId(`SequenceFlow_${timestamp}_${index + 1}`),
        name: connection.name || undefined,
      });

      modeling.createConnection(source, target, { type: 'bpmn:SequenceFlow', businessObject }, root);
    });

    const { xml: mergedXml } = await modeler.saveXML({ format: true });
    setXml(mergedXml);
    setSelectedElement(null);
    setProperties({});
    setShowImportPanel(false);
    setSelectedImportId('');
    selection.select([...importedShapeMap.values()]);
    canvas.zoom('fit-viewport');
  };

  const handleImportExisting = async () => {
    if (!selectedImportId || !onImportExisting) return;

    try {
      setImporting(true);
      const imported = await onImportExisting(selectedImportId);
      if (!imported?.xml) {
        throw new Error('This process does not contain a diagram yet.');
      }
      applyImportedDiagram(imported.xml, imported.name || process?.name || 'Process');
    } catch (importError) {
      alert(importError.message || 'Failed to import the selected diagram.');
    } finally {
      setImporting(false);
    }
  };

  const handleImportFromPc = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      const text = await file.text();
      applyImportedDiagram(text, file.name.replace(/\.[^.]+$/u, '') || process?.name || 'Process');
    } catch (importError) {
      alert(importError.message || 'Failed to import the BPMN file from this computer.');
    } finally {
      event.target.value = '';
      setImporting(false);
    }
  };

  const handleOpenSelectedLinkedProcess = async () => {
    if (!selectedLinkedProcess?.id || !onOpenLinkedProcess) {
      return;
    }

    try {
      await onOpenLinkedProcess(selectedLinkedProcess.id);
    } catch (openError) {
      alert(openError.message || 'Failed to open the called diagram.');
    }
  };

  const selectedElementRisks = Array.isArray(properties.risks) ? properties.risks : [];

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
    <div ref={mainContainerRef} className={`bpmn-modeler-container${readOnly ? ' is-read-only' : ''}`}>
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
          {canReturnToMainProcess && (
            <button onClick={handleReturnToMainProcess} className="bpmn-modeler-btn-back">
              Main: {mainProcessName}
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

      {!readOnly ? (
        <div className="bpmn-import-launcher">
          <button type="button" className="bpmn-modeler-btn-export" onClick={() => setShowImportPanel(true)}>
            Import diagram
          </button>
        </div>
      ) : null}

      {!readOnly && showImportPanel ? (
        <div className="bpmn-import-overlay">
          <div className="bpmn-import-panel">
            <div className="bpmn-import-panel__header">
              <div>
                <strong>Import diagram</strong>
                <div className="bpmn-import-panel__help">Use an existing platform diagram or a BPMN/XML file from this computer.</div>
              </div>
              <button type="button" className="bpmn-import-panel__close" onClick={() => setShowImportPanel(false)} disabled={importing}>Close</button>
            </div>

            <div className="bpmn-import-panel__section">
              <label htmlFor="bpmn-existing-import">Existing platform diagram</label>
              <select id="bpmn-existing-import" value={selectedImportId} onChange={(event) => setSelectedImportId(event.target.value)} disabled={importing}>
                <option value="">Choose a process</option>
                {importOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
              <button type="button" onClick={handleImportExisting} disabled={!selectedImportId || importing}>
                {importing ? 'Importing...' : 'Import selected diagram'}
              </button>
            </div>

            <div className="bpmn-import-panel__divider">or</div>

            <div className="bpmn-import-panel__section">
              <label>Diagram from this PC</label>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                Import from computer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".bpmn,.xml,text/xml,application/xml"
        style={{ display: 'none' }}
        onChange={handleImportFromPc}
      />

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
                    key={element.key || `${element.id}-${index}`}
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
                {(isSubprocessLikeElement(selectedElement) || isCallActivityElement(selectedElement)) ? (
                  <div className="property-field">
                    <label>Camunda Modeling</label>
                    <div className="camunda-model-card">
                      <div className="camunda-model-card__title">{properties.elementVariant || properties.type}</div>
                      {properties.displayMode ? (
                        <div className="camunda-model-card__meta">Display mode: {properties.displayMode}</div>
                      ) : null}
                      <div className="camunda-model-card__meta">
                        {isCallActivityElement(selectedElement)
                          ? 'Call activities reuse another process definition instead of embedding the flow in this diagram.'
                          : properties.displayMode === 'collapsed'
                            ? 'Collapsed subprocesses hide the inner flow on the canvas while keeping drill-down inside the same BPMN file.'
                            : 'Expanded subprocesses keep the inner flow visible and editable inside the same BPMN file.'}
                      </div>
                    </div>
                  </div>
                ) : null}
                {isCallActivityElement(selectedElement) ? (
                  <div className="property-field">
                    <label>Existing Process</label>
                    <select
                      value={selectedLinkedProcess?.id || ''}
                      onChange={(event) => handlePropertyChange('linkedProcessId', event.target.value)}
                    >
                      <option value="">No linked process</option>
                      {callActivityOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                    {selectedLinkedProcess ? (
                      <div className="call-activity-link-card">
                        <div className="call-activity-link-card__title">{selectedLinkedProcess.name}</div>
                        <div className="call-activity-link-card__meta">
                          Called element: {selectedLinkedProcess.calledElement}
                        </div>
                        {onOpenLinkedProcess && selectedLinkedProcess.id ? (
                          <button
                            type="button"
                            className="risk-action-btn risk-action-btn--primary"
                            onClick={handleOpenSelectedLinkedProcess}
                          >
                            Open called diagram
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="call-activity-link-empty">
                        Pick one of the existing processes to reuse it as a call activity.
                      </div>
                    )}
                  </div>
                ) : null}
                {isCallActivityElement(selectedElement) ? (
                  <div className="property-field">
                    <label>Called Element</label>
                    <input
                      type="text"
                      value={properties.calledElement || ''}
                      onChange={(event) => handlePropertyChange('calledElement', event.target.value)}
                      placeholder="Referenced process key..."
                    />
                  </div>
                ) : null}
                {isActorAssignableElement(selectedElement) ? (
                  <div className="property-field">
                    <label>Actor From Org Chart</label>
                    <select
                      value={properties.actorNodeId || ''}
                      disabled={actorLoading || (!!actorError && actorOptions.length === 0)}
                      onChange={(event) => handlePropertyChange('actorNodeId', event.target.value)}
                    >
                      <option value="">
                        {actorLoading ? 'Loading actors...' : actorError && actorOptions.length === 0 ? 'Actors unavailable' : 'No actor assigned'}
                      </option>
                      {actorOptions.map((actor) => (
                        <option key={actor.nodeId} value={actor.nodeId}>
                          {actor.name} {actor.title ? `- ${actor.title}` : ''}
                        </option>
                      ))}
                    </select>
                    {actorError ? (
                      <div className="actor-assignment-empty">{actorError}</div>
                    ) : selectedActor ? (
                      <div className="actor-assignment-card">
                        <div className="actor-assignment-card__title">{selectedActor.name}</div>
                        <div className="actor-assignment-card__meta">{selectedActor.subtitle || selectedActor.nodeType}</div>
                        <div className="actor-assignment-card__path">{selectedActor.path}</div>
                        <button type="button" className="actor-clear-btn" onClick={() => handlePropertyChange('actorNodeId', '')}>
                          Clear actor
                        </button>
                      </div>
                    ) : (
                      <div className="actor-assignment-empty">
                        Assign an org chart actor to keep ownership visible in the diagram.
                      </div>
                    )}
                  </div>
                ) : null}
                {isRiskAssignableElement(selectedElement) ? (
                  <div className="property-field">
                    <label>Risks</label>
                    {selectedElementRisks.length ? (
                      <div className="risk-assignment-list">
                        {selectedElementRisks.map((risk) => (
                          <div key={risk.id} className={`risk-card risk-card--${risk.severity}`}>
                            <div className="risk-card__header">
                              <span>{risk.title}</span>
                              <span className={`risk-pill risk-pill--${risk.severity}`}>{risk.severity}</span>
                            </div>
                            <div className="risk-card__meta">
                              {risk.category} · {risk.status}
                            </div>
                            {risk.description ? <div className="risk-card__text">{risk.description}</div> : null}
                            {risk.mitigation ? (
                              <div className="risk-card__text">Mitigation: {risk.mitigation}</div>
                            ) : null}
                            <div className="risk-card__actions">
                              <button type="button" className="risk-action-btn" onClick={() => startRiskEdit(risk)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                className="risk-action-btn risk-action-btn--danger"
                                onClick={() => removeRiskFromSelectedElement(risk.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="risk-empty">
                        No risks linked yet. Add one below to keep the diagram’s exposures visible.
                      </div>
                    )}
                    <div className="risk-editor">
                      <input
                        type="text"
                        value={riskDraft.title}
                        onChange={(event) => setRiskDraft((prev) => ({ ...prev, title: event.target.value }))}
                        placeholder="Risk title..."
                      />
                      <div className="risk-editor__grid">
                        <select
                          value={riskDraft.severity}
                          onChange={(event) => setRiskDraft((prev) => ({ ...prev, severity: event.target.value }))}
                        >
                          {RISK_SEVERITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={riskDraft.status}
                          onChange={(event) => setRiskDraft((prev) => ({ ...prev, status: event.target.value }))}
                        >
                          {RISK_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={riskDraft.category}
                          onChange={(event) => setRiskDraft((prev) => ({ ...prev, category: event.target.value }))}
                          className="risk-editor__grid-full"
                        >
                          {RISK_CATEGORY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        value={riskDraft.description}
                        onChange={(event) => setRiskDraft((prev) => ({ ...prev, description: event.target.value }))}
                        placeholder="Describe the risk..."
                        rows={3}
                      />
                      <textarea
                        value={riskDraft.mitigation}
                        onChange={(event) => setRiskDraft((prev) => ({ ...prev, mitigation: event.target.value }))}
                        placeholder="Mitigation or control plan..."
                        rows={3}
                      />
                      <div className="risk-card__actions">
                        <button type="button" className="risk-action-btn risk-action-btn--primary" onClick={saveRiskForSelectedElement}>
                          {editingRiskId ? 'Update risk' : 'Add risk'}
                        </button>
                        {editingRiskId ? (
                          <button type="button" className="risk-action-btn" onClick={resetRiskEditor}>
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
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
            <div className="diagram-actors-panel">
              <div className="diagram-actors-panel__title">Diagram Actors</div>
              {diagramActors.length ? (
                diagramActors.map((actor) => (
                  <div key={actor.actorNodeId} className="diagram-actor-item">
                    <div className="diagram-actor-item__header">
                      <span>{actor.actorName}</span>
                      <span>{actor.count}</span>
                    </div>
                    <div className="diagram-actor-item__meta">{actor.actorType || 'actor'}</div>
                    <div className="diagram-actor-item__path">{actor.actorPath}</div>
                    <div className="diagram-actor-item__elements">
                      {actor.elements.map((element) => element.label).join(', ')}
                    </div>
                  </div>
                ))
              ) : (
                <div className="diagram-actors-panel__empty">
                  No actors assigned yet. Create a pool, lane, or task, then choose its actor from the properties panel.
                </div>
              )}
            </div>
            <div className="diagram-risks-panel">
              <div className="diagram-actors-panel__title">Diagram Risks</div>
              {diagramRisks.length ? (
                diagramRisks.map((risk) => (
                  <div key={`${risk.elementId}-${risk.id}`} className={`diagram-risk-item diagram-risk-item--${risk.severity}`}>
                    <div className="diagram-risk-item__header">
                      <span>{risk.title}</span>
                      <span className={`risk-pill risk-pill--${risk.severity}`}>{risk.severity}</span>
                    </div>
                    <div className="diagram-risk-item__meta">
                      {risk.category} · {risk.status}
                    </div>
                    <div className="diagram-risk-item__path">{risk.elementLabel}</div>
                    {risk.description ? <div className="diagram-risk-item__body">{risk.description}</div> : null}
                    {risk.mitigation ? <div className="diagram-risk-item__body">Mitigation: {risk.mitigation}</div> : null}
                  </div>
                ))
              ) : (
                <div className="diagram-actors-panel__empty">
                  No risks added yet. Select a diagram element and register a risk from the properties panel.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BpmnEditorModeler;
