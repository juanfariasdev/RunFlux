import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompilerModal } from '../CompilerModal';
import { ProjectProvider } from '../../context/ProjectContext';

describe('CompilerModal', () => {
  it('renders modal with platform choices and handles compile', async () => {
    const handleClose = vi.fn();
    const handleCompile = vi.fn().mockResolvedValue({
      status: 'success',
      downloadUrl: '/api/compiler/downloads/test.zip',
      zipFilename: 'test.zip',
    });

    render(
      <ProjectProvider>
        <CompilerModal
          isOpen={true}
          onClose={handleClose}
          onCompile={handleCompile}
          projectName="Meu Projeto Teste"
        />
      </ProjectProvider>
    );

    expect(screen.getByText(/Compilar Backend/i)).toBeInTheDocument();
    expect(screen.getByText(/Local \/ Docker/i)).toBeInTheDocument();
    expect(screen.getByText(/AWS/i)).toBeInTheDocument();

    const compileBtn = screen.getByRole('button', { name: /Compilar e Baixar/i });
    fireEvent.click(compileBtn);

    expect(handleCompile).toHaveBeenCalledWith('local');
  });

  it('allows selecting AWS target platform', async () => {
    const handleCompile = vi.fn().mockResolvedValue({
      status: 'success',
      downloadUrl: '/api/compiler/downloads/test.zip',
      zipFilename: 'test.zip',
    });

    render(
      <ProjectProvider>
        <CompilerModal
          isOpen={true}
          onClose={() => {}}
          onCompile={handleCompile}
          projectName="Meu Projeto AWS"
        />
      </ProjectProvider>
    );

    const awsOption = screen.getByLabelText(/AWS/i);
    fireEvent.click(awsOption);

    const compileBtn = screen.getByRole('button', { name: /Compilar e Baixar/i });
    fireEvent.click(compileBtn);

    expect(handleCompile).toHaveBeenCalledWith('aws');
  });
});
