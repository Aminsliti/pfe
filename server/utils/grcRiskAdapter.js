const DEFAULT_GRC_API_BASE_URL = 'http://localhost:5001/api';

const FRENCH_LABEL_SEVERITY = new Map([
  ['tres faible', 'low'],
  ['très faible', 'low'],
  ['faible', 'low'],
  ['moyen', 'medium'],
  ['moyenne', 'medium'],
  ['eleve', 'high'],
  ['élevé', 'high'],
  ['elevee', 'high'],
  ['élevée', 'high'],
  ['critique', 'critical'],
]);

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

export function getGrcApiBaseUrl() {
  return String(process.env.GRC_API_BASE_URL || DEFAULT_GRC_API_BASE_URL).replace(/\/+$/u, '');
}

export function resolveRiskSeverity(risk = {}) {
  const residualRisk = Number(risk.residualRisk);
  if (Number.isFinite(residualRisk)) {
    if (residualRisk >= 75) return 'critical';
    if (residualRisk >= 50) return 'high';
    if (residualRisk >= 25) return 'medium';
    return 'low';
  }

  const label = normalizeText(risk.residualRiskLabel || risk.inherentRiskLabel || risk.impactLabel);
  return FRENCH_LABEL_SEVERITY.get(label) || 'medium';
}

function resolveRiskStatus(value = '') {
  const normalized = normalizeText(value);
  if (normalized.includes('accept')) return 'accepted';
  if (normalized.includes('mitig')) return 'mitigated';
  if (normalized.includes('monitor')) return 'monitoring';
  return 'open';
}

export function normalizeGrcRisk(rawRisk = {}, index = 0) {
  const remoteId = String(rawRisk.riskID || rawRisk.id || rawRisk.code || `grc-risk-${index + 1}`);
  const controls = toArray(rawRisk.controls);
  const actionPlans = toArray(rawRisk.actionPlans);
  const primaryControl = controls[0] || null;
  const primaryActionPlan = actionPlans[0] || null;
  const mitigation = primaryControl?.executionProcedure ||
    primaryControl?.comment ||
    primaryControl?.name ||
    primaryActionPlan?.name ||
    rawRisk.mitigatingActionPlan ||
    '';

  return {
    id: remoteId,
    remoteId,
    title: String(rawRisk.name || rawRisk.title || `GRC Risk ${index + 1}`).trim(),
    code: String(rawRisk.code || ''),
    severity: resolveRiskSeverity(rawRisk),
    category: rawRisk.risk_non_conformite ? 'compliance' : 'operational',
    status: resolveRiskStatus(rawRisk.current_state || rawRisk.status),
    remoteStatus: String(rawRisk.current_state || rawRisk.status || ''),
    description: String(rawRisk.comment || rawRisk.description || rawRisk.residualRiskLabel || ''),
    mitigation: String(mitigation || ''),
    residualRisk: rawRisk.residualRisk ?? null,
    inherentRisk: rawRisk.inherentRisk ?? null,
    residualRiskLabel: rawRisk.residualRiskLabel || '',
    inherentRiskLabel: rawRisk.inherentRiskLabel || '',
    impactLabel: rawRisk.impactLabel || '',
    probabilityLabel: rawRisk.probabilityLabel || '',
    riskTypeId: rawRisk.riskTypeID || null,
    businessProcessId: rawRisk.businessProcessID || null,
    organizationalProcessId: rawRisk.organizationalProcessID || null,
    actionPlanCount: actionPlans.length,
    controlCount: controls.length,
    source: 'v-grc',
  };
}

export function normalizeGrcRiskPayload(payload = {}) {
  const data = payload?.data ?? payload;
  return toArray(data).map(normalizeGrcRisk);
}

export function filterGrcRisks(risks = [], search = '') {
  const normalizedSearch = normalizeText(search);
  if (!normalizedSearch) return risks;

  return risks.filter((risk) =>
    [
      risk.title,
      risk.remoteId,
      risk.code,
      risk.status,
      risk.category,
      risk.description,
      risk.residualRiskLabel,
      risk.inherentRiskLabel,
    ]
      .map(normalizeText)
      .some((value) => value.includes(normalizedSearch))
  );
}
