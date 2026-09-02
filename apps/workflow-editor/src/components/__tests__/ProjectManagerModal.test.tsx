import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectManagerModal } from '../ProjectManagerModal';
import { ProjectProvider } from '../../context/ProjectContext';
import { HttpProjectApiAdapter } from '../../adapters/project-api-adapter';

describe('ProjectManagerModal', () => {
  const mockAdapter = new HttpProjectApiAdapter();
  vi.spyOn(mockAdapter, 'listProjects').mockImplementation(async ({ archived } = {}) => {
    if (archived) {
      return [{ id: 'p2', name: 'Fluxo Antigo', createdAt: '', updatedAt: '', archivedAt: '2026-09-02T00:00:00Z', currentWorkflowVersion: 'v1', nodeCount: 1 }];
    }
    return [{ id: 'p1', name: 'Fluxo Ativo', createdAt: '', updatedAt: '', archivedAt: null, currentWorkflowVersion: 'v1', nodeCount: 4 }];
  });

  it('renders modal with active projects and switches to trash tab', async () => {
    render(
      <ProjectProvider adapter={mockAdapter}>
        <ProjectManagerModal isOpen={true} onClose={() => {}} />
      </ProjectProvider>
    );

    expect(screen.getByText('Gerenciador de Projetos')).toBeInTheDocument();

    // Aguarda carregar o projeto ativo
    const activeProject = await screen.findByText('Fluxo Ativo');
    expect(activeProject).toBeInTheDocument();
    expect(screen.getByText('Abrir')).toBeInTheDocument();
    expect(screen.getByText('Arquivar')).toBeInTheDocument();

    // Clica na aba da lixeira
    const trashTab = screen.getByText(/Lixeira/);
    fireEvent.click(trashTab);

    const trashProject = await screen.findByText('Fluxo Antigo');
    expect(trashProject).toBeInTheDocument();
    expect(screen.getByText('Restaurar')).toBeInTheDocument();
    expect(screen.getByText('Excluir Definitivamente')).toBeInTheDocument();
  });
});
