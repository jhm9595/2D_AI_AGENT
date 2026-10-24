import fs from 'fs';
import path from 'path';
import { eventBroker } from './eventBroker.js';

const MINUTES_PATH = path.resolve(process.cwd(), '..', 'workspace_output', 'meeting_minutes.json');

// 완전히 깨끗한 상태 (더미/테스트 데이터 없음)
let currentMeeting = null;
let pendingDecisions = [];
let decisionHistory = [];

export function getMeetingState() {
  return {
    meeting: currentMeeting,
    pendingDecisions,
    decisionHistory
  };
}

export function resetMeetingState() {
  currentMeeting = null;
  pendingDecisions = [];
  decisionHistory = [];
  if (fs.existsSync(MINUTES_PATH)) {
    try { fs.unlinkSync(MINUTES_PATH); } catch (e) {}
  }
}

// 1. 회의 소집 (안건과 관련된 에이전트만 소집)
export function startMeeting({ title, topic, attendees }) {
  currentMeeting = {
    id: `meet-${Date.now()}`,
    title,
    topic,
    startedAt: Date.now(),
    attendees: attendees || [],
    dialogues: [],
    conclusions: []
  };

  eventBroker.publish('meeting_started', currentMeeting);
  saveMinutesToDisk();
  return currentMeeting;
}

// 2. 에이전트 발언 기록
export function addDialogue({ agentId, agentName, role, message, type = 'discussion' }) {
  if (!currentMeeting) return null;

  const dialogue = {
    id: `dlg-${Date.now()}-${Math.random().toString().slice(-4)}`,
    agentId,
    agentName,
    role,
    message,
    type,
    timestamp: Date.now()
  };

  currentMeeting.dialogues.push(dialogue);
  eventBroker.publish('meeting_dialogue', dialogue);
  saveMinutesToDisk();
  return dialogue;
}

// 3. 실제 작업 중 쟁점이 생겼을 때만 결재 안건 상신
export function requestDecision({ title, issue, proposalA, proposalB, recommended, requester, targetFilename, originalPrompt }) {
  const decisionItem = {
    id: `dec-${Date.now()}`,
    title,
    issue,
    targetFilename: targetFilename || null,
    originalPrompt: originalPrompt || '',
    options: [
      { id: 'A', title: proposalA.title, description: proposalA.description, impact: proposalA.impact },
      { id: 'B', title: proposalB.title, description: proposalB.description, impact: proposalB.impact }
    ],
    recommended: recommended || 'A',
    requester: requester || '수석 아키텍트',
    status: 'pending',
    createdAt: Date.now()
  };

  pendingDecisions.unshift(decisionItem);
  eventBroker.publish('decision_requested', decisionItem);
  saveMinutesToDisk();
  return decisionItem;
}

// 4. 대표자 결정 시
export function resolveDecision({ decisionId, chosenOptionId, userComment }) {
  const index = pendingDecisions.findIndex((d) => d.id === decisionId);
  if (index === -1) return null;

  const decision = pendingDecisions[index];
  decision.status = 'resolved';
  decision.resolvedAt = Date.now();
  decision.chosenOption = decision.options.find((o) => o.id === chosenOptionId) || decision.options[0];
  decision.userComment = userComment || '';

  pendingDecisions.splice(index, 1);
  decisionHistory.unshift(decision);

  eventBroker.publish('decision_resolved', decision);
  saveMinutesToDisk();
  return decision;
}

function saveMinutesToDisk() {
  try {
    const data = {
      currentMeeting,
      pendingDecisions,
      decisionHistory,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(MINUTES_PATH, JSON.stringify(data, null, 2), 'utf-8');

    if (currentMeeting && currentMeeting.dialogues.length > 0) {
      const mdPath = path.resolve(process.cwd(), '..', 'workspace_output', '회의록_최신.md');
      let md = `# 📋 경영진 보고용 회의록: ${currentMeeting.title}\n\n`;
      md += `- **회의 안건**: ${currentMeeting.topic}\n`;
      md += `- **소집된 관련자**: ${currentMeeting.attendees.join(', ')}\n`;
      md += `- **일시**: ${new Date(currentMeeting.startedAt).toLocaleString('ko-KR')}\n\n`;
      md += `## 💬 실시간 논의 내용\n`;
      currentMeeting.dialogues.forEach((d) => {
        md += `- **[${d.agentName} / ${d.role}]**: ${d.message}\n`;
      });
      if (decisionHistory.length > 0) {
        md += `\n## ⚖️ 대표님 확정 결재 내역\n`;
        decisionHistory.forEach((h) => {
          md += `- **${h.title}**: [옵션 ${h.chosenOption.id}] ${h.chosenOption.title} (${h.chosenOption.description})\n`;
        });
      }
      fs.writeFileSync(mdPath, md, 'utf-8');
    }
  } catch (err) {}
}
