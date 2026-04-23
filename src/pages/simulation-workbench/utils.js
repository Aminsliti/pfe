import { API_BASE } from '../../utils/api';

const API = API_BASE;

const DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function statusVariant(status) {
  return (
    {
      draft: 'secondary',
      running: 'warning',
      completed: 'success',
      failed: 'danger',
    }[status] || 'secondary'
  );
}

function statusLabel(status) {
  return (
    {
      draft: 'Draft',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    }[status] || status
  );
}

function fmt(value, decimals = 1, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return `${Number(value).toFixed(decimals)}${suffix}`;
}

async function readApiPayload(response, fallbackError = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      contentType.includes('application/json') ? payload?.error || fallbackError : payload || fallbackError
    );
  }

  return payload;
}

function parseWindowsText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [timeRange, daysRaw] = line.split('|').map((part) => part.trim());
      const [start, end] = String(timeRange || '').split('-').map((part) => part.trim());
      const days = daysRaw
        ? daysRaw
            .split(',')
            .map((entry) => Number(entry.trim()))
            .filter((entry) => Number.isInteger(entry))
        : undefined;

      if (!start || !end) {
        return null;
      }

      return days?.length ? { start, end, days } : { start, end };
    })
    .filter(Boolean);
}

function windowsToText(windows = []) {
  return (Array.isArray(windows) ? windows : [])
    .map((window) => `${window.start}-${window.end}${window.days?.length ? ` | ${window.days.join(',')}` : ''}`)
    .join('\n');
}

function parseHolidayText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeCalendarState(settings = {}) {
  return {
    business_hours: {
      start: settings?.business_hours?.start || '09:00',
      end: settings?.business_hours?.end || '17:00',
    },
    weekend_days: Array.isArray(settings?.weekend_days) ? settings.weekend_days : [0, 6],
    holidays: Array.isArray(settings?.holidays) ? settings.holidays : [],
    shifts: Array.isArray(settings?.shifts) ? settings.shifts : [],
  };
}

function parseBpmnGraph(source) {
  if (!source) {
    return { tasks: [], flows: [] };
  }

  try {
    const legacy = JSON.parse(source);
    return {
      tasks: (legacy.elements || [])
        .filter((element) => {
          const type = String(element.type || '');
          return type.toLowerCase().includes('task') || ['subProcess', 'adHocSubProcess', 'transaction', 'callActivity'].includes(type);
        })
        .map((element) => ({ task_id: element.id, task_name: element.label || element.name || element.id })),
      flows: (legacy.connections || []).map((flow) => ({
        flow_id: flow.id,
        flow_name: flow.label || flow.id,
        from_element: flow.from,
        to_element: flow.to,
      })),
    };
  } catch {
    const parser = new DOMParser();
    const xml = parser.parseFromString(source, 'text/xml');
    const tasks = [];

    xml.querySelectorAll('[id]').forEach((element) => {
      const tag = element.tagName.toLowerCase();

      if (!tag.includes('task') && !tag.includes('subprocess') && !tag.includes('callactivity') && !tag.includes('transaction')) {
        return;
      }

      tasks.push({
        task_id: element.getAttribute('id'),
        task_name: element.getAttribute('name') || element.getAttribute('id'),
      });
    });

    const flows = Array.from(xml.querySelectorAll('sequenceFlow,[*|sequenceFlow]')).map((flow) => ({
      flow_id: flow.getAttribute('id'),
      flow_name: flow.getAttribute('name') || flow.getAttribute('id'),
      from_element: flow.getAttribute('sourceRef'),
      to_element: flow.getAttribute('targetRef'),
    }));

    return { tasks, flows };
  }
}

export {
  API,
  DAY_OPTIONS,
  fmt,
  normalizeCalendarState,
  parseBpmnGraph,
  parseHolidayText,
  parseWindowsText,
  readApiPayload,
  statusLabel,
  statusVariant,
  windowsToText,
};
