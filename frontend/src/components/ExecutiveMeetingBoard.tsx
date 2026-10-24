import React, { useState } from 'react';
import {
  FileText,
  Vote,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Clock,
  ArrowRight,
  UserCheck
} from 'lucide-react';

export interface DecisionOption {
  id: string;
  title: string;
  description: string;
  impact: string;
}

export interface DecisionItem {
  id: string;
  title: string;
  issue: string;
  options: DecisionOption[];
  recommended: string;
  requester: string;
  status: 'pending' | 'resolved';
  createdAt: number;
  resolvedAt?: number;
  chosenOption?: DecisionOption;
}

export interface MeetingData {
  id: string;
  title: string;
  topic: string;
  startedAt: number;
  attendees: string[];
  dialogues: Array<{
    id: string;
    agentName: string;
    role: string;
    message: string;
    type: string;
    timestamp: number;
  }>;
}

interface ExecutiveMeetingBoardProps {
  meeting: MeetingData | null;
  pendingDecisions: DecisionItem[];
  decisionHistory: DecisionItem[];
  onResolveDecision: (decisionId: string, optionId: string) => Promise<void>;
}

export const ExecutiveMeetingBoard: React.FC<ExecutiveMeetingBoardProps> = ({
  meeting,
  pendingDecisions,
  decisionHistory,
  onResolveDecision
}) => {
  const [activeTab, setActiveTab] = useState<'decisions' | 'minutes' | 'history'>('minutes');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  React.useEffect(() => {
    if (pendingDecisions.length > 0) {
      setActiveTab('decisions');
    } else if (meeting && meeting.dialogues && meeting.dialogues.length > 0 && activeTab === 'decisions') {
      setActiveTab('minutes');
    }
  }, [pendingDecisions.length, meeting?.dialogues?.length]);

  const handleChoose = async (decisionId: string, optionId: string) => {
    try {
      setResolvingId(decisionId);
      await onResolveDecision(decisionId, optionId);
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl shadow-xl flex flex-col overflow-hidden">
      {/* 경영진 헤더 */}
      <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
            <Vote className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              대표자 의사결정 & 실시간 회의 브리핑
              {pendingDecisions.length > 0 && (
                <span className="text-[10px] bg-amber-500 text-slate-950 font-bold px-2 py-0.5 rounded-full animate-pulse">
                  결재 대기 {pendingDecisions.length}건
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400">
              에이전트들은 중단 없이 병렬 개발을 진행하며, 대표님이 결정하는 즉시 세부 방향이 확정됩니다.
            </p>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('decisions')}
            className={`px-3 py-1 text-xs font-bold rounded transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'decisions'
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>결재 대기</span>
            {pendingDecisions.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-slate-900 text-amber-400 text-[10px] flex items-center justify-center">
                {pendingDecisions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('minutes')}
            className={`px-3 py-1 text-xs font-bold rounded transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'minutes'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>실시간 회의록</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 text-xs font-bold rounded transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-slate-800 text-slate-200'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>확정 이력 ({decisionHistory.length})</span>
          </button>
        </div>
      </div>

      {/* 탭 내용 영역 */}
      <div className="p-5">
        {/* 1. 결재 대기 안건 탭 (대표가 한눈에 보고 고르는 카드) */}
        {activeTab === 'decisions' && (
          <div className="space-y-4">
            {pendingDecisions.length === 0 ? (
              <div className="py-8 text-center bg-slate-900/40 rounded-xl border border-slate-800/80">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                <div className="text-sm font-bold text-slate-300">현재 대기 중인 결재 안건이 없습니다.</div>
                <p className="text-xs text-slate-500 mt-1">
                  에이전트들이 자율적으로 회의 및 개발을 진행하고 있습니다. 결정이 필요한 사안 발생 시 여기에 즉시 상신됩니다.
                </p>
              </div>
            ) : (
              pendingDecisions.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-900/90 rounded-xl border-2 border-amber-500/50 p-5 shadow-2xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-300"
                >
                  {/* 안건 헤더 */}
                  <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/40">
                          의사결정 필요 안건
                        </span>
                        <h3 className="text-sm font-bold text-slate-100">{item.title}</h3>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                        <span>상신자: <strong className="text-slate-200">{item.requester}</strong></span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(item.createdAt).toLocaleTimeString()} 상신
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] text-emerald-400 font-bold bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-800">
                        ⚡ 병렬 개발 계속 진행 중
                      </span>
                    </div>
                  </div>

                  {/* 제기된 문제 / 배경 */}
                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/80 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-bold text-amber-300 block mb-0.5">상황 및 쟁점 요약:</span>
                      <p className="text-xs text-slate-300 leading-relaxed">{item.issue}</p>
                    </div>
                  </div>

                  {/* 해결방안 A / B 선택지 비교 카드 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {item.options.map((opt) => {
                      const isRecommended = item.recommended === opt.id;
                      return (
                        <div
                          key={opt.id}
                          className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                            isRecommended
                              ? 'bg-indigo-950/20 border-indigo-500/60 hover:border-indigo-400 shadow-lg'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-slate-100 flex items-center gap-1.5">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                                  opt.id === 'A' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                                }`}>
                                  {opt.id}
                                </span>
                                {opt.title}
                              </span>
                              {isRecommended && (
                                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold border border-indigo-500/40 flex items-center gap-1">
                                  <Lightbulb className="w-3 h-3" /> 수석 추천
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed pl-6">{opt.description}</p>
                            <div className="text-[11px] text-slate-400 pl-6 bg-slate-900/60 p-2 rounded border border-slate-800">
                              <strong className="text-slate-300">기대 효과:</strong> {opt.impact}
                            </div>
                          </div>

                          <button
                            onClick={() => handleChoose(item.id, opt.id)}
                            disabled={resolvingId === item.id}
                            className={`mt-4 w-full py-2.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-50 ${
                              isRecommended
                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                            }`}
                          >
                            <span>[옵션 {opt.id}] 로 확정 결정하기</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 2. 실시간 회의록 탭 (경영진 보고용 정리 문서) */}
        {activeTab === 'minutes' && (
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-4">
            {meeting ? (
              <>
                <div className="border-b border-slate-800 pb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-400" />
                      {meeting.title}
                    </h3>
                    <div className="text-xs text-slate-400 mt-1">
                      <span>주제: <strong className="text-slate-300">{meeting.topic}</strong></span>
                      <span className="mx-2">•</span>
                      <span>참석: {meeting.attendees.join(', ')}</span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-indigo-950 text-indigo-300 px-2 py-1 rounded border border-indigo-800">
                    회의록 자동 기록 중
                  </span>
                </div>

                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                  {meeting.dialogues.length === 0 ? (
                    <div className="text-xs text-slate-500 text-center py-6">회의 발언이 아직 없습니다.</div>
                  ) : (
                    meeting.dialogues.map((dlg) => (
                      <div
                        key={dlg.id}
                        className={`p-3 rounded-lg border text-xs leading-relaxed ${
                          dlg.type === 'decision_request'
                            ? 'bg-amber-950/20 border-amber-800/80 text-amber-200'
                            : dlg.type === 'issue'
                            ? 'bg-rose-950/20 border-rose-900/60 text-slate-200'
                            : 'bg-slate-950 border-slate-800/80 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1 text-[11px] text-slate-400">
                          <span className="font-bold text-slate-300">
                            {dlg.agentName} <span className="font-normal text-slate-500">({dlg.role})</span>
                          </span>
                          <span className="font-mono">{new Date(dlg.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p>{dlg.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-500 text-center py-8">
                현재 진행 중인 회의가 없습니다. 새로운 작업을 지시하면 회의가 자동 소집됩니다.
              </div>
            )}
          </div>
        )}

        {/* 3. 확정 이력 탭 */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {decisionHistory.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-8 bg-slate-900/40 rounded-xl border border-slate-800">
                아직 결재가 완료된 확정 이력이 없습니다.
              </div>
            ) : (
              decisionHistory.map((item) => (
                <div key={item.id} className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-bold text-xs text-slate-200">{item.title}</span>
                    </div>
                    <div className="text-xs text-emerald-300 mt-1 pl-6">
                      <strong>확정 결정:</strong> [옵션 {item.chosenOption?.id}] {item.chosenOption?.title}
                    </div>
                    <p className="text-[11px] text-slate-400 pl-6 mt-0.5">{item.chosenOption?.description}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(item.resolvedAt || item.createdAt).toLocaleTimeString()} 확정
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
