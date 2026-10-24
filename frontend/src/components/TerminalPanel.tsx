import React from 'react';
import type { AgentState } from '../types';
import type { WorkflowStatus } from '../hooks/useAgentSocket';
import { Terminal, Cpu, CheckCircle, AlertCircle, Wrench, Loader2, Radio } from 'lucide-react';

interface TerminalPanelProps {
  selectedAgent: AgentState | null;
  logs: Array<{ id: string; timestamp: number; agentId?: string; agentName: string; type: string; message: string; isHeartbeat?: boolean }>;
  allAgents: AgentState[];
  onSelectAgent: (id: string | null) => void;
  workflowStatus?: WorkflowStatus;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  selectedAgent,
  logs,
  allAgents,
  onSelectAgent,
  workflowStatus
}) => {
  const filteredLogs = selectedAgent
    ? logs.filter(
        (l) =>
          l.agentName === selectedAgent.name ||
          l.agentName === selectedAgent.id ||
          l.agentId === selectedAgent.id
      )
    : logs;

  const isServerRunning = Boolean(workflowStatus?.running);

  const translateStatus = (status: string) => {
    // 서버에서 실행 중인 세션이 없는데 클라이언트에 thinking/typing이 남아있다면 '대기 / 작업 완료'로 표시
    if (!isServerRunning && (status === 'thinking' || status === 'typing')) {
      return '대기 / 작업 완료 (진행 중인 작업 없음)';
    }
    switch (status) {
      case 'typing':
        return '작업 및 도구 실행 중 (실제 파일/도구 제어 중)';
      case 'thinking':
        return 'AI 추론 및 분석 중 (Gemini API 응답 대기)';
      case 'idle':
        return '대기 / 작업 완료';
      case 'walk':
        return '오피스 내 이동 중';
      case 'terminated':
        return '퇴근 / 종료됨';
      default:
        return status;
    }
  };

  return (
    <div className="flex flex-col h-[560px] bg-slate-950 border-2 border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Header & Agent Selector */}
      <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-emerald-400" />
          <span className="font-bold text-sm text-slate-200">
            {selectedAgent ? `${selectedAgent.name} 에이전트 콘솔` : '전체 에이전트 실시간 로그 스트림'}
          </span>
        </div>
        {selectedAgent && (
          <button
            onClick={() => onSelectAgent(null)}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded border border-slate-700 cursor-pointer"
          >
            전체 로그 보기
          </button>
        )}
      </div>

      {/* 📡 실시간 백엔드 AI 엔진 작동 감지 표시줄 (멈춤 vs 작동 즉시 판별) */}
      <div
        className={`px-3.5 py-2.5 border-b text-xs flex flex-col gap-1 transition-colors ${
          workflowStatus?.lastError
            ? 'bg-rose-950/70 border-rose-800 text-rose-200'
            : isServerRunning
            ? 'bg-indigo-950/80 border-indigo-700/80 text-indigo-100'
            : 'bg-slate-900/90 border-slate-800 text-slate-400'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold">
            {workflowStatus?.lastError ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : isServerRunning ? (
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
            ) : (
              <Radio className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <span>
              {workflowStatus?.lastError
                ? `엔진 오류 감지: ${workflowStatus.stage}`
                : isServerRunning
                ? `🟢 실제 엔진 작동 중: ${workflowStatus?.stage || '작업 처리 중'}`
                : `⚪ 엔진 대기 중 (현재 진행 중인 작업 없음)`}
            </span>
          </div>
          {isServerRunning && (
            <span className="text-[11px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full animate-pulse shrink-0">
              {workflowStatus?.elapsedSec ?? 0}초 경과
            </span>
          )}
        </div>
        {(isServerRunning || workflowStatus?.lastError) && workflowStatus?.detail && (
          <div className="text-[11px] font-mono text-slate-300 pl-6 truncate">
            {workflowStatus.detail}
          </div>
        )}
      </div>

      {/* Agent Quick Switch Bar */}
      <div className="bg-slate-900/60 px-3 py-2 border-b border-slate-800 flex gap-2 overflow-x-auto">
        <button
          onClick={() => onSelectAgent(null)}
          className={`px-2.5 py-1 rounded text-xs transition-all cursor-pointer shrink-0 ${
            !selectedAgent
              ? 'bg-blue-600/30 text-blue-400 border border-blue-500/50 font-bold'
              : 'text-slate-400 hover:bg-slate-800'
          }`}
        >
          전체
        </button>
        {allAgents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(agent.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all cursor-pointer shrink-0 ${
              selectedAgent?.id === agent.id
                ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 font-bold'
                : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: agent.avatarColor }}
            />
            {agent.name}
          </button>
        ))}
      </div>

      {/* Selected Agent State Card */}
      {selectedAgent && (
        <div className="p-3 bg-slate-900/80 border-b border-slate-800 flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-400">
                직책/역할: <span className="text-slate-200 font-medium">{selectedAgent.role}</span>
              </div>
              <div className="text-slate-400 mt-0.5 flex items-center gap-1.5">
                <span>현재 상태:</span>
                <span
                  className={`font-bold ${
                    !isServerRunning
                      ? 'text-emerald-400'
                      : selectedAgent.status === 'typing'
                      ? 'text-amber-400'
                      : selectedAgent.status === 'thinking'
                      ? 'text-indigo-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {translateStatus(selectedAgent.status)}
                </span>
              </div>
            </div>
            {selectedAgent.currentTool && isServerRunning && (
              <div className="flex items-center gap-1 text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded border border-purple-800">
                <Wrench className="w-3.5 h-3.5" />
                <span>{selectedAgent.currentTool}</span>
              </div>
            )}
          </div>

          {/* 실시간 세부 행동 메시지 표시 */}
          <div className="bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800 font-mono text-[11px] text-slate-300 flex items-center justify-between">
            <span className="truncate">
              📌 최근 행동: {selectedAgent.currentMessage || '대기 중'}
            </span>
          </div>
        </div>
      )}

      {/* Logs Feed */}
      <div className="flex-1 p-3 overflow-y-auto text-xs space-y-2 bg-slate-950 font-mono">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 text-center py-10 font-sans">
            에이전트 활동 기록이 아직 없습니다. 좌측 하단에서 업무를 지시해 보세요!
          </div>
        ) : (
          filteredLogs.map((log) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            let icon = <Cpu className="w-3.5 h-3.5 text-blue-400" />;

            if (log.isHeartbeat) {
              icon = <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />;
            } else if (log.type.includes('tool')) {
              icon = <Wrench className="w-3.5 h-3.5 text-amber-400" />;
            } else if (log.type.includes('complete')) {
              icon = <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
            } else if (log.type.includes('error') || log.type.includes('terminated')) {
              icon = <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
            }

            return (
              <div
                key={log.id}
                className={`p-2 rounded border transition ${
                  log.type.includes('error')
                    ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                    : log.isHeartbeat
                    ? 'bg-indigo-950/40 border-indigo-700/80 text-indigo-200'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-300 font-sans">
                    {icon}
                    <span>{log.agentName}</span>
                  </div>
                  <span className="text-slate-500 font-mono">{timeStr}</span>
                </div>
                <div className="text-slate-200 pl-5 break-words font-mono text-[11px]">
                  {log.message}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
