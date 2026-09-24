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
          projectName="My Test Project"
        />
      </ProjectProvider>
    );

    expect(screen.getByText(/Compile Backend/i)).toBeInTheDocument();
    expect(screen.getByText(/Local \/ Docker/i)).toBeInTheDocument();
    expect(screen.getByText(/AWS/i)).toBeInTheDocument();

    const compileBtn = screen.getByRole('button', { name: /Compile and Download/i });
    fireEvent.click(compileBtn);

    expect(handleCompile).toHaveBeenCalledWith('local', { includeCli: false });
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
          projectName="My AWS Project"
        />
      </ProjectProvider>
    );

    const awsOption = screen.getByLabelText(/AWS/i);
    fireEvent.click(awsOption);

    const compileBtn = screen.getByRole('button', { name: /Compile and Download/i });
    fireEvent.click(compileBtn);

    expect(handleCompile).toHaveBeenCalledWith('aws', { includeCli: false });
  });

  it('can include the optional local CLI runner', async () => {
    const handleCompile = vi.fn().mockResolvedValue({ status: 'success' });
    render(
      <ProjectProvider>
        <CompilerModal isOpen={true} onClose={() => {}} onCompile={handleCompile} projectName="CLI Project" />
      </ProjectProvider>,
    );

    fireEvent.click(screen.getByLabelText(/Include CLI runner/i));
    fireEvent.click(screen.getByRole('button', { name: /Compile and Download/i }));

    expect(handleCompile).toHaveBeenCalledWith('local', { includeCli: true });
  });
});
