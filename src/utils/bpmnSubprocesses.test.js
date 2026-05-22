/* global describe, it, expect */

import { getBpmnSubprocesses } from './bpmnSubprocesses';

describe('getBpmnSubprocesses', () => {
  it('recognizes transaction and ad-hoc subprocess drilldown planes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:transaction id="Transaction_1" name="Payment Transaction">
      <bpmn:adHocSubProcess id="AdHoc_1" name="Manual Review" />
    </bpmn:transaction>
    <bpmn:subProcess id="SubProcess_1" name="Standard Sub Process" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_Process_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_Transaction_1">
    <bpmndi:BPMNPlane id="Plane_Transaction_1" bpmnElement="Transaction_1" />
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_AdHoc_1">
    <bpmndi:BPMNPlane id="Plane_AdHoc_1" bpmnElement="AdHoc_1" />
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_SubProcess_1">
    <bpmndi:BPMNPlane id="Plane_SubProcess_1" bpmnElement="SubProcess_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    expect(getBpmnSubprocesses(xml)).toEqual([
      expect.objectContaining({
        id: 'Transaction_1',
        name: 'Payment Transaction',
        parentId: null,
        childCount: 1,
        pathLabel: 'Payment Transaction',
      }),
      expect.objectContaining({
        id: 'AdHoc_1',
        name: 'Manual Review',
        parentId: 'Transaction_1',
        childCount: 0,
        pathLabel: 'Payment Transaction / Manual Review',
      }),
      expect.objectContaining({
        id: 'SubProcess_1',
        name: 'Standard Sub Process',
        parentId: null,
        childCount: 0,
        pathLabel: 'Standard Sub Process',
      }),
    ]);
  });
});
