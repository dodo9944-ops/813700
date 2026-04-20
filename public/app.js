(function () {
  const pill = document.getElementById('statusPill');
  fetch('/api/bridge/status').then(r => r.json()).then(s => {
    pill.textContent = s.online ? '브릿지 온라인' : '브릿지 오프라인';
    pill.classList.add(s.online ? 'on' : 'off');
  }).catch(() => {
    pill.textContent = '오프라인';
    pill.classList.add('off');
  });

  const canvas = document.getElementById('scene');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const player = { x: W / 2, y: H / 2, r: 10, color: '#7c5cff' };
  const npcs = [
    { x: 180, y: 140, name: '안내봇', color: '#35d0ff' },
    { x: 760, y: 120, name: '조합장', color: '#3ddc97' },
    { x: 640, y: 360, name: '텔레봇', color: '#ffb86b' },
  ];
  const keys = {};
  window.addEventListener('keydown', e => (keys[e.key.toLowerCase()] = true));
  window.addEventListener('keyup', e => (keys[e.key.toLowerCase()] = false));

  function drawGrid() {
    ctx.strokeStyle = 'rgba(124,92,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  function drawEntity(e, label) {
    ctx.beginPath();
    ctx.fillStyle = e.color;
    ctx.arc(e.x, e.y, e.r || 12, 0, Math.PI * 2);
    ctx.fill();
    if (label) {
      ctx.fillStyle = '#e7e9ff';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label, e.x, e.y - 18);
    }
  }

  let t = 0;
  function loop() {
    t += 0.02;
    ctx.fillStyle = '#070815';
    ctx.fillRect(0, 0, W, H);
    drawGrid();

    const speed = 2.5;
    if (keys['w'] || keys['arrowup']) player.y -= speed;
    if (keys['s'] || keys['arrowdown']) player.y += speed;
    if (keys['a'] || keys['arrowleft']) player.x -= speed;
    if (keys['d'] || keys['arrowright']) player.x += speed;
    player.x = Math.max(12, Math.min(W - 12, player.x));
    player.y = Math.max(12, Math.min(H - 12, player.y));

    npcs.forEach((n, i) => {
      const off = Math.sin(t + i) * 8;
      drawEntity({ ...n, y: n.y + off }, n.name);
    });
    drawEntity(player, 'YOU');

    document.getElementById('pos').textContent =
      `(${Math.round(player.x - W / 2)}, ${Math.round(H / 2 - player.y)})`;
    requestAnimationFrame(loop);
  }
  loop();
})();
