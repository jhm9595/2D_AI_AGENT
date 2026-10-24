import type { AgentState } from '../types';

export function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: AgentState,
  time: number,
  isSelected: boolean,
  isHovered: boolean
) {
  if (agent.opacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = agent.opacity;

  const { x, y, avatarColor, status, facing } = agent;

  // 1. 그림자
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 14, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. 선택/호버 테두리
  if (isSelected || isHovered) {
    ctx.strokeStyle = isSelected ? '#38bdf8' : '#94a3b8';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 16, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3. 모션 오프셋
  let bobY = 0;
  let legSwing = 0;
  let armSwing = 0;

  if (status === 'walk') {
    bobY = Math.sin(time / 80) * 2;
    legSwing = Math.sin(time / 80) * 4;
  } else if (status === 'typing') {
    armSwing = Math.sin(time / 40) * 3;
    bobY = Math.sin(time / 90) * 0.8;
  } else if (status === 'thinking') {
    bobY = Math.sin(time / 180) * 2.5;
  } else if (status === 'idle') {
    bobY = Math.sin(time / 240) * 1;
  }

  const charY = y + bobY;

  // 4. 픽셀 캐릭터 신체
  // 다리
  ctx.fillStyle = '#1e293b';
  if (status === 'walk') {
    ctx.fillRect(x - 5, charY + 6 + legSwing, 4, 8);
    ctx.fillRect(x + 1, charY + 6 - legSwing, 4, 8);
  } else {
    ctx.fillRect(x - 5, charY + 6, 4, 8);
    ctx.fillRect(x + 1, charY + 6, 4, 8);
  }

  // 몸통 (의상 컬러)
  ctx.fillStyle = avatarColor;
  ctx.fillRect(x - 8, charY - 6, 16, 13);

  // 셔츠 칼라
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 2, charY - 6, 4, 4);

  // 팔
  ctx.fillStyle = avatarColor;
  if (status === 'typing') {
    ctx.fillRect(x - 9, charY - 2 + armSwing, 4, 6);
    ctx.fillRect(x + 5, charY - 2 - armSwing, 4, 6);
    ctx.fillStyle = '#fbcfe8';
    ctx.fillRect(x - 8, charY + 3, 3, 3);
    ctx.fillRect(x + 5, charY + 3, 3, 3);
  } else if (status === 'thinking') {
    ctx.fillRect(x - 9, charY - 2, 4, 7);
    ctx.fillRect(x + 5, charY - 5, 4, 6);
    ctx.fillStyle = '#fbcfe8';
    ctx.fillRect(x + 3, charY - 8, 4, 4);
  } else {
    ctx.fillRect(x - 9, charY - 3, 3, 8);
    ctx.fillRect(x + 6, charY - 3, 3, 8);
  }

  // 얼굴
  ctx.fillStyle = '#fed7aa';
  ctx.fillRect(x - 7, charY - 18, 14, 12);

  // 머리카락
  ctx.fillStyle = '#451a03';
  ctx.fillRect(x - 8, charY - 21, 16, 5);
  ctx.fillRect(x - 8, charY - 18, 3, 6);
  ctx.fillRect(x + 5, charY - 18, 3, 4);

  // 눈
  ctx.fillStyle = '#0f172a';
  const eyeOffsetX = facing === 'left' ? -2 : facing === 'right' ? 2 : 0;
  ctx.fillRect(x - 4 + eyeOffsetX, charY - 13, 2, 3);
  ctx.fillRect(x + 2 + eyeOffsetX, charY - 13, 2, 3);

  // 머리 위 상태 이펙트
  drawStatusEffects(ctx, agent, x, charY, time);

  // 에이전트 이름표
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(x - 36, charY + 16, 72, 16);
  ctx.strokeStyle = avatarColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 36, charY + 16, 72, 16);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(agent.name, x, charY + 28);

  ctx.restore();
}

function drawStatusEffects(ctx: CanvasRenderingContext2D, agent: AgentState, x: number, y: number, time: number) {
  const { status } = agent;

  if (status === 'thinking') {
    const pulse = Math.sin(time / 100) * 3;
    const bubbleY = y - 32 + pulse;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 10, bubbleY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.arc(x + 4, bubbleY + 8, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#6366f1';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', x + 10, bubbleY + 4);
  } else if (status === 'typing') {
    const flash = Math.floor(time / 150) % 2 === 0;
    ctx.fillStyle = flash ? '#eab308' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(x, y - 28, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚙', x, y - 24);
  } else if (status === 'idle') {
    const zOffset = (time / 120) % 15;
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('z', x + 8, y - 22 - zOffset);
  }
}

export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  agent: AgentState,
  content: string,
  toolName?: string
) {
  const x = agent.x;
  const y = agent.y - 45;

  ctx.save();
  ctx.font = '11px sans-serif';
  const maxChars = 28;
  const displayText = content.length > maxChars ? content.slice(0, maxChars) + '...' : content;
  const textWidth = Math.max(ctx.measureText(displayText).width, 90);
  const bubbleWidth = textWidth + 20;
  const bubbleHeight = toolName ? 34 : 24;

  const bx = x - bubbleWidth / 2;
  const by = y - bubbleHeight;

  // 말풍선 배경
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(bx, by, bubbleWidth, bubbleHeight, 6);
  ctx.fill();

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 말풍선 꼬리표
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x - 5, by + bubbleHeight);
  ctx.lineTo(x, by + bubbleHeight + 6);
  ctx.lineTo(x + 5, by + bubbleHeight);
  ctx.fill();
  ctx.stroke();

  // 도구 및 메시지 출력
  if (toolName) {
    const translatedTool = translateToolName(toolName);
    ctx.fillStyle = '#7c3aed';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`[${translatedTool}]`, x, by + 12);

    ctx.fillStyle = '#0f172a';
    ctx.font = '10px sans-serif';
    ctx.fillText(displayText, x, by + 25);
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(displayText, x, by + 15);
  }

  ctx.restore();
}

function translateToolName(tool: string): string {
  switch (tool) {
    case 'write_file':
      return '파일 저장/작성';
    case 'read_file':
      return '파일 읽기/검토';
    case 'search_codebase':
      return '코드베이스 검색';
    case 'run_command':
    case 'run_bash':
      return '터미널 명령 실행';
    case 'delegate_subagent':
      return '서브에이전트 위임';
    default:
      return tool;
  }
}
