import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, AgentEvent } from '../types';
import { OFFICE_CONFIG } from '../canvas/OfficeMap';

export interface WorkflowStatus {
  running: boolean;
  stage: string;
  activeAgentId: string | null;
  activeAgentName: string | null;
  detail: string;
  model: string | null;
  elapsedSec: number;
  lastError: string | null;
  updatedAt: number;
}

export function useAgentSocket(wsUrl: string) {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [logs, setLogs] = useState<Array<{ id: string; timestamp: number; agentId?: string; agentName: string; type: string; message: string; isHeartbeat?: boolean }>>([]);
  const [connected, setConnected] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>({
    running: false,
    stage: '대기 중 (진행 중인 작업 없음)',
    activeAgentId: null,
    activeAgentName: null,
    detail: '',
    model: null,
    elapsedSec: 0,
    lastError: null,
    updatedAt: Date.now()
  });
  const socketRef = useRef<WebSocket | null>(null);

  const getStationCoordinates = (target: any) => {
    if (typeof target?.deskIndex === 'number') {
      const desk = OFFICE_CONFIG.desks[target.deskIndex] || OFFICE_CONFIG.desks[0];
      return { x: desk.x, y: desk.y + 16 };
    }
    if (target?.station && OFFICE_CONFIG.stations[target.station as keyof typeof OFFICE_CONFIG.stations]) {
      return OFFICE_CONFIG.stations[target.station as keyof typeof OFFICE_CONFIG.stations];
    }
    if (typeof target?.x === 'number' && typeof target?.y === 'number') {
      return { x: target.x, y: target.y };
    }
    return { x: OFFICE_CONFIG.door.x, y: OFFICE_CONFIG.door.y };
  };

  const handleEvent = useCallback((event: AgentEvent) => {
    const { type, payload } = event as any;

    if (type === 'clear_office') {
      setAgents([]);
      setLogs([]);
      return;
    }

    if (type === 'workflow_status') {
      setWorkflowStatus(payload);
      // 백엔드가 running: false (작업 종료/대기) 상태면 화면에 'thinking'이나 'typing'으로 멈춰있는 에이전트를 즉시 'idle'로 보정
      if (payload && payload.running === false) {
        setAgents((prev) =>
          prev.map((a) =>
            a.status === 'thinking' || a.status === 'typing'
              ? { ...a, status: 'idle', currentTool: undefined }
              : a
          )
        );
      }
      return;
    }

    // agent_move는 위치 이동 전용이므로 로그 스트림을 도배하지 않도록 제외
    const timestamp = payload?.timestamp || Date.now();
    const agentId = payload?.agentId || payload?.id;
    const agentName = payload?.name || payload?.agentName || payload?.agentId || '시스템';
    const logMsg = payload?.message || payload?.details || payload?.reason || '';
    const isHeartbeat = Boolean(payload?.isHeartbeat);

    if (type !== 'agent_move' && logMsg) {
      setLogs((prev) => {
        // 1초 단위 하트비트 메시지는 직전 하트비트 로그 한 줄만 실시간 갱신하여 스크롤 도배 방지
        if (isHeartbeat && prev.length > 0 && prev[0].isHeartbeat && prev[0].agentId === agentId) {
          const updatedTop = { ...prev[0], timestamp, message: logMsg };
          return [updatedTop, ...prev.slice(1)];
        }
        return [
          { id: `${Date.now()}-${Math.random()}`, timestamp, agentId, agentName, type, message: logMsg, isHeartbeat },
          ...prev.slice(0, 99)
        ];
      });
    }

    setAgents((prevAgents) => {
      switch (type) {
        case 'agent_spawned': {
          const desk = OFFICE_CONFIG.desks[payload.deskIndex ?? 0] || OFFICE_CONFIG.desks[0];
          const newAgent: AgentState = {
            id: payload.id,
            name: payload.name || '에이전트',
            role: payload.role || '스페셜리스트',
            deskIndex: payload.deskIndex ?? 0,
            avatarColor: payload.avatarColor || '#6366f1',
            x: OFFICE_CONFIG.door.x,
            y: OFFICE_CONFIG.door.y,
            targetX: desk.x,
            targetY: desk.y + 16,
            facing: 'right',
            status: 'walk',
            currentMessage: `출근 완료!`,
            logHistory: [{ timestamp, message: `입사: ${payload.role}`, type: 'spawn' }],
            opacity: 1
          };
          const exists = prevAgents.some((a) => a.id === payload.id);
          return exists ? prevAgents.map((a) => (a.id === payload.id ? { ...a, name: newAgent.name, role: newAgent.role } : a)) : [...prevAgents, newAgent];
        }

        case 'agent_move': {
          const targetCoords = getStationCoordinates(payload.target);
          return prevAgents.map((a) => {
            if (a.id !== payload.agentId) return a;
            return {
              ...a,
              targetX: targetCoords.x,
              targetY: targetCoords.y,
              status: 'walk',
              facing: targetCoords.x > a.x ? 'right' : 'left'
            };
          });
        }

        case 'agent_thinking': {
          return prevAgents.map((a) => {
            if (a.id !== payload.agentId) return a;
            return {
              ...a,
              status: 'thinking',
              currentMessage: payload.message || '분석 중...',
              currentTool: undefined,
              logHistory: isHeartbeat
                ? a.logHistory
                : [{ timestamp, message: payload.message || '생각 중...', type: 'thinking' }, ...a.logHistory]
            };
          });
        }

        case 'agent_executing_tool': {
          return prevAgents.map((a) => {
            if (a.id !== payload.agentId) return a;
            return {
              ...a,
              status: 'typing',
              currentTool: payload.tool,
              currentMessage: payload.details || `${payload.tool} 작업 실행`,
              logHistory: [
                { timestamp, message: `[${payload.tool}] ${payload.details || ''}`, type: 'tool' },
                ...a.logHistory
              ]
            };
          });
        }

        case 'agent_completed':
        case 'agent_error': {
          return prevAgents.map((a) => {
            if (a.id !== payload.agentId) return a;
            return {
              ...a,
              status: 'idle',
              currentMessage: payload.message || '완료!',
              currentTool: undefined,
              logHistory: [{ timestamp, message: payload.message || '완료', type: type === 'agent_error' ? 'error' : 'complete' }, ...a.logHistory]
            };
          });
        }

        case 'agent_terminated': {
          return prevAgents.map((a) => {
            if (a.id !== payload.agentId) return a;
            return {
              ...a,
              status: 'terminated',
              currentMessage: payload.reason || '퇴근 중...',
              logHistory: [{ timestamp, message: payload.reason || '퇴근', type: 'terminate' }, ...a.logHistory]
            };
          });
        }

        default:
          return prevAgents;
      }
    });
  }, []);

  // Agent position interpolator loop
  useEffect(() => {
    const interval = setInterval(() => {
      setAgents((prev) =>
        prev.map((agent) => {
          if (agent.status === 'terminated') {
            return {
              ...agent,
              opacity: Math.max(0, agent.opacity - 0.05)
            };
          }

          if (agent.targetX === undefined || agent.targetY === undefined) {
            return agent;
          }

          const dx = agent.targetX - agent.x;
          const dy = agent.targetY - agent.y;
          const dist = Math.hypot(dx, dy);

          if (dist < 4) {
            return {
              ...agent,
              x: agent.targetX,
              y: agent.targetY,
              targetX: undefined,
              targetY: undefined,
              status: agent.status === 'walk' ? 'idle' : agent.status
            };
          }

          const speed = 3.5;
          const vx = (dx / dist) * Math.min(speed, dist);
          const vy = (dy / dist) * Math.min(speed, dist);

          return {
            ...agent,
            x: agent.x + vx,
            y: agent.y + vy,
            facing: vx > 0.1 ? 'right' : vx < -0.1 ? 'left' : agent.facing
          };
        }).filter((agent) => agent.opacity > 0)
      );
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, []);

  // WebSocket Connection
  useEffect(() => {
    let reconnectTimeout: any;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'initial_state') {
            if (parsed.payload?.workflowStatus) {
              setWorkflowStatus(parsed.payload.workflowStatus);
              if (!parsed.payload.workflowStatus.running) {
                setAgents([]);
              }
            }
          } else {
            handleEvent(parsed);
          }
        } catch (err) {
          console.error('[useAgentSocket] Error parsing message:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[useAgentSocket] WebSocket error:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [wsUrl, handleEvent]);

  return { agents, logs, connected, workflowStatus, setWorkflowStatus, setAgents, setLogs };
}
