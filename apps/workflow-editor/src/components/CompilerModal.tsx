import { useState } from 'react';
import { useProject } from '../context/ProjectContext';
import { useWorkflowStore } from '../store/workflow-store';
import { HttpCompilerApiAdapter, type TargetPlatform } from '../adapters/compiler-api-adapter';
import { Button } from './ui/button';

export interface CompilerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompile?: (platform: TargetPlatform) => Promise<any>;
  projectName?: string;
}

export function CompilerModal({ isOpen, onClose, onCompile, projectName }: CompilerModalProps) {
  const { currentProject, envVars } = useProject();
  const workflow = useWorkflowStore((s) => s.workflow);

  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>('local');
  const [skipTests, setSkipTests] = useState(true);
  const [status, setStatus] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any[] | null>(null);
  const [resultData, setResultData] = useState<any | null>(null);

  if (!isOpen) return null;

  const effectiveProjectName = projectName || currentProject?.name || workflow.name || 'RunFlux-Backend';

  const handleCompileClick = async () => {
    setStatus('compiling');
    setErrorMessage(null);
    setErrorDetails(null);
    try {
      let res;
      if (onCompile) {
        res = await onCompile(targetPlatform);
      } else {
        const adapter = new HttpCompilerApiAdapter();
        const workflowWithSettings = {
          ...workflow,
          settings: {
            ...workflow.settings,
            envVars: envVars || [],
          },
        };
        res = await adapter.compile({
          workflow: workflowWithSettings,
          targetPlatform,
          projectName: effectiveProjectName,
          skipTests,
        });
      }
      setResultData(res);
      setStatus('success');

      if (res?.downloadUrl) {
        const downloadHref = res.downloadUrl.startsWith('http')
          ? res.downloadUrl
          : `http://localhost:3001${res.downloadUrl}`;
        const link = document.createElement('a');
        link.href = downloadHref;
        link.download = res.zipFilename || `${effectiveProjectName}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || 'Project compilation failed.');
      if (Array.isArray(err.details)) {
        setErrorDetails(err.details);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span>⚡</span> Compile Backend
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Turn your visual workflow into a runnable backend with source code and infrastructure.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Target Platform Selector */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Target Platform
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* Local / Docker */}
              <label
                htmlFor="target-local"
                className={`relative flex flex-col p-4 rounded-lg border cursor-pointer transition-all ${
                  targetPlatform === 'local'
                    ? 'border-indigo-500 bg-indigo-500/10 shadow-sm'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white flex items-center gap-2">
                    🐳 Local / Docker
                  </span>
                  <input
                    type="radio"
                    id="target-local"
                    name="platform"
                    value="local"
                    checked={targetPlatform === 'local'}
                    onChange={() => setTargetPlatform('local')}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Express + TypeScript + Dockerfile ready to run in containers or locally.
                </p>
              </label>

              {/* AWS */}
              <label
                htmlFor="target-aws"
                className={`relative flex flex-col p-4 rounded-lg border cursor-pointer transition-all ${
                  targetPlatform === 'aws'
                    ? 'border-indigo-500 bg-indigo-500/10 shadow-sm'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white flex items-center gap-2">
                    ☁️ AWS
                  </span>
                  <input
                    type="radio"
                    id="target-aws"
                    name="platform"
                    value="aws"
                    checked={targetPlatform === 'aws'}
                    onChange={() => setTargetPlatform('aws')}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Lambda Handler + Cloud CDK / Serverless ready for cloud deployment.
                </p>
              </label>
            </div>
          </div>

          {/* Compilation Options */}
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-3.5 space-y-2">
            <div className="text-xs text-slate-300 flex items-center justify-between">
              <span className="text-slate-400">Active project:</span>
              <span className="font-semibold text-white">{effectiveProjectName}</span>
            </div>
            <div className="text-xs text-slate-300 flex items-center justify-between">
              <span className="text-slate-400">Workflow nodes:</span>
              <span className="font-semibold text-white">{workflow.nodes.length} nodes</span>
            </div>
            <div className="pt-2 border-t border-slate-800/60 flex items-center gap-2">
              <input
                type="checkbox"
                id="skip-tests-checkbox"
                checked={skipTests}
                onChange={(e) => setSkipTests(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="skip-tests-checkbox" className="text-xs text-slate-300 cursor-pointer">
                Compile even without running prior tests
              </label>
            </div>
          </div>

          {/* Status Feedback */}
          {status === 'compiling' && (
            <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-lg p-3 text-xs text-indigo-300 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span>Compiling workflow for <strong>{targetPlatform.toUpperCase()}</strong> and generating .zip package...</span>
            </div>
          )}

          {status === 'success' && resultData && (
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3.5 text-xs text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-200">
                <span>✓</span> Compilation completed successfully!
              </div>
              <p className="text-slate-300 text-[11px]">
                The backend folder was created at:
                <br />
                <code className="text-emerald-300 bg-emerald-950/80 px-1 py-0.5 rounded text-[10px] break-all">
                  {resultData.outputDirectory}
                </code>
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-400 text-[11px]">File: {resultData.zipFilename}</span>
                {resultData.downloadUrl && (
                  <a
                    href={
                      resultData.downloadUrl.startsWith('http')
                        ? resultData.downloadUrl
                        : `http://localhost:3001${resultData.downloadUrl}`
                    }
                    download={resultData.zipFilename}
                    className="text-indigo-400 hover:text-indigo-300 underline font-medium"
                  >
                    Download again (.zip)
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'error' && errorMessage && (
            <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-3 text-xs text-rose-300 flex items-start gap-2">
              <span className="text-sm">⚠️</span>
              <div>
                <p className="font-semibold text-rose-200">Compilation failed:</p>
                <p className="mt-0.5 text-rose-300 text-[11px]">{errorMessage}</p>
                {errorDetails && errorDetails.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-semibold text-rose-200">Nodes without support for target platform {targetPlatform}:</p>
                    <ul className="list-disc list-inside text-[10px] text-rose-300">
                      {errorDetails.map((node: any, idx: number) => (
                        <li key={idx}>
                          Plugin <strong className="text-white">{node.pluginId}</strong> (Node ID: {node.nodeId})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-800 bg-slate-900/50">
          <Button variant="ghost" onClick={onClose} disabled={status === 'compiling'}>
            Close
          </Button>
          <Button
            variant="default"
            onClick={handleCompileClick}
            disabled={status === 'compiling'}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
          >
            {status === 'compiling' ? 'Compiling...' : 'Compile and Download'}
          </Button>
        </div>
      </div>
    </div>
  );
}
