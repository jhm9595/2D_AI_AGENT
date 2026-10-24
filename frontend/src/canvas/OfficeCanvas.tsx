import React, { useRef, useEffect } from 'react';
import type { AgentState } from '../types';
import { drawOffice, OFFICE_CONFIG } from './OfficeMap';
import { drawAgent, drawSpeechBubble } from './AgentRenderer';

interface OfficeCanvasProps {
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  hoveredAgentId: string | null;
  setHoveredAgentId: (id: string | null) => void;
}

export const OfficeCanvas: React.FC<OfficeCanvasProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  hoveredAgentId,
  setHoveredAgentId
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Enable crisp pixel art rendering
    ctx.imageSmoothingEnabled = false;

    let animationFrameId: number;

    const render = (time: number) => {
      ctx.clearRect(0, 0, OFFICE_CONFIG.width, OFFICE_CONFIG.height);

      // 1. Draw virtual office room tiles, desks, equipment
      drawOffice(ctx, OFFICE_CONFIG.width, OFFICE_CONFIG.height, time);

      // 2. Draw agents sorted by Y coordinate for depth perspective
      const sortedAgents = [...agents].sort((a, b) => a.y - b.y);

      for (const agent of sortedAgents) {
        const isSelected = agent.id === selectedAgentId;
        const isHovered = agent.id === hoveredAgentId;
        drawAgent(ctx, agent, time, isSelected, isHovered);
      }

      // 3. Draw speech bubbles above agents with active messages
      for (const agent of sortedAgents) {
        if (agent.currentMessage && agent.opacity > 0.1) {
          drawSpeechBubble(ctx, agent, agent.currentMessage, agent.currentTool);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [agents, selectedAgentId, hoveredAgentId]);

  // Click & hover detection
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Check hit on agents (radius 24px)
    let clickedAgent: AgentState | null = null;
    for (const agent of agents) {
      const dist = Math.hypot(agent.x - clickX, agent.y - clickY);
      if (dist < 26) {
        clickedAgent = agent;
        break;
      }
    }

    onSelectAgent(clickedAgent ? clickedAgent.id : null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    let foundAgent: AgentState | null = null;
    for (const agent of agents) {
      const dist = Math.hypot(agent.x - mouseX, agent.y - mouseY);
      if (dist < 26) {
        foundAgent = agent;
        break;
      }
    }

    setHoveredAgentId(foundAgent ? foundAgent.id : null);
  };

  return (
    <div className="relative border-2 border-slate-700 rounded-lg overflow-hidden shadow-2xl bg-slate-900 inline-block">
      <canvas
        ref={canvasRef}
        width={OFFICE_CONFIG.width}
        height={OFFICE_CONFIG.height}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        className="cursor-pointer block"
      />
    </div>
  );
};
