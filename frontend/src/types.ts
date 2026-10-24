export interface AgentState {
  id: string;
  name: string;
  role: string;
  deskIndex: number;
  avatarColor: string;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  facing: 'left' | 'right' | 'up' | 'down';
  status: 'spawn' | 'idle' | 'walk' | 'typing' | 'thinking' | 'terminated';
  currentTool?: string;
  currentMessage?: string;
  logHistory: Array<{ timestamp: number; message: string; type: string }>;
  opacity: number;
}

export interface AgentEvent {
  type: 'agent_spawned' | 'agent_thinking' | 'agent_executing_tool' | 'agent_completed' | 'agent_terminated' | 'agent_move' | 'initial_state';
  payload: any;
}
