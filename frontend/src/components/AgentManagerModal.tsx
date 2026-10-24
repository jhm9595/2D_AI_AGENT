import React, { useState } from 'react';
import { UserPlus, Trash2, LogIn, Sparkles } from 'lucide-react';

export interface RegistryAgent {
  id: string;
  name: string;
  role: string;
  deskIndex: number;
  avatarColor: string;
  systemPrompt?: string;
  isCustom?: boolean;
}

interface AgentManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  registryAgents: RegistryAgent[];
  onRefresh: () => void;
}

export const AgentManagerModal: React.FC<AgentManagerModalProps> = ({
  isOpen,
  onClose,
  registryAgents,
  onRefresh
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [deskIndex, setDeskIndex] = useState(3);
  const [avatarColor, setAvatarColor] = useState('#ec4899');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const colorOptions = [
    { label: '핑크', value: '#ec4899' },
    { label: '보라', value: '#8b5cf6' },
    { label: '청록', value: '#06b6d4' },
    { label: '오렌지', value: '#f97316' },
    { label: '라임', value: '#84cc16' },
    { label: '레드', value: '#ef4444' }
  ];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;

    try {
      setLoading(true);
      await fetch('http://localhost:4000/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim(),
          deskIndex: Number(deskIndex),
          avatarColor,
          systemPrompt: systemPrompt.trim()
        })
      });
      setName('');
      setRole('');
      setSystemPrompt('');
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`http://localhost:4000/api/agents/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDispatch = async (agentId: string) => {
    try {
      await fetch('http://localhost:4000/api/agents/dispatch-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId })
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-slate-100">
              AI 에이전트 채용 및 조직 관리소
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded border border-slate-700 cursor-pointer"
          >
            닫기
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* 좌측: 신규 에이전트 생성 폼 */}
          <div className="md:col-span-5 bg-slate-900/60 p-5 rounded-lg border border-slate-800/80 flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-slate-200">새 AI 에이전트 채용하기</span>
            </div>

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">에이전트 이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 최UI, 정데이터, 강데브옵스"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">직책 및 전문 역할 (Role)</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="예: 프론트엔드 엔지니어, 데이터 분석가, 보안 감사관"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">배정할 워크스테이션</label>
                  <select
                    value={deskIndex}
                    onChange={(e) => setDeskIndex(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value={0}>워크스테이션 1 (PM/수석)</option>
                    <option value={1}>워크스테이션 2 (BE/백엔드)</option>
                    <option value={2}>워크스테이션 3 (QA/품질검증)</option>
                    <option value={3}>워크스테이션 4 (FE/프론트엔드)</option>
                    <option value={4}>워크스테이션 5 (Sec/보안)</option>
                    <option value={5}>워크스테이션 6 (DBA/데이터)</option>
                    <option value={6}>워크스테이션 7 (Infra/인프라)</option>
                    <option value={7}>워크스테이션 8 (기획/PRD)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">아바타 의상 색상</label>
                  <div className="flex items-center gap-1.5 pt-1">
                    {colorOptions.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setAvatarColor(c.value)}
                        className={`w-6 h-6 rounded-full border-2 transition cursor-pointer ${
                          avatarColor === c.value ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-70'
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">시스템 프롬프트 (전문 업무 지침)</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={3}
                  placeholder="예: 사용자 경험을 중시하는 React 코드를 전문적으로 작성하고 검토합니다."
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !name.trim() || !role.trim()}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded shadow transition disabled:opacity-50 cursor-pointer"
              >
                + 가상 오피스에 즉시 채용/출근시키기
              </button>
            </form>
          </div>

          {/* 우측: 현재 오피스 등록 에이전트 목록 */}
          <div className="md:col-span-7 bg-slate-900/60 p-5 rounded-lg border border-slate-800/80 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-sm font-bold text-slate-200">
                등록된 AI 에이전트 명단 ({registryAgents.length}명)
              </span>
              <span className="text-[11px] text-slate-500">
                [출근] 버튼을 누르면 즉시 오피스로 걸어 들어옵니다.
              </span>
            </div>

            <div className="space-y-2.5 overflow-y-auto max-h-[460px] pr-1">
              {registryAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="p-3 bg-slate-950 rounded border border-slate-800 hover:border-slate-700 flex items-center justify-between transition"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3.5 h-3.5 rounded-full ring-2 ring-slate-800 shrink-0"
                      style={{ backgroundColor: agent.avatarColor }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-200">{agent.name}</span>
                        <span className="text-[10px] bg-slate-800 text-indigo-300 px-2 py-0.5 rounded border border-slate-700">
                          {agent.role}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          책상 {agent.deskIndex + 1}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                        {agent.systemPrompt || '기본 업무를 수행합니다.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDispatch(agent.id)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800 rounded transition cursor-pointer"
                      title="오피스로 출근시키기"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>출근</span>
                    </button>
                    {agent.isCustom && (
                      <button
                        onClick={() => handleDelete(agent.id)}
                        className="text-xs p-1.5 text-rose-400 hover:text-white hover:bg-rose-950/60 border border-transparent hover:border-rose-800 rounded transition cursor-pointer"
                        title="에이전트 해고/제외"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
