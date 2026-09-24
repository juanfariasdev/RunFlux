import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnvVarsModal } from '../EnvVarsModal';
import * as projectContext from '../../context/ProjectContext';

describe('EnvVarsModal (011-env-vars-secrets)', () => {
  const mockSaveEnvVars = vi.fn().mockResolvedValue(undefined);
  const mockOnClose = vi.fn();

  const defaultProjectContext: any = {
    currentProject: { id: 'p1', name: 'Demo Project', workflow: { nodes: [], connections: [] } },
    envVars: [
      { key: 'API_SECRET', value: 'secret123', description: 'API Key' },
    ],
    saveEnvVars: mockSaveEnvVars,
  };

  it('renders nothing when isOpen is false', () => {
    vi.spyOn(projectContext, 'useProject').mockReturnValue(defaultProjectContext);
    const { container } = render(<EnvVarsModal isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with existing variables when isOpen is true', () => {
    vi.spyOn(projectContext, 'useProject').mockReturnValue(defaultProjectContext);
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText('Environment Variables')).toBeInTheDocument();
    expect(screen.getByText('Demo Project')).toBeInTheDocument();
    expect(screen.getByDisplayValue('API_SECRET')).toBeInTheDocument();
    expect(screen.getByDisplayValue('secret123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('API Key')).toBeInTheDocument();
  });

  it('adds a new environment variable to the table', async () => {
    vi.spyOn(projectContext, 'useProject').mockReturnValue(defaultProjectContext);
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);

    const inputs = screen.getAllByRole('textbox');
    const keyInput = inputs.find((i) => i.getAttribute('placeholder') === 'EX: STRIPE_API_KEY')!;
    const valInput = inputs.find((i) => i.getAttribute('placeholder') === 'sk_test_...')!;
    const descInput = inputs.find((i) => i.getAttribute('placeholder') === 'Finalidade da chave')!;

    fireEvent.change(keyInput, { target: { value: 'DATABASE_URL' } });
    fireEvent.change(valInput, { target: { value: 'postgres://localhost/db' } });
    fireEvent.change(descInput, { target: { value: 'Database URI' } });

    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar Variável/i }));

    expect(screen.getByDisplayValue('DATABASE_URL')).toBeInTheDocument();
    expect(screen.getByDisplayValue('postgres://localhost/db')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Database URI')).toBeInTheDocument();
  });

  it('rejects invalid variable identifier format', () => {
    vi.spyOn(projectContext, 'useProject').mockReturnValue(defaultProjectContext);
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);

    const inputs = screen.getAllByRole('textbox');
    const keyInput = inputs.find((i) => i.getAttribute('placeholder') === 'EX: STRIPE_API_KEY')!;

    fireEvent.change(keyInput, { target: { value: '123-INVALID-KEY' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar Variável/i }));

    expect(screen.getByText(/Nome da variável deve conter apenas letras/i)).toBeInTheDocument();
  });

  it('removes a variable and saves updated list', async () => {
    vi.spyOn(projectContext, 'useProject').mockReturnValue(defaultProjectContext);
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);

    const removeBtn = screen.getByTitle('Remover variável');
    fireEvent.click(removeBtn);

    expect(screen.queryByDisplayValue('API_SECRET')).toBeNull();

    const saveBtn = screen.getByRole('button', { name: /Salvar Variáveis/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockSaveEnvVars).toHaveBeenCalledWith([]);
    });
  });
});
