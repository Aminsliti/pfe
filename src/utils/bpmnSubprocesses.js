const SUBPROCESS_PLANE_SUFFIX = '_plane';
const OPENABLE_SUBPROCESS_LOCAL_NAMES = new Set(['subProcess', 'adHocSubProcess', 'transaction']);

function parseBpmnDocument(xml) {
  if (typeof xml !== 'string' || !xml.trim().startsWith('<')) {
    return null;
  }

  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(xml, 'application/xml');
    return document.querySelector('parsererror') ? null : document;
  } catch {
    return null;
  }
}

function hasAncestorWithLocalName(node, localName) {
  let current = node?.parentElement || null;

  while (current) {
    if (current.localName === localName) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function getDisplayName(node, fallbackPrefix) {
  const explicitName = String(node?.getAttribute?.('name') || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const explicitId = String(node?.getAttribute?.('id') || '').trim();
  if (explicitId) {
    return explicitId;
  }

  return fallbackPrefix;
}

function collectOpenableSubprocesses(container, state, parentItem = null) {
  Array.from(container?.children || []).forEach((child, index) => {
    if (!OPENABLE_SUBPROCESS_LOCAL_NAMES.has(child.localName)) {
      return;
    }

    const id = String(child.getAttribute('id') || '').trim();
    if (!id) {
      return;
    }

    const fallbackName = `Sous-processus ${state.items.length + index + 1}`;
    const item = {
      id,
      name: getDisplayName(child, fallbackName),
      parentId: parentItem?.id || null,
      path: [...(parentItem?.path || []), getDisplayName(child, fallbackName)],
      childCount: 0,
      hasDrilldown: state.openableIds.has(id),
    };

    if (item.hasDrilldown) {
      state.items.push(item);
    }

    collectOpenableSubprocesses(child, state, item.hasDrilldown ? item : parentItem);
  });
}

export function toSubprocessPlaneId(subprocessId) {
  const normalized = String(subprocessId || '').trim();
  return normalized ? `${normalized}${SUBPROCESS_PLANE_SUFFIX}` : '';
}

export function getSubprocessIdFromPlaneId(planeId) {
  const normalized = String(planeId || '').trim();
  return normalized.endsWith(SUBPROCESS_PLANE_SUFFIX)
    ? normalized.slice(0, -SUBPROCESS_PLANE_SUFFIX.length)
    : null;
}

export function getBpmnSubprocesses(xml) {
  const document = parseBpmnDocument(xml);
  if (!document) {
    return [];
  }

  const openableIds = new Set(
    Array.from(document.getElementsByTagName('*'))
      .filter((node) => node.localName === 'BPMNPlane')
      .map((node) => String(node.getAttribute('bpmnElement') || '').trim())
      .filter(Boolean)
  );

  const state = { items: [], openableIds };
  const rootProcesses = Array.from(document.getElementsByTagName('*')).filter(
    (node) => node.localName === 'process' && !hasAncestorWithLocalName(node, 'process')
  );

  rootProcesses.forEach((processNode) => {
    collectOpenableSubprocesses(processNode, state, null);
  });

  const childCountByParentId = new Map();
  state.items.forEach((item) => {
    if (item.parentId) {
      childCountByParentId.set(item.parentId, (childCountByParentId.get(item.parentId) || 0) + 1);
    }
  });

  return state.items.map((item) => ({
    ...item,
    childCount: childCountByParentId.get(item.id) || 0,
    pathLabel: item.path.join(' / '),
  }));
}

export function buildBpmnSubprocessTrail(subprocesses, activeSubprocessId) {
  const activeId = String(activeSubprocessId || '').trim();
  if (!activeId) {
    return [];
  }

  const byId = new Map(subprocesses.map((subprocess) => [String(subprocess.id), subprocess]));
  const trail = [];
  let cursor = byId.get(activeId) || null;

  while (cursor) {
    trail.unshift(cursor);
    cursor = cursor.parentId ? byId.get(String(cursor.parentId)) || null : null;
  }

  return trail;
}
