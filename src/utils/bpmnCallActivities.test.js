import { extractBpmnProcessReference, getBpmnCallActivities } from './bpmnCallActivities';

describe('bpmnCallActivities', () => {
  it('extracts the top-level process reference from BPMN XML', () => {
    expect(
      extractBpmnProcessReference(`
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="Claims_Process" name="Claims Process" />
        </bpmn:definitions>
      `)
    ).toEqual({
      processId: 'Claims_Process',
      processName: 'Claims Process',
    });
  });

  it('extracts call activities and their linked process metadata', () => {
    expect(
      getBpmnCallActivities(`
        <bpmn:definitions
          xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
          xmlns:pfe="https://pfe.local/schema/bpmn">
          <bpmn:process id="Parent_Process">
            <bpmn:callActivity
              id="Call_1"
              name="Open Child"
              calledElement="Child_Process"
              pfe:linkedProcessId="42"
              pfe:linkedProcessName="Child Process" />
          </bpmn:process>
        </bpmn:definitions>
      `)
    ).toEqual([
      {
        id: 'Call_1',
        name: 'Open Child',
        calledElement: 'Child_Process',
        linkedProcessId: '42',
        linkedProcessName: 'Child Process',
      },
    ]);
  });
});
