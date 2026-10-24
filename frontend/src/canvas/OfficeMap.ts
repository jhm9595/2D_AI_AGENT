export interface OfficeStation {
  name: string;
  x: number;
  y: number;
  type: 'desk' | 'water_cooler' | 'coffee' | 'door' | 'plant' | 'whiteboard' | 'meeting';
  label: string;
}

export const OFFICE_CONFIG = {
  width: 900,
  height: 520,
  tileSize: 32,
  door: { x: 80, y: 440 },
  stations: {
    coffee: { x: 780, y: 130 },
    water_cooler: { x: 680, y: 130 },
    whiteboard: { x: 450, y: 100 },
    door: { x: 80, y: 440 },
    // 중앙 대형 회의 테이블
    meetingTable: { x: 450, y: 280 }
  },
  // 회의 시 둘러앉는 의자 위치들 (8인 구성)
  meetingSeats: [
    { x: 450, y: 215, label: '김수석(PM) 석' },
    { x: 450, y: 345, label: '윤기획(Planner) 석' },
    { x: 380, y: 240, label: '한데이터(DBA) 석' },
    { x: 520, y: 240, label: '강인프라(Infra) 석' },
    { x: 380, y: 320, label: '이백엔드(BE) 석' },
    { x: 520, y: 320, label: '최UI(FE) 석' },
    { x: 350, y: 280, label: '정보안(Sec) 석' },
    { x: 550, y: 280, label: '박검증(QA) 석' }
  ],
  desks: [
    { index: 0, x: 140, y: 200, label: '워크스테이션 1 (PM/수석)' },
    { index: 1, x: 140, y: 320, label: '워크스테이션 2 (BE/백엔드)' },
    { index: 2, x: 740, y: 200, label: '워크스테이션 3 (QA/품질검증)' },
    { index: 3, x: 740, y: 320, label: '워크스테이션 4 (FE/프론트)' },
    { index: 4, x: 845, y: 260, label: '워크스테이션 5 (Sec/보안)' },
    { index: 5, x: 140, y: 430, label: '워크스테이션 6 (DBA/데이터)' },
    { index: 6, x: 740, y: 430, label: '워크스테이션 7 (Infra/배포)' },
    { index: 7, x: 250, y: 200, label: '워크스테이션 8 (기획/PRD)' }
  ]
};

// Procedural 2D Pixel Office Canvas Drawer
export function drawOffice(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  const tileSize = 32;
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);

  // 1. 바닥 & 벽면
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isWall = r < 3;
      if (isWall) {
        ctx.fillStyle = (r === 2) ? '#242938' : '#1e2230';
        ctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
        ctx.strokeStyle = '#181b26';
        ctx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      } else {
        const isAlternate = (r + c) % 2 === 0;
        ctx.fillStyle = isAlternate ? '#272d3e' : '#222837';
        ctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
        ctx.strokeStyle = '#1d2230';
        ctx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
  }

  // 2. 바닥 몰딩
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 3 * tileSize - 4, width, 6);

  // 3. 중앙 대형 회의실 카펫 구역
  ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
  ctx.fillRect(320, 180, 260, 200);
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(320, 180, 260, 200);

  // 4. 중앙 대형 회의 테이블 (Glass Conference Table)
  const mt = OFFICE_CONFIG.stations.meetingTable;
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(mt.x - 70, mt.y - 40, 140, 80, 12);
  ctx.fill();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 테이블 중앙 스마트 디스플레이 / 회의 마이크
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(mt.x - 30, mt.y - 12, 60, 24);
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1;
  ctx.strokeRect(mt.x - 30, mt.y - 12, 60, 24);
  
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('회의 테이블', mt.x, mt.y + 4);

  // 5. 화이트보드
  const wb = OFFICE_CONFIG.stations.whiteboard;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(wb.x - 70, wb.y - 45, 140, 52);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#94a3b8';
  ctx.strokeRect(wb.x - 70, wb.y - 45, 140, 52);

  // 포스트잇
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(wb.x - 55, wb.y - 35, 18, 18);
  ctx.fillStyle = '#fbcfe8';
  ctx.fillRect(wb.x - 25, wb.y - 35, 18, 18);
  ctx.fillStyle = '#a7f3d0';
  ctx.fillRect(wb.x + 5, wb.y - 35, 18, 18);
  ctx.fillStyle = '#bae6fd';
  ctx.fillRect(wb.x + 35, wb.y - 35, 18, 18);

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wb.x - 45, wb.y - 10);
  ctx.lineTo(wb.x + 45, wb.y - 10);
  ctx.stroke();

  // 6. 출입구
  const door = OFFICE_CONFIG.door;
  ctx.fillStyle = '#10b981';
  ctx.fillRect(door.x - 20, door.y - 10, 40, 6);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
  ctx.fillRect(door.x - 25, door.y - 30, 50, 40);
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🚪 출입구', door.x, door.y + 16);

  // 7. 정수기 & 커피존
  const wc = OFFICE_CONFIG.stations.water_cooler;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(wc.x - 14, wc.y - 30, 28, 40);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(wc.x - 10, wc.y - 48, 20, 20);
  const bubbleY = (time / 100) % 15;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(wc.x - 3, wc.y - 35 - bubbleY, 3, 3);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('💧 정수기', wc.x, wc.y + 22);

  const cs = OFFICE_CONFIG.stations.coffee;
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cs.x - 18, cs.y - 25, 36, 35);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(cs.x - 12, cs.y - 38, 24, 18);
  const steamY = (time / 80) % 12;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillRect(cs.x - 4, cs.y - 44 - steamY, 3, 4);
  ctx.fillRect(cs.x + 2, cs.y - 42 - steamY, 2, 3);
  ctx.fillStyle = '#d97706';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('☕ 커피존', cs.x, cs.y + 22);

  // 8. 화분들
  drawPottedPlant(ctx, 30, 110);
  drawPottedPlant(ctx, 860, 110);
  drawPottedPlant(ctx, 860, 460);

  // 9. 워크스테이션 책상들
  for (const desk of OFFICE_CONFIG.desks) {
    drawDesk(ctx, desk.x, desk.y, desk.label);
  }
}

function drawPottedPlant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#b45309';
  ctx.fillRect(x - 10, y - 8, 20, 16);
  ctx.fillStyle = '#78350f';
  ctx.fillRect(x - 12, y - 10, 24, 4);
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.arc(x, y - 22, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(x - 6, y - 26, 8, 0, Math.PI * 2);
  ctx.arc(x + 5, y - 20, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.fillStyle = '#334155';
  ctx.fillRect(x - 38, y - 18, 76, 36);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 38, y - 18, 76, 36);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x - 16, y - 16, 32, 20);
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(x - 14, y - 14, 28, 16);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(x - 4, y + 4, 8, 3);

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x - 12, y + 8, 24, 5);

  ctx.fillStyle = '#64748b';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + 30);
}
