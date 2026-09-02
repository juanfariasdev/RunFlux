import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowHeader } from '../WorkflowHeader';
import { ProjectProvider } from '../../context/ProjectContext';
import { HttpProjectApiAdapter } from '../../adapters/project-api-adapter';
import { useWorkflowStore } from '../../store/workflow-store';

describe('WorkflowHeader', () => {
  const mockAdapter = new HttpProjectApiAdapter();
  vi.spyOn(mockAdapter, 'listProjects').mockResolvedValue([]);

  it('renders project name and triggers save on button click and Ctrl+S', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    useWorkflowStore.setState({
      workflow: {
        id: 'w1',
        name: 'Meu Super Fluxo',
        nodes: [{ id: 'n1', pluginId: 'test', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
        connections: [],
      },
    });

    render(
      <ProjectProvider adapter={mockAdapter}>
        <WorkflowHeader onSave={onSave} />
      </ProjectProvider>
    );

    // Verifica renderização do nome
    expect(screen.getByTestId('current-project-name')).toHaveTextContent('Meu Super Fluxo');

    // Clica no botão Salvar
    const saveBtn = screen.getByTestId('save-project-btn');
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);

    // Dispara evento de teclado Ctrl+S
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
