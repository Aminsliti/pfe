import { getBpmnSubprocesses } from './bpmnSubprocesses';

describe('bpmnSubprocesses', () => {
  it('returns openable ad-hoc subprocesses when a drill-down plane exists', () => {
    const subprocesses = getBpmnSubprocesses(`
      <bpmn:definitions
        xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI">
        <bpmn:process id="Process_1">
          <bpmn:adHocSubProcess id="AdHoc_1" name="Reusable Cluster" />
          <bpmn:subProcess id="Sub_1" name="Embedded Review" />
        </bpmn:process>
        <bpmndi:BPMNDiagram id="Diagram_1">
          <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1" />
        </bpmndi:BPMNDiagram>
        <bpmndi:BPMNDiagram id="Diagram_AdHoc">
          <bpmndi:BPMNPlane id="AdHoc_1_plane" bpmnElement="AdHoc_1" />
        </bpmndi:BPMNDiagram>
      </bpmn:definitions>
    `);

    expect(subprocesses).toEqual([
      expect.objectContaining({
        id: 'AdHoc_1',
        name: 'Reusable Cluster',
        hasDrilldown: true,
      }),
    ]);
  });
});
