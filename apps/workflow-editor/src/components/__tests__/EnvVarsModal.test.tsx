import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvVarsModal } from '../EnvVarsModal';
import * as projectContext from '../../context/ProjectContext';

/** The variables screen is write-only (011-env-vars-secrets, 015 RF-11). */
describe('EnvVarsModal', () => {
  const mockSaveEnvVars = vi.fn().mockResolvedValue(undefined);
  const mockOnClose = vi.fn();

  const defaultProjectContext: any = {
    currentProject: { id: 'p1', name: 'Demo Project', workflow: { nodes: [], connections: [] } },
    envVars: [
      { key: 'API_SECRET', description: 'API Key', hasValue: true },
      { key: 'OPTIONAL', hasValue: false },
      { key: 'OLD_SECRET', hasValue: true, unreadable: true },
    ],
    saveEnvVars: mockSaveEnvVars,
  };

  beforeEach(() => {
    mockSaveEnvVars.mockClear();
    vi.spyOn(projectContext, 'useProject').mockReturnValue(defaultProjectContext);
  });

  const save = () => fireEvent.click(screen.getByRole('button', { name: /Salvar Variáveis/i }));

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<EnvVarsModal isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows each name, description and whether it has a value, never the value', () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Environment Variables')).toBeInTheDocument();
    expect(screen.getByText('Demo Project')).toBeInTheDocument();
    expect(screen.getByDisplayValue('API_SECRET')).toBeInTheDocument();
    expect(screen.getByDisplayValue('API Key')).toBeInTheDocument();
    expect(screen.getByTestId('env-status-API_SECRET')).toHaveTextContent('definido');
    expect(screen.getByTestId('env-status-OPTIONAL')).toHaveTextContent('não definido');
    expect(screen.getByTestId('env-status-OLD_SECRET')).toHaveTextContent('ilegível');
    for (const key of ['API_SECRET', 'OPTIONAL', 'OLD_SECRET']) {
      const field = screen.getByLabelText(`Novo valor de ${key}`) as HTMLInputElement;
      expect([field.type, field.value]).toEqual(['password', '']);
    }
  });

  it('sends a value only for the variable the developer changed', async () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.change(screen.getByLabelText('Novo valor de OLD_SECRET'), { target: { value: 'typed-again' } });
    save();
    await waitFor(() => expect(mockSaveEnvVars).toHaveBeenCalledWith([
      { key: 'API_SECRET', description: 'API Key' },
      { key: 'OPTIONAL' },
      { key: 'OLD_SECRET', value: 'typed-again' },
    ]));
  });

  it('clears a value by sending empty text', async () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar valor de API_SECRET' }));
    expect(screen.getByTestId('env-status-API_SECRET')).toHaveTextContent('será limpo');
    save();
    await waitFor(() => expect(mockSaveEnvVars.mock.calls[0][0][0]).toEqual({ key: 'API_SECRET', description: 'API Key', value: '' }));
  });

  it('adds a new variable with its value in a hidden field', async () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.change(screen.getByPlaceholderText('EX: STRIPE_API_KEY'), { target: { value: 'DATABASE_URL' } });
    const value = screen.getByPlaceholderText('sk_test_...') as HTMLInputElement;
    expect(value.type).toBe('password');
    fireEvent.change(value, { target: { value: 'postgres://localhost/db' } });
    fireEvent.change(screen.getByPlaceholderText('Finalidade da chave'), { target: { value: 'Database URI' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar Variável/i }));

    expect(screen.getByDisplayValue('DATABASE_URL')).toBeInTheDocument();
    expect(screen.getByTestId('env-status-DATABASE_URL')).toHaveTextContent('será definido');
    save();
    await waitFor(() => expect(mockSaveEnvVars.mock.calls[0][0][3]).toEqual({ key: 'DATABASE_URL', description: 'Database URI', value: 'postgres://localhost/db' }));
  });

  it('rejects invalid variable identifier format', () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.change(screen.getByPlaceholderText('EX: STRIPE_API_KEY'), { target: { value: '123-INVALID-KEY' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar Variável/i }));
    expect(screen.getByText(/Nome da variável deve conter apenas letras/i)).toBeInTheDocument();
  });

  it('removes a variable and saves the rest', async () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getAllByTitle('Remover variável')[0]);
    expect(screen.queryByDisplayValue('API_SECRET')).toBeNull();
    save();
    await waitFor(() => expect(mockSaveEnvVars).toHaveBeenCalledWith([{ key: 'OPTIONAL' }, { key: 'OLD_SECRET' }]));
  });

  it('says that values are never shown again and that compiled projects get placeholders', () => {
    render(<EnvVarsModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.queryByText(/Valores são gerados no/)).toBeNull();
    expect(screen.getByText(/nunca são exibidos de novo/)).toBeInTheDocument();
    expect(screen.getByText(/placeholders vazios/)).toBeInTheDocument();
  });
});
