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
  Briefcase
} from 'lucide-react';

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

  // 워크스페이스에 생성된 산출물 파일 목록
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; size: number; updatedAt: string }>>([]);
  const [selectedFileContent, setSelectedFileContent] = useState<{ name: string; content: string; fullPath?: string } | null>(null);

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

  // Windows 폴더 열기
  const handleOpenFolder = async () => {
    try {
      await fetch('http://localhost:4000/api/workspace/open-folder', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  // 기본 프로그램으로 파일 열기
  const handleLaunchFile = async (name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await fetch('http://localhost:4000/api/workspace/launch-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // 대시보드 안에서 실시간 게임/웹앱 실행 (캐시 방지 타임스탬프 포함)
  const handlePlayGame = (filename: string, title?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActivePlayFilename(filename);
    setActivePlayUrl(`http://localhost:4000/api/workspace/file?name=${encodeURIComponent(filename)}&render=html&t=${Date.now()}`);
    setActivePlayTitle(title || filename);
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
          assignedAgentId
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

  const handleViewFile = async (name: string) => {
    try {
      const res = await fetch(`http://localhost:4000/api/workspace/file?name=${encodeURIComponent(name)}`);
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200">
                  대표자 업무 지시 (CEO Task Dispatcher)
                </span>
              </div>
              <div className="flex items-center gap-2">
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

          {/* 에이전트 작업 산출물 파일 보관함 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">
                  에이전트 실제 산출물 보관함
                </span>
                <span className="text-[10px] bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded font-mono">
                  {workspaceFiles.length}개
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenFolder}
                  className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-white bg-indigo-950/60 hover:bg-indigo-900/80 px-2 py-1 rounded border border-indigo-700/60 transition cursor-pointer"
                  title="내 컴퓨터 탐색기로 결과물 폴더 직접 열기"
                >
                  <FolderCheck className="w-3.5 h-3.5 text-indigo-400" />
                  <span>탐색기 열기</span>
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

            {workspaceFiles.length === 0 ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                아직 생성된 파일이 없습니다. 좌측에서 작업을 지시해보세요!
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                {workspaceFiles.map((file, idx) => {
                  const isHtmlApp = file.name.endsWith('.html');

                  return (
                    <div
                      key={file.name}
                      onClick={() => handleViewFile(file.name)}
                      className={`flex items-center justify-between p-2.5 rounded bg-slate-900 hover:bg-slate-800 text-left border transition cursor-pointer ${
                        isHtmlApp ? 'border-amber-500/50 bg-amber-950/15' : idx === 0 ? 'border-indigo-500/50 bg-indigo-950/20' : 'border-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate flex-1 mr-2">
                        {isHtmlApp ? (
                          <Gamepad2 className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <FileCode className={`w-4 h-4 shrink-0 ${idx === 0 ? 'text-indigo-400' : 'text-slate-400'}`} />
                        )}
                        <div className="truncate">
                          <div className="text-xs font-mono text-slate-200 font-bold truncate flex items-center gap-1.5">
                            {file.name}
                            {isHtmlApp && (
                              <span className="text-[9px] bg-amber-500 text-slate-950 font-bold px-1.5 py-0.5 rounded">
                                실행 가능 웹앱
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {new Date(file.updatedAt).toLocaleTimeString()} • {(file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isHtmlApp && (
                          <button
                            onClick={(e) => handlePlayGame(file.name, file.name, e)}
                            className="text-[11px] font-bold text-amber-300 hover:text-white px-2.5 py-1 bg-amber-600/40 hover:bg-amber-600 rounded border border-amber-500/60 transition flex items-center gap-1 cursor-pointer"
                            title="대시보드 안에서 즉시 실행하기"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>실행하기</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => handleLaunchFile(file.name, e)}
                          className="text-[11px] text-slate-400 hover:text-white px-2 py-1 bg-slate-800 hover:bg-indigo-600 rounded border border-slate-700 transition flex items-center gap-1 cursor-pointer"
                          title="새 브라우저 창으로 크게 열기"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>창 열기</span>
                        </button>
                      </div>
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
                  onClick={() => handleLaunchFile(selectedFileContent.name)}
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
    </div>
  );
}
