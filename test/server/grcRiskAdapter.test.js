/** @jest-environment node */

import {
  filterGrcRisks,
  normalizeGrcRiskPayload,
  resolveRiskSeverity,
} from '../../server/services/grc/grcRiskAdapter.js';

describe('grcRiskAdapter', () => {
  it('normalizes V-GRC risk payloads into BPMN risk entries', () => {
    const [risk] = normalizeGrcRiskPayload({
      success: true,
      data: {
        riskID: 'RISK_1',
        name: 'Physical security risk',
        current_state: 'Risk Created',
        residualRisk: 72,
        risk_non_conformite: true,
        controls: [{ name: 'Access review' }],
      },
    });

    expect(risk).toMatchObject({
      remoteId: 'RISK_1',
      title: 'Physical security risk',
      severity: 'high',
      category: 'compliance',
      status: 'open',
      remoteStatus: 'Risk Created',
      mitigation: 'Access review',
      controlCount: 1,
      source: 'v-grc',
    });
  });

  it('falls back to label-based severity and filters by search text', () => {
    expect(resolveRiskSeverity({ residualRiskLabel: 'Moyen' })).toBe('medium');

    const risks = normalizeGrcRiskPayload({
      data: [
        { riskID: 'RISK_A', name: 'Cyber incident', residualRiskLabel: 'Moyen' },
        { riskID: 'RISK_B', name: 'Supplier failure', residualRiskLabel: 'Faible' },
      ],
    });

    expect(filterGrcRisks(risks, 'cyber')).toHaveLength(1);
    expect(filterGrcRisks(risks, 'RISK_B')[0].title).toBe('Supplier failure');
  });
});
