import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { eventBroker } from './eventBroker.js';
import { stopMockSimulation, isMockRunning } from './mock/mockRunner.js';
import {
  runGeminiAgentTask,
  isRealAgentRunning,
  forceResetAgentSession,
  handleExecutiveDecisionApplied,
  verifyAndSelectBestModel,
  getVerifiedWorkingModel
} from './gemini/geminiAgent.js';
import { getAgentsRegistry, addCustomAgent, removeCustomAgent } from './agentRegistry.js';
import { getMeetingState, resolveDecision, resetMeetingState } from './meetingManager.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
eventBroker.attach(server);

const WORKSPACE_DIR = path.resolve(process.cwd(), '..', 'workspace_output');

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mockRunning: isMockRunning(),
    agentRunning: isRealAgentRunning(),
    workflowStatus: eventBroker.workflowStatus,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    clients: eventBroker.clients.size
  });
});

// 📋 실시간 회의록 & 대표자 결정 필요 안건 조회 API
app.get('/api/meeting/state', (req, res) => {
  res.json({
    ...getMeetingState(),
    workflowStatus: eventBroker.workflowStatus,
    agentRunning: isRealAgentRunning()
  });
});

// ⚖️ 대표자(사용자) 결정 승인/하달 API
app.post('/api/meeting/resolve-decision', async (req, res) => {
  const { decisionId, chosenOptionId, userComment, apiKey } = req.body;
  if (!decisionId || !chosenOptionId) {
    return res.status(400).json({ error: '결정 안건 ID와 선택 옵션이 필요합니다.' });
  }

  const resolved = resolveDecision({ decisionId, chosenOptionId, userComment });
  if (!resolved) {
    return res.status(404).json({ error: '해당 안건을 찾을 수 없습니다.' });
  }

  // 비동기 후속 조치 가동
  handleExecutiveDecisionApplied(resolved, apiKey).catch((err) => {
    console.error('[Backend] Error during decision post-processing:', err);
  });

  res.json({ message: '대표님의 결정이 김수석과 팀원들에게 전달되었습니다.', decision: resolved });
});

// 🔍 Gemini API 키 유효성 및 모델별 실제 호출 검증 테스트 엔드포인트
app.post('/api/gemini/test-key', async (req, res) => {
  const apiKey = req.body?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ success: false, message: '전달된 Gemini API Key가 없습니다.' });
  }

  try {
    const probe = await verifyAndSelectBestModel(apiKey.trim());
    if (probe.success) {
      return res.json({
        success: true,
        message: `Gemini API 호출 테스트 통과! (채택된 모델: ${probe.chosenModel})`,
        model: probe.chosenModel,
        geminiReply: probe.chosenReply,
        probeResults: probe.results
      });
    } else {
      return res.status(400).json({
        success: false,
        message: '모든 후보 모델 호출에 실패했습니다.',
        probeResults: probe.results
      });
    }
  } catch (err) {
    console.error('[Gemini Key Test Error]:', err);
    return res.status(400).json({
      success: false,
      message: 'Gemini API 호출에 실패했습니다.',
      error: err.message
    });
  }
});

// 오피스 리셋 (더미/테스트 데이터 완전 초기화)
app.post('/api/office/reset', (req, res) => {
  stopMockSimulation();
  forceResetAgentSession();
  resetMeetingState();
  eventBroker.clearAllAgents();
  res.json({ message: '모든 테스트 데이터와 오피스가 깨끗하게 초기화되었습니다.' });
});

// Windows 탐색기로 결과물 폴더 직접 열기
app.post('/api/workspace/open-folder', (req, res) => {
  exec(`explorer.exe "${WORKSPACE_DIR}"`);
  res.json({ message: '탐색기로 폴더가 열렸습니다.', path: WORKSPACE_DIR });
});

// 기본 프로그램으로 파일 열기
app.post('/api/workspace/launch-file', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '파일명이 필요합니다.' });
  const filePath = path.join(WORKSPACE_DIR, path.basename(name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일이 없습니다.' });

  exec(`start "" "${filePath}"`);
  res.json({ message: '파일이 기본 프로그램으로 실행되었습니다.' });
});

// Agent Registry API
app.get('/api/agents/list', (req, res) => {
  res.json({ agents: getAgentsRegistry() });
});

app.post('/api/agents/create', (req, res) => {
  const { name, role, deskIndex, avatarColor, systemPrompt } = req.body;
  if (!name || !role) {
    return res.status(400).json({ error: '이름과 역할을 모두 입력해 주세요.' });
  }
  const created = addCustomAgent({ name, role, deskIndex, avatarColor, systemPrompt });

  eventBroker.agentSpawned({
    id: created.id,
    name: created.name,
    role: created.role,
    deskIndex: created.deskIndex,
    avatarColor: created.avatarColor,
    status: 'spawn'
  });

  setTimeout(() => {
    eventBroker.agentMove(created.id, { deskIndex: created.deskIndex }, 'walk');
  }, 800);

  setTimeout(() => {
    eventBroker.agentCompleted(created.id, `안녕하세요! 신규 입사한 ${created.role} ${created.name}입니다.`);
  }, 2400);

  res.json({ message: '에이전트가 성공적으로 채용/추가되었습니다.', agent: created });
});

app.delete('/api/agents/:id', (req, res) => {
  const { id } = req.params;
  eventBroker.agentMove(id, { station: 'door' }, 'walk');
  setTimeout(() => {
    eventBroker.agentTerminated(id, '업무를 마치고 퇴근하였습니다.');
  }, 1500);

  const updated = removeCustomAgent(id);
  res.json({ message: '에이전트가 오피스에서 제외되었습니다.', agents: updated });
});

// Trigger Real or Autonomous Agent Task
app.post('/api/agent/run', async (req, res) => {
  const { prompt, apiKey, assignedAgentId } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '요청 프롬프트가 비어있습니다.' });
  }

  runGeminiAgentTask(prompt.trim(), apiKey, assignedAgentId)
    .catch((err) => {
      console.error('[Backend] Agent Task Execution failed:', err);
    });

  res.json({ message: '에이전트 작업 지시 완료', prompt });
});

// Workspace artifacts endpoints
app.get('/api/workspace/files', async (req, res) => {
  try {
    if (!fs.existsSync(WORKSPACE_DIR)) {
      return res.json({ files: [], path: WORKSPACE_DIR });
    }
    const files = await fs.promises.readdir(WORKSPACE_DIR);
    // 내부 상태 저장용 파일(meeting_minutes.json 등)은 사용자 산출물 목록에서 제외
    const visibleFiles = files.filter((f) => f !== 'meeting_minutes.json' && !f.startsWith('.'));
    const details = await Promise.all(
      visibleFiles.map(async (name) => {
        const filePath = path.join(WORKSPACE_DIR, name);
        const stat = await fs.promises.stat(filePath);
        return {
          name,
          size: stat.size,
          updatedAt: stat.mtime
        };
      })
    );
    details.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ files: details, path: WORKSPACE_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspace/file', async (req, res) => {
  const filename = req.query.name;
  const renderMode = req.query.render;
  if (!filename) {
    return res.status(400).json({ error: '파일명이 필요합니다.' });
  }
  const filePath = path.join(WORKSPACE_DIR, path.basename(filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }
  const content = await fs.promises.readFile(filePath, 'utf-8');
  if (renderMode === 'html' || filename.endsWith('.html') && req.headers.accept && req.headers.accept.includes('text/html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.send(content);
  }
  res.json({ name: filename, content, fullPath: filePath });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`[Backend] Server listening on http://localhost:${PORT}`);
  console.log(`[Backend] WebSocket available at ws://localhost:${PORT}/ws/agent-events`);
});
