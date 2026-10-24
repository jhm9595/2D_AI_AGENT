import { WebSocketServer, WebSocket } from 'ws';

export class EventBroker {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.history = [];
    this.maxHistory = 100;
    this.agentNames = new Map();
    this.workflowStatus = {
      running: false,
      stage: '대기 중 (진행 중인 작업 없음)',
      activeAgentId: null,
      activeAgentName: null,
      detail: '',
      model: null,
      elapsedSec: 0,
      lastError: null,
      updatedAt: Date.now()
    };
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws/agent-events' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[EventBroker] Client connected. Total: ${this.clients.size}`);

      ws.send(JSON.stringify({
        type: 'initial_state',
        payload: {
          history: [],
          workflowStatus: this.workflowStatus,
          timestamp: Date.now()
        }
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[EventBroker] Client disconnected. Total: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error('[EventBroker] Client error:', err);
      });
    });
  }

  clearAllAgents() {
    this.history = [];
    this.updateWorkflowStatus({
      running: false,
      stage: '대기 중 (초기화 완료)',
      activeAgentId: null,
      activeAgentName: null,
      detail: '',
      elapsedSec: 0,
      lastError: null
    });
    this.publish('clear_office', {});
  }

  updateWorkflowStatus(patch) {
    this.workflowStatus = {
      ...this.workflowStatus,
      ...patch,
      updatedAt: Date.now()
    };
    this.publish('workflow_status', this.workflowStatus, false);
  }

  publish(eventType, payload, saveHistory = true) {
    const resolvedName =
      payload.name ||
      payload.agentName ||
      (payload.agentId ? this.agentNames.get(payload.agentId) : null) ||
      payload.agentId ||
      '시스템';

    const event = {
      type: eventType,
      payload: {
        ...payload,
        name: resolvedName,
        timestamp: payload.timestamp || Date.now()
      }
    };

    if (saveHistory) {
      this.history.push(event);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    }

    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  agentSpawned(agent) {
    if (agent && agent.id && agent.name) {
      this.agentNames.set(agent.id, agent.name);
    }
    this.publish('agent_spawned', agent);
  }

  agentThinking(agentId, promptSummary, extra = {}) {
    this.publish(
      'agent_thinking',
      {
        agentId,
        status: 'thinking',
        message: promptSummary || '분석 및 생각 중...',
        ...extra
      },
      !extra.isHeartbeat
    );
  }

  agentExecutingTool(agentId, toolName, details) {
    this.publish('agent_executing_tool', {
      agentId,
      status: 'typing',
      tool: toolName,
      details: details || '',
      message: `실행 중: ${toolName} ${details ? `(${details})` : ''}`
    });
  }

  agentCompleted(agentId, resultSummary) {
    this.publish('agent_completed', {
      agentId,
      status: 'idle',
      message: resultSummary || '작업 완료!'
    });
  }

  agentError(agentId, errorMsg) {
    this.publish('agent_error', {
      agentId,
      status: 'idle',
      message: `❌ [오류 발생]: ${errorMsg}`
    });
  }

  agentTerminated(agentId, reason) {
    this.publish('agent_terminated', {
      agentId,
      status: 'terminated',
      reason: reason || '퇴근'
    });
  }

  agentMove(agentId, target, state) {
    this.publish(
      'agent_move',
      {
        agentId,
        target,
        status: state || 'walk',
        message: '위치 이동 중...'
      },
      false
    );
  }
}

export const eventBroker = new EventBroker();
