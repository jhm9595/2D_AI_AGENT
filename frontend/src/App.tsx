import React, { useState, useEffect } from 'react';
import { useAgentSocket } from './hooks/useAgentSocket';
import { OfficeCanvas } from './canvas/OfficeCanvas';
import { TerminalPanel } from './components/TerminalPanel';
import { AgentManagerModal, type RegistryAgent } from './components/AgentManagerModal';
import { ExecutiveMeetingBoard, type MeetingData, type DecisionItem } from './components/ExecutiveMeetingBoard';
import {
  Sparkles,
  Activity,
  Layers,
  Users,
  FolderOpen,
  Key,
  FileCode,
  RefreshCw,
  Send,
  UserPlus,
  RotateCcw,
  ExternalLink,
  FolderCheck,
  Gamepad2,
  X,
  Play,
  CheckCircle,
  AlertCircle,
  Loader2,
  Briefcase,
  FileText,
  Database,
  FolderGit2,
  ChevronRight,
  FolderPlus,
  Plus,
  Trash2
} from 'lucide-react';

export interface ProjectArtifactFile {
  name: string;
  relPath: string;
  subpath: string;
  size: number;
  updatedAt: string;
  projectId: string;
}

export interface ProjectData {
  id: string;
  name: string;
  description: string;
  category: string;
  entrypoint: string;
  createdAt: string;
  updatedAt: string;
  projectPath?: string;
  files: {
    apps: ProjectArtifactFile[];
    docs: ProjectArtifactFile[];
    data: ProjectArtifactFile[];
    others: ProjectArtifactFile[];
  };
}

export default function App() {
  const wsUrl = `ws://${window.location.hostname}:4000/ws/agent-events`;
  const { agents, logs, connected, workflowStatus, setWorkflowStatus, setAgents, setLogs } = useAgentSocket(wsUrl);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

  // API Key 테스트 상태
  const [testStatus, setTestStatus] = useState<{ loading: boolean; success?: boolean; message?: string; geminiReply?: string } | null>(null);

  // 등록된 전체 에이전트 목록
  const [registryAgents, setRegistryAgents] = useState<RegistryAgent[]>([]);
  const [assignedAgentId, setAssignedAgentId] = useState<string>('agent-lead');

  // 회의 및 대표자 의사결정 상태
  const [meetingData, setMeetingData] = useState<MeetingData | null>(null);
  const [pendingDecisions, setPendingDecisions] = useState<DecisionItem[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<DecisionItem[]>([]);

  // 워크스페이스에 생성된 산출물 파일 및 프로젝트 목록
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; size: number; updatedAt: string }>>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedFileContent, setSelectedFileContent] = useState<{ name: string; content: string; fullPath?: string } | null>(null);

  // 신규 프로젝트 생성 모달 및 대상 프로젝트 선택 상태
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string>(''); // '' = 자동 감지
  const [newProjectForm, setNewProjectForm] = useState({
    id: '',
    name: '',
    description: '',
    category: 'game',
    template: 'canvas_game'
  });

  // 실시간 대화형 앱/게임 플레이어 모달 (iframe 프리뷰)
  const [activePlayUrl, setActivePlayUrl] = useState<string | null>(null);
  const [activePlayTitle, setActivePlayTitle] = useState<string>('');
  const [activePlayFilename, setActivePlayFilename] = useState<string>('');

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;

  const fetchRegistryAgents = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/agents/list');
      const data = await res.json();
      if (data.agents) setRegistryAgents(data.agents);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMeetingState = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/meeting/state');
      const data = await res.json();
      if (data) {
        setMeetingData(data.meeting);
        setPendingDecisions(data.pendingDecisions || []);
        setDecisionHistory(data.decisionHistory || []);
        if (data.workflowStatus) {
          setWorkflowStatus(data.workflowStatus);
          if (!data.workflowStatus.running) {
            setAgents((prev) =>
              prev.map((a) =>
                a.status === 'thinking' || a.status === 'typing'
                  ? { ...a, status: 'idle', currentTool: undefined }
                  : a
              )
            );
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchWorkspaceFiles = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/workspace/files');
      const data = await res.json();
      if (data.files) setWorkspaceFiles(data.files);
      if (data.projects) setProjects(data.projects);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRegistryAgents();
    fetchMeetingState();
    fetchWorkspaceFiles();
    if (userApiKey && userApiKey.trim()) {
      fetch('http://localhost:4000/api/gemini/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: userApiKey.trim() })
      }).catch(() => {});
    }
    const interval = setInterval(() => {
      fetchMeetingState();
      fetchWorkspaceFiles();
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleSaveApiKey = (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    setTestStatus(null);
  };

  // 실제 Gemini API 호출 테스트 실행
  const handleTestApiKey = async () => {
    if (!userApiKey.trim()) {
      setTestStatus({ loading: false, success: false, message: 'API 키를 먼저 입력해주세요.' });
      return;
    }
    setTestStatus({ loading: true });
    try {
      const res = await fetch('http://localhost:4000/api/gemini/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: userApiKey.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus({
          loading: false,
          success: true,
          message: data.message,
          geminiReply: data.geminiReply
        });
      } else {
        setTestStatus({
          loading: false,
          success: false,
          message: data.message || 'API 키가 유효하지 않거나 호출에 실패했습니다.'
        });
      }
    } catch (err) {
      setTestStatus({
        loading: false,
        success: false,
        message: '백엔드 서버와 통신 중 에러가 발생했습니다.'
      });
    }
  };

  // 대표자 결재 결정 하달 (Non-blocking HITL)
  const handleResolveDecision = async (decisionId: string, chosenOptionId: string) => {
    try {
      await fetch('http://localhost:4000/api/meeting/resolve-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionId, chosenOptionId, apiKey: userApiKey || undefined })
      });
      await fetchMeetingState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetOffice = async () => {
    try {
      await fetch('http://localhost:4000/api/office/reset', { method: 'POST' });
      setAgents([]);
      setLogs([]);
      setSelectedAgentId(null);
      await fetchMeetingState();
    } catch (err) {
      console.error(err);
    }
  };

  // Windows 폴더 열기 (특정 프로젝트 폴더 지정 지원)
  const handleOpenFolder = async (projId?: string) => {
    try {
      const targetProj = projId || (selectedProjectId !== 'all' ? selectedProjectId : undefined);
      await fetch('http://localhost:4000/api/workspace/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: targetProj })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // 기본 프로그램으로 파일 열기 (프로젝트 상대경로 지원)
  const handleLaunchFile = async (pathOrName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await fetch('http://localhost:4000/api/workspace/launch-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathOrName })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // 대시보드 안에서 실시간 게임/웹앱 실행 (캐시 방지 타임스탬프 포함)
  const handlePlayGame = (relPathOrName: string, title?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActivePlayFilename(relPathOrName);
    setActivePlayUrl(
      `http://localhost:4000/api/workspace/file?path=${encodeURIComponent(relPathOrName)}&render=html&t=${Date.now()}`
    );
    setActivePlayTitle(title || relPathOrName);
  };

  const handleOpenNewProjectModal = () => {
    setNewProjectForm({
      id: '',
      name: '',
      description: '',
      category: 'game',
      template: 'canvas_game'
    });
    setIsNewProjectModalOpen(true);
  };

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectForm.name.trim()) {
      alert('프로젝트 명칭을 입력해 주세요.');
      return;
    }
    setCreatingProject(true);
    try {
      const res = await fetch('http://localhost:4000/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProjectForm)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '프로젝트 생성에 실패했습니다.');
      }
      setIsNewProjectModalOpen(false);
      await fetchWorkspaceFiles();
      if (data.project?.id) {
        setSelectedProjectId(data.project.id);
        setTargetProjectId(data.project.id);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleDeleteProject = async (projId: string, projName: string) => {
    if (!window.confirm(`[${projName}] 프로젝트를 정말 삭제하시겠습니까?\n모든 산출물과 문서 파일이 영구 삭제됩니다.`)) {
      return;
    }
    try {
      const res = await fetch(`http://localhost:4000/api/projects/${projId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '프로젝트 삭제에 실패했습니다.');
      }
      if (selectedProjectId === projId) {
        setSelectedProjectId('all');
      }
      if (targetProjectId === projId) {
        setTargetProjectId('');
      }
      await fetchWorkspaceFiles();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    }
  };

  const handleRunAgentTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim()) return;

    try {
      setLoadingAction(true);
      await fetch('http://localhost:4000/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptInput,
          apiKey: userApiKey || undefined,
          assignedAgentId,
          targetProjectId: targetProjectId || undefined
        })
      });
      setPromptInput('');
      setTimeout(() => {
        fetchMeetingState();
        fetchWorkspaceFiles();
      }, 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleViewFile = async (pathOrName: string) => {
    try {
      const res = await fetch(`http://localhost:4000/api/workspace/file?path=${encodeURIComponent(pathOrName)}`);
      const data = await res.json();
      setSelectedFileContent(data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* 상단 네비게이션 헤더 */}
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-wide flex items-center gap-2">
              2D 픽셀 에이전트 자율 오피스
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30 flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                경영진 의사결정 파이프라인
              </span>
            </h1>
            <p className="text-xs text-slate-400">자율 회의 • 비동기 의사결정(Non-blocking HITL) • 순차 분배 개발</p>
          </div>
        </div>

        {/* 연결 상태 및 제어 버튼 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-slate-300 font-sans">{connected ? '서버 연결됨' : '연결 끊김'}</span>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-300 font-bold">{agents.length}명</span>
            <span className="text-slate-400 font-sans">근무 중</span>
          </div>

          <button
            onClick={() => setShowAgentModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/50 transition cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>AI 에이전트 관리</span>
          </button>

          <button
            onClick={() => setShowKeyInput(!showKeyInput)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition cursor-pointer font-sans ${
              userApiKey
                ? 'bg-purple-950/60 border-purple-700 text-purple-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>{userApiKey ? 'Gemini 키 등록됨' : 'Gemini 키'}</span>
          </button>

          <button
            onClick={handleResetOffice}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold rounded-md border border-rose-800/80 transition active:scale-95 cursor-pointer"
            title="현재 화면의 모든 에이전트를 초기화하고 깨끗한 오피스로 리셋합니다."
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            오피스 초기화
          </button>
        </div>
      </header>

      {/* Gemini API 키 검증 & 입력 패널 */}
      {showKeyInput && (
        <div className="bg-slate-950 border-b border-indigo-900/60 p-5 px-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-indigo-300 flex items-center gap-2">
              <Key className="w-3.5 h-3.5" />
              <span>Google Gemini API 키 검증 및 등록</span>
            </label>
            <button
              onClick={() => setShowKeyInput(false)}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1 bg-slate-800 rounded border border-slate-700 cursor-pointer"
            >
              닫기
            </button>
          </div>

          <div className="flex gap-2 max-w-2xl">
            <input
              type="password"
              value={userApiKey}
              onChange={(e) => handleSaveApiKey(e.target.value)}
              placeholder="AIzaSy... 형식의 API 키를 입력하세요"
              className="flex-1 bg-slate-900 border border-indigo-900/70 rounded px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleTestApiKey}
              disabled={testStatus?.loading || !userApiKey.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {testStatus?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>실제 API 호출 테스트</span>
            </button>
          </div>

          {testStatus && (
            <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 max-w-2xl ${
              testStatus.success 
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200' 
                : 'bg-rose-950/60 border-rose-800 text-rose-200'
            }`}>
              {testStatus.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-bold">{testStatus.message}</div>
                {testStatus.geminiReply && (
                  <div className="text-[11px] text-emerald-300 font-mono bg-emerald-900/40 px-2 py-1 rounded">
                    Gemini 실제 응답: "{testStatus.geminiReply}"
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 메인 작업 화면 */}
      <main className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 max-w-[1600px] w-full mx-auto">
        {/* 좌측 (8열): 2D 오피스 맵 & 지시 입력창 & 📋 경영진 의사결정 보드 */}
        <div className="xl:col-span-8 flex flex-col gap-5">
          {/* 2D 오피스 평면도 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-xl flex flex-col items-center">
            <div className="w-full flex items-center justify-between pb-3 mb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-300 tracking-wider">
                  2D 가상 오피스 평면도 (중앙 회의 테이블 구비)
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                지시를 내리면 에이전트들이 중앙 회의 테이블로 모여 토론하고, 결재 상신 후 각자 책상으로 흩어져 개발합니다.
              </span>
            </div>

            <OfficeCanvas
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              hoveredAgentId={hoveredAgentId}
              setHoveredAgentId={setHoveredAgentId}
            />

            {/* 범례 표시 */}
            <div className="w-full flex flex-wrap items-center justify-center gap-6 mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span>생각/회의 토론 (?)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span>도구/코딩 타이핑 (⚙)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span>작업 완료/휴식 (z)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span>걸어가는 중</span>
              </div>
            </div>
          </div>

          {/* 🌟 1. 경영진 의사결정 & 실시간 회의 브리핑 보드 (핵심 UI) */}
          <ExecutiveMeetingBoard
            meeting={meetingData}
            pendingDecisions={pendingDecisions}
            decisionHistory={decisionHistory}
            onResolveDecision={handleResolveDecision}
          />

          {/* 에이전트 직접 지시 컨트롤러 */}
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 shadow-xl flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200">
                  대표자 업무 지시 (CEO Task Dispatcher)
                </span>
              </div>
              <div className="flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">대상 프로젝트:</span>
                  <select
                    value={targetProjectId}
                    onChange={(e) => {
                      if (e.target.value === '__NEW_PROJECT__') {
                        handleOpenNewProjectModal();
                      } else {
                        setTargetProjectId(e.target.value);
                        if (e.target.value && e.target.value !== '') {
                          setSelectedProjectId(e.target.value);
                        }
                      }
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-amber-300 font-bold focus:outline-none focus:border-amber-500 cursor-pointer max-w-[200px] truncate"
                  >
                    <option value="">🎯 자동 감지 (PM Router)</option>
                    {projects.map((p) => {
                      const isCore = p.id === 'core_system' || (p as any).isCoreSystem;
                      return (
                        <option key={p.id} value={p.id}>
                          {isCore ? '⚡ [코어시스템]' : `📁 ${p.name || p.id}`}
                        </option>
                      );
                    })}
                    <option value="__NEW_PROJECT__">➕ [+ 새 프로젝트 추가...]</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">총괄 지시 대상:</span>
                  <select
                    value={assignedAgentId}
                    onChange={(e) => setAssignedAgentId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-indigo-300 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {registryAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <form onSubmit={handleRunAgentTask} className="flex gap-3 pt-1">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="예: '한국의 술 도감 게임 완성해줘', '2D 러닝 액션 게임 만들어줘' 등 입력하세요..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loadingAction || !promptInput.trim()}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-lg shadow-lg shadow-indigo-600/30 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                작업 지시하기
              </button>
            </form>
          </div>
        </div>

        {/* 우측 (4열): 터미널 로그 스트림 & 산출물 파일 보관함 */}
        <div className="xl:col-span-4 flex flex-col gap-4">
          <TerminalPanel
            selectedAgent={selectedAgent}
            logs={logs}
            allAgents={agents}
            onSelectAgent={setSelectedAgentId}
            workflowStatus={workflowStatus}
          />

          {/* 🗂️ 프로젝트별 산출물 보관함 (Project Artifacts Hub) */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-xl flex flex-col gap-3">
            {/* 상단 헤더 */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">
                  프로젝트별 산출물 보관함
                </span>
                <span className="text-[10px] bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded font-mono">
                  {projects.length}개 프로젝트 ({workspaceFiles.length}개 파일)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenNewProjectModal}
                  className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-white bg-emerald-950/70 hover:bg-emerald-900/80 px-2.5 py-1 rounded border border-emerald-700/60 transition cursor-pointer font-bold shadow-sm shadow-emerald-950/50"
                  title="새로운 프로젝트 추가하기"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>+ 새 프로젝트</span>
                </button>
                <button
                  onClick={() => handleOpenFolder(selectedProjectId !== 'all' ? selectedProjectId : undefined)}
                  className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-white bg-indigo-950/60 hover:bg-indigo-900/80 px-2.5 py-1 rounded border border-indigo-700/60 transition cursor-pointer"
                  title={selectedProjectId !== 'all' ? `선택된 [${selectedProjectId}] 프로젝트 폴더를 탐색기로 열기` : '전체 워크스페이스 폴더 열기'}
                >
                  <FolderCheck className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{selectedProjectId !== 'all' ? '이 프로젝트 폴더 열기' : '탐색기 열기'}</span>
                </button>
                <button
                  onClick={fetchWorkspaceFiles}
                  className="text-slate-500 hover:text-slate-300 transition cursor-pointer p-1"
                  title="새로고침"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 프로젝트 선택 탭 (Project Selector) - 🌟 코어시스템 무조건 맨 앞 배치 */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button
                onClick={() => setSelectedProjectId('all')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                  selectedProjectId === 'all'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                전체 프로젝트 ({projects.length})
              </button>
              {projects.map((proj) => {
                const isCore = proj.id === 'core_system' || (proj as any).isCoreSystem;
                const isSelected = selectedProjectId === proj.id;

                return (
                  <button
                    key={proj.id}
                    onClick={() => setSelectedProjectId(proj.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? isCore
                          ? 'bg-purple-600 text-white shadow-md shadow-purple-600/40 ring-1 ring-purple-400'
                          : 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                        : isCore
                        ? 'bg-purple-950/70 text-purple-300 hover:text-white border border-purple-800/80'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    <span>{isCore ? '⚡' : '📁'}</span>
                    <span>{proj.name || proj.id}</span>
                    {isCore && (
                      <span className="text-[9px] bg-purple-500 text-white font-bold px-1 py-0.2 rounded font-sans">
                        코어
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                onClick={handleOpenNewProjectModal}
                className="px-2.5 py-1 rounded-md text-[11px] font-bold text-emerald-400 hover:text-emerald-200 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-800/60 transition shrink-0 flex items-center gap-1 cursor-pointer"
                title="신규 프로젝트 추가"
              >
                <Plus className="w-3 h-3" />
                <span>프로젝트 추가</span>
              </button>
            </div>

            {/* 프로젝트 목록 및 하위 문서/앱 뷰어 */}
            {projects.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center">
                아직 생성된 프로젝트가 없습니다. 좌측에서 새 프로젝트나 게임 개발을 지시해보세요!
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[460px] overflow-y-auto pr-1">
                {(selectedProjectId === 'all' ? projects : projects.filter((p) => p.id === selectedProjectId)).map((proj) => {
                  const isCore = proj.id === 'core_system' || (proj as any).isCoreSystem;

                  return (
                    <div
                      key={proj.id}
                      className={`rounded-lg border p-3 flex flex-col gap-2.5 transition ${
                        isCore
                          ? 'border-purple-800/70 bg-purple-950/20 hover:border-purple-600/80 shadow-lg shadow-purple-950/30'
                          : 'border-slate-800/90 bg-slate-900/60 hover:border-slate-700'
                      }`}
                    >
                      {/* 프로젝트 요약 헤더 */}
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div className="truncate mr-2">
                          <div className={`text-xs font-bold flex items-center gap-1.5 truncate ${isCore ? 'text-purple-300' : 'text-amber-300'}`}>
                            <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-normal ${isCore ? 'bg-purple-900/60 text-purple-200 border border-purple-700/60' : 'bg-slate-800 text-slate-400'}`}>
                              {isCore ? '코어시스템' : proj.id}
                            </span>
                            <span>{proj.name}</span>
                            {isCore && (
                              <span className="text-[9px] bg-purple-600 text-white font-bold px-1.5 py-0.2 rounded">
                                자체 진화 & 유지보수
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {proj.description}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              setTargetProjectId(proj.id);
                              setSelectedProjectId(proj.id);
                              setPromptInput(`[${proj.name}] `);
                              const inputEl = document.querySelector('input[type="text"]') as HTMLInputElement;
                              if (inputEl) inputEl.focus();
                            }}
                            className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 shrink-0 cursor-pointer ${
                              isCore
                                ? 'border-purple-600/70 text-purple-300 hover:text-white bg-purple-900/40 hover:bg-purple-900/70'
                                : 'border-indigo-700/70 text-indigo-300 hover:text-white bg-indigo-950/60 hover:bg-indigo-900/70'
                            }`}
                            title="이 프로젝트에 업무 지시하기"
                          >
                            <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                            <span>작업 지시</span>
                          </button>
                          <button
                            onClick={() => handleOpenFolder(proj.id)}
                            className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 shrink-0 cursor-pointer ${
                              isCore
                                ? 'border-purple-700 text-purple-300 hover:text-white bg-purple-950/80 hover:bg-purple-900'
                                : 'border-slate-700/80 text-slate-400 hover:text-amber-300 bg-slate-900'
                            }`}
                            title={isCore ? '2D_AI_AGENT 프로그램 소스코드 전체 폴더 열기' : '이 프로젝트 폴더만 탐색기로 열기'}
                          >
                            <FolderOpen className={`w-3 h-3 ${isCore ? 'text-purple-400' : 'text-amber-400'}`} />
                            <span>{isCore ? '소스코드 폴더' : '폴더 열기'}</span>
                          </button>
                          {!isCore && (
                            <button
                              onClick={() => handleDeleteProject(proj.id, proj.name)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-red-900/60 text-red-400 hover:text-white hover:bg-red-900/60 bg-red-950/30 transition flex items-center gap-1 cursor-pointer"
                              title="프로젝트 삭제"
                            >
                              <Trash2 className="w-2.5 h-2.5 text-red-400" />
                              <span>삭제</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 1. 🎮 실행 웹앱 / 게임 (Apps) */}
                      {proj.files.apps && proj.files.apps.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <div className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                            <Gamepad2 className={`w-3.5 h-3.5 ${isCore ? 'text-purple-400' : 'text-amber-400'}`} />
                            <span>{isCore ? '가동 중인 플랫폼 시스템' : '실행 웹앱 / 게임'}</span>
                          </div>
                          {proj.files.apps.map((app) => (
                            <div
                              key={app.relPath}
                              className={`flex items-center justify-between p-2 rounded border transition ${
                                isCore
                                  ? 'bg-purple-950/30 border-purple-600/40 hover:bg-purple-950/50'
                                  : 'bg-amber-950/20 border-amber-500/40 hover:bg-amber-950/30'
                              }`}
                            >
                              <div
                                onClick={() => isCore ? window.open('http://localhost:5173', '_blank') : handleViewFile(app.relPath)}
                                className="flex items-center gap-2 truncate flex-1 cursor-pointer mr-2"
                              >
                                <FileCode className={`w-3.5 h-3.5 shrink-0 ${isCore ? 'text-purple-400' : 'text-amber-400'}`} />
                                <div className="truncate">
                                  <div className={`text-xs font-mono font-bold truncate flex items-center gap-1.5 ${isCore ? 'text-purple-200' : 'text-amber-200'}`}>
                                    <span>{app.name}</span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded font-sans ${isCore ? 'bg-emerald-500 text-slate-950' : 'bg-amber-500 text-slate-950'}`}>
                                      {isCore ? '실시간 가동 중' : '실행 가능'}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {isCore ? 'Vite HMR 무중단 핫 리로드 지원' : `${(app.size / 1024).toFixed(1)} KB • ${new Date(app.updatedAt).toLocaleTimeString()}`}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {!isCore && (
                                  <button
                                    onClick={(e) => handlePlayGame(app.relPath, proj.name, e)}
                                    className="text-[11px] font-bold text-amber-300 hover:text-white px-2.5 py-1 bg-amber-600/40 hover:bg-amber-600 rounded border border-amber-500/60 transition flex items-center gap-1 cursor-pointer"
                                    title="대시보드 안에서 즉시 실행"
                                  >
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>실행하기</span>
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    if (isCore) {
                                      if (e) e.stopPropagation();
                                      window.open('http://localhost:5173', '_blank');
                                    } else {
                                      handleLaunchFile(app.relPath, e);
                                    }
                                  }}
                                  className={`text-[11px] hover:text-white px-2 py-1 rounded border transition flex items-center gap-1 cursor-pointer ${
                                    isCore
                                      ? 'bg-purple-900/60 text-purple-200 hover:bg-purple-600 border-purple-700'
                                      : 'bg-slate-800 text-slate-400 hover:bg-indigo-600 border-slate-700'
                                  }`}
                                  title="새 창으로 열기"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>창 열기</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 2. 📋 기획 및 아키텍처 문서 (docs/) */}
                      {proj.files.docs && proj.files.docs.length > 0 && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5 text-indigo-400" />
                            <span>기획 & 아키텍처 문서 (docs/)</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {proj.files.docs.map((doc) => {
                              const isPrd = doc.name.includes('PRD');
                              const isWbs = doc.name.includes('WBS');
                              const isSec = doc.name.includes('SECURITY');
                              const isQa = doc.name.includes('QA');

                              return (
                                <div
                                  key={doc.relPath}
                                  onClick={() => handleViewFile(doc.relPath)}
                                  className="flex items-center justify-between p-2 rounded bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition cursor-pointer"
                                >
                                  <div className="flex items-center gap-1.5 truncate flex-1 mr-1">
                                    <FileText className={`w-3.5 h-3.5 shrink-0 ${isPrd ? 'text-purple-400' : isWbs ? 'text-blue-400' : isSec ? 'text-rose-400' : isQa ? 'text-emerald-400' : 'text-indigo-400'}`} />
                                    <div className="truncate">
                                      <div className="text-[11px] font-mono font-bold text-slate-200 truncate flex items-center gap-1">
                                        <span>{doc.name}</span>
                                        <span className={`text-[9px] px-1 py-0.2 rounded font-sans ${isPrd ? 'bg-purple-950 text-purple-300' : isWbs ? 'bg-blue-950 text-blue-300' : isSec ? 'bg-rose-950 text-rose-300' : isQa ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                                          {isPrd ? '기획서' : isWbs ? 'WBS' : isSec ? '보안감사' : isQa ? 'QA성적서' : '문서'}
                                        </span>
                                      </div>
                                      <div className="text-[9px] text-slate-500">
                                        {(doc.size / 1024).toFixed(1)} KB
                                      </div>
                                    </div>
                                  </div>
                                  <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 3. 🗄️ 데이터 & 스키마 (data/) */}
                      {proj.files.data && proj.files.data.length > 0 && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                            <Database className="w-3.5 h-3.5 text-emerald-400" />
                            <span>데이터 & 스키마 (data/)</span>
                          </div>
                          {proj.files.data.map((dat) => (
                            <div
                              key={dat.relPath}
                              onClick={() => handleViewFile(dat.relPath)}
                              className="flex items-center justify-between p-2 rounded bg-slate-950/80 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900 transition cursor-pointer"
                            >
                              <div className="flex items-center gap-1.5 truncate flex-1 mr-1">
                                <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <div className="truncate">
                                  <div className="text-[11px] font-mono font-bold text-emerald-300 truncate flex items-center gap-1">
                                    <span>{dat.name}</span>
                                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1 py-0.2 rounded font-sans">
                                      DBA DDL
                                    </span>
                                  </div>
                                  <div className="text-[9px] text-slate-500">
                                    {(dat.size / 1024).toFixed(1)} KB
                                  </div>
                                </div>
                              </div>
                              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 실시간 게임 플레이어 모달 */}
      {activePlayUrl && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-slate-950 border-2 border-indigo-500/60 rounded-2xl max-w-lg w-full h-[92vh] max-h-[860px] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <Gamepad2 className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-xs truncate max-w-xs">{activePlayTitle}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLaunchFile(activePlayFilename || activePlayTitle)}
                  className="text-xs text-indigo-300 hover:text-white px-2.5 py-1 bg-indigo-950/80 rounded border border-indigo-700 flex items-center gap-1 cursor-pointer"
                  title="새 브라우저 탭으로 크게 열기"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>새 탭</span>
                </button>
                <button
                  onClick={() => setActivePlayUrl(null)}
                  className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 cursor-pointer"
                  title="닫기"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-950 relative flex justify-center items-center overflow-hidden">
              <iframe
                key={activePlayUrl}
                src={activePlayUrl}
                className="w-full h-full border-none"
                title="AI Agent Generated Web App"
              />
            </div>
          </div>
        </div>
      )}

      {/* 에이전트 채용/추가 모달 */}
      <AgentManagerModal
        isOpen={showAgentModal}
        onClose={() => setShowAgentModal(false)}
        registryAgents={registryAgents}
        onRefresh={fetchRegistryAgents}
      />

      {/* 산출물 내용 확인 모달 */}
      {selectedFileContent && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-slate-950 border border-slate-700 rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900 rounded-t-xl">
              <div className="flex items-center gap-2.5 text-sm text-slate-200">
                <FileCode className="w-4 h-4 text-indigo-400" />
                <span className="font-mono font-bold text-indigo-300">{selectedFileContent.name}</span>
                <span className="text-xs text-slate-400">
                  (위치: {selectedFileContent.fullPath || selectedFileContent.name})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLaunchFile((selectedFileContent as any).relPath || selectedFileContent.name)}
                  className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white px-3 py-1 bg-indigo-950 rounded border border-indigo-700 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>내 컴퓨터 프로그램으로 열기</span>
                </button>
                <button
                  onClick={() => setSelectedFileContent(null)}
                  className="text-slate-400 hover:text-white text-xs px-3 py-1 bg-slate-800 rounded border border-slate-700 cursor-pointer"
                >
                  닫기
                </button>
              </div>
            </div>
            <pre className="p-5 font-mono text-xs text-slate-200 overflow-auto flex-1 bg-slate-950 select-text leading-relaxed whitespace-pre-wrap">
              {selectedFileContent.content}
            </pre>
          </div>
        </div>
      )}

      {/* 🚀 신규 프로젝트 생성 모달 */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            {/* 모달 헤더 */}
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">신규 프로젝트 추가</h3>
                  <p className="text-[11px] text-slate-400">
                    새로운 애플리케이션 또는 게임 프로젝트 워크스페이스를 즉시 생성합니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 모달 폼 */}
            <form onSubmit={handleCreateProjectSubmit} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  프로젝트 명칭 <span className="text-emerald-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newProjectForm.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    const autoSlug = val
                      .toLowerCase()
                      .replace(/[^a-z0-9\s_-]/g, '')
                      .replace(/\s+/g, '_');
                    setNewProjectForm((prev) => ({
                      ...prev,
                      name: val,
                      id: prev.id === '' || prev.id === autoSlug.slice(0, -1) ? autoSlug : prev.id
                    }));
                  }}
                  placeholder="예: 2D 벽돌깨기 게임, 주식 모의투자 앱, 할일 매니저"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    프로젝트 식별자 (ID) <span className="text-slate-500 font-normal">(영문/숫자/_)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newProjectForm.id}
                    onChange={(e) =>
                      setNewProjectForm({
                        ...newProjectForm,
                        id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
                      })
                    }
                    placeholder="예: breakout_game"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs font-mono text-emerald-300 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    분류 카테고리
                  </label>
                  <select
                    value={newProjectForm.category}
                    onChange={(e) => setNewProjectForm({ ...newProjectForm, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="game">🎮 2D 웹 게임</option>
                    <option value="web">🌐 웹 서비스/앱</option>
                    <option value="tool">🛠️ 유틸리티/데이터 도구</option>
                    <option value="etc">📦 기타 프로젝트</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  초기 스타터 템플릿
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setNewProjectForm({ ...newProjectForm, template: 'canvas_game' })}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      newProjectForm.template === 'canvas_game'
                        ? 'border-emerald-500 bg-emerald-950/40 text-white shadow-sm shadow-emerald-950/60'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <span>🎮</span> 2D Canvas 게임
                    </span>
                    <span className="text-[10px] text-slate-400">
                      HTML5 Canvas 렌더 루프 및 인터랙션 스타터
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewProjectForm({ ...newProjectForm, template: 'webapp' })}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      newProjectForm.template === 'webapp'
                        ? 'border-emerald-500 bg-emerald-950/40 text-white shadow-sm shadow-emerald-950/60'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <span>🌐</span> 인터랙티브 웹앱
                    </span>
                    <span className="text-[10px] text-slate-400">
                      반응형 대시보드 카드 및 컴포넌트 스타터
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  프로젝트 개요 및 목적
                </label>
                <textarea
                  rows={2}
                  value={newProjectForm.description}
                  onChange={(e) => setNewProjectForm({ ...newProjectForm, description: e.target.value })}
                  placeholder="에이전트들이 구현해야 할 프로젝트의 핵심 목표나 요구사항을 간단히 적어주세요."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              {/* 액션 버튼 */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800 mt-1">
                <button
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={creatingProject || !newProjectForm.name.trim()}
                  className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-md shadow-emerald-600/30 transition cursor-pointer"
                >
                  {creatingProject ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>생성 중...</span>
                    </>
                  ) : (
                    <>
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>프로젝트 생성</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
