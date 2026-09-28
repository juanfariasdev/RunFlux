import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompilerModal } from '../CompilerModal';
import * as projectContext from '../../context/ProjectContext';
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
    getDownloadUrl: vi.fn<CompilerApi['getDownloadUrl']>().mockReturnValue('/api/compiler/downloads/test-1-abcdef12/test.zip'),
    download: vi.fn<CompilerApi['download']>().mockResolvedValue(undefined),
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

  it('downloads through the compiler, automatically and again on request, so the token travels in a header (feature 015, D-15)', async () => {
    const compiler = fakeCompiler();
    render(
      <ProjectProvider>
        <CompilerModal isOpen={true} onClose={() => {}} compiler={compiler} projectName="My Test Project" />
      </ProjectProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Compile and Download/i }));

    await waitFor(() => expect(compiler.download).toHaveBeenCalledWith('test.zip', 'test-1-abcdef12'));
    fireEvent.click(screen.getByRole('button', { name: /Download again/i }));
    await waitFor(() => expect(compiler.download).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('link', { name: /Download again/i })).toBeNull();
  });

  it("sends the variables' names and descriptions, never a value (feature 015, RN-13)", async () => {
    const compiler = fakeCompiler();
    const spy = vi.spyOn(projectContext, 'useProject').mockReturnValue({
      currentProject: { id: 'p1', name: 'Orders' },
      envVars: [{ key: 'DB_URL', description: 'Orders database', hasValue: true }, { key: 'EMPTY', hasValue: false }],
    } as never);
    render(<CompilerModal isOpen={true} onClose={() => {}} compiler={compiler} projectName="Orders" />);
    fireEvent.click(screen.getByRole('button', { name: /Compile and Download/i }));
    await waitFor(() => expect(compiler.compile).toHaveBeenCalled());
    expect(compiler.compile.mock.calls[0][0].workflow.settings?.envVars).toEqual([{ key: 'DB_URL', description: 'Orders database' }, { key: 'EMPTY' }]);
    spy.mockRestore();
  });
});
