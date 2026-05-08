import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BpmnEditor from './BpmnEditor';

describe('BpmnEditor', () => {
  it('renders a saved diagram and serializes it on save', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(
      <BpmnEditor
        process={{
          name: 'Claims Review',
          bpmn_xml: JSON.stringify({
            elements: [
              { id: 'Task_1', type: 'userTask', x: 100, y: 100, w: 130, h: 66, label: 'Review Claim' },
            ],
            connections: [],
          }),
        }}
        onSave={onSave}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Claims Review')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByText(/1 shapes/i)).toBeInTheDocument();
    expect(screen.getByText('Review Claim')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload).toContain('"label":"Review Claim"');
  });
});
