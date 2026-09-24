import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompilerModal } from '../CompilerModal';
import { ProjectProvider } from '../../context/ProjectContext';
import type { CompileResult, CompilerApi } from '../../adapters/compiler-api-adapter';

function fakeCompiler() {
  const result: CompileResult = {
    status: 'success',
    targetPlatform: 'local',
    compilationId: 'test-1-abcdef12',
    zipFilename: 'test.zip',
    downloadUrl: '/api/compiler/downloads/test-1-abcdef12/test.zip',
    outputDirectory: '/tmp/test',
    manifest: {},
    filesCount: 1,
  };
  return {
    compile: vi.fn<CompilerApi['compile']>().mockResolvedValue(result),
    getDownloadUrl: vi.fn<CompilerApi['getDownloadUrl']>().mockReturnValue('http://server/api/compiler/downloads/test-1-abcdef12/test.zip'),
  };
}

describe('CompilerModal', () => {
  it('renders modal with platform choices and handles compile', async () => {
    const handleClose = vi.fn();
    const compiler = fakeCompiler();

    render(
      <ProjectProvider>
        <CompilerModal
          isOpen={true}
          onClose={handleClose}
          compiler={compiler}
          projectName="My Test Project"
        />
      </ProjectProvider>
    );

    expect(screen.getByText(/Compile Backend/i)).toBeInTheDocument();
    expect(screen.getByText(/Local \/ Docker/i)).toBeInTheDocument();
    expect(screen.getByText(/AWS/i)).toBeInTheDocument();

    const compileBtn = screen.getByRole('button', { name: /Compile and Download/i });
    fireEvent.click(compileBtn);

    expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ targetPlatform: 'local', projectName: 'My Test Project', options: { includeCli: false } }));
  });

  it('allows selecting AWS target platform', async () => {
    const compiler = fakeCompiler();

    render(
      <ProjectProvider>
        <CompilerModal
          isOpen={true}
          onClose={() => {}}
          compiler={compiler}
          projectName="My AWS Project"
        />
      </ProjectProvider>
    );

    const awsOption = screen.getByLabelText(/AWS/i);
    fireEvent.click(awsOption);

    const compileBtn = screen.getByRole('button', { name: /Compile and Download/i });
    fireEvent.click(compileBtn);

    expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ targetPlatform: 'aws', options: { includeCli: false } }));
  });

  it('can include the optional local CLI runner', async () => {
    const compiler = fakeCompiler();
    render(
      <ProjectProvider>
        <CompilerModal isOpen={true} onClose={() => {}} compiler={compiler} projectName="CLI Project" />
      </ProjectProvider>,
    );

    fireEvent.click(screen.getByLabelText(/Include CLI runner/i));
    fireEvent.click(screen.getByRole('button', { name: /Compile and Download/i }));

    expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ targetPlatform: 'local', options: { includeCli: true } }));
  });

  it('offers the compilation download from the compiler', async () => {
    const compiler = fakeCompiler();
    render(
      <ProjectProvider>
        <CompilerModal isOpen={true} onClose={() => {}} compiler={compiler} projectName="My Test Project" />
      </ProjectProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Compile and Download/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /Download again/i })).toHaveAttribute('href', 'http://server/api/compiler/downloads/test-1-abcdef12/test.zip'));
    expect(compiler.getDownloadUrl).toHaveBeenCalledWith('test.zip', 'test-1-abcdef12');
  });
});
