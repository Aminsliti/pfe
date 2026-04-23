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

function hasProcessAncestor(node) {
  let current = node?.parentElement || null;

  while (current) {
    if (current.localName === 'process') {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function getNodeName(node, fallback = '') {
  return String(node?.getAttribute?.('name') || '').trim() || fallback;
}

export function extractBpmnProcessReference(xml, fallbackName = 'Process', fallbackId = 'Process_1') {
  const document = parseBpmnDocument(xml);
  if (!document) {
    return {
      processId: String(fallbackId || 'Process_1').trim() || 'Process_1',
      processName: String(fallbackName || fallbackId || 'Process').trim() || 'Process',
    };
  }

  const processNode = Array.from(document.getElementsByTagName('*')).find(
    (node) => node.localName === 'process' && !hasProcessAncestor(node)
  ) || Array.from(document.getElementsByTagName('*')).find((node) => node.localName === 'process');

  const processId = String(processNode?.getAttribute?.('id') || fallbackId || 'Process_1').trim() || 'Process_1';
  const processName = getNodeName(processNode, fallbackName || processId || 'Process');

  return {
    processId,
    processName,
  };
}

export function getBpmnCallActivities(xml) {
  const document = parseBpmnDocument(xml);
  if (!document) {
    return [];
  }

  return Array.from(document.getElementsByTagName('*'))
    .filter((node) => node.localName === 'callActivity')
    .map((node, index) => {
      const attrs = node.getAttributeNames().reduce((all, attrName) => {
        all[attrName] = node.getAttribute(attrName) || '';
        return all;
      }, {});

      const id = String(node.getAttribute('id') || '').trim() || `CallActivity_${index + 1}`;
      const calledElement = String(node.getAttribute('calledElement') || '').trim();
      const linkedProcessId = String(attrs['pfe:linkedProcessId'] || '').trim();
      const linkedProcessName = String(attrs['pfe:linkedProcessName'] || '').trim();

      return {
        id,
        name: getNodeName(node, linkedProcessName || calledElement || id),
        calledElement,
        linkedProcessId,
        linkedProcessName,
      };
    });
}
