(function () {
  const cfg = window.METASPACE_CONFIG || { apiBase: '', environment: 'server' };
  const STATIC_FALLBACK = {
    name: '메타공간 협동조합',
    slogan: '가상과 현실을 잇는 공동체',
    founded: '2024-03-01',
    members: 128,
    mission: '누구나 소유하고 함께 운영하는 메타버스 공공재',
    address: '서울특별시 메타구 공간동 8137-00',
  };
  function render(info) {
    document.getElementById('coopSlogan').textContent = info.slogan;
    document.getElementById('statMembers').textContent = info.members + '명';
    document.getElementById('statFounded').textContent = info.founded;
    document.getElementById('statAddr').textContent = info.address;
    document.getElementById('coopMission').textContent = info.mission;
  }
  const endpoint = (cfg.apiBase || '') + '/api/coop/info';
  if (cfg.environment === 'pages' && !cfg.apiBase) {
    render(STATIC_FALLBACK);
  } else {
    fetch(endpoint).then(r => r.json()).then(render).catch(() => render(STATIC_FALLBACK));
  }

  const form = document.getElementById('joinForm');
  const msg = document.getElementById('joinMsg');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name || !data.contact) {
      msg.textContent = '이름과 연락 수단은 필수입니다.';
      return;
    }
    const local = JSON.parse(localStorage.getItem('coopApplicants') || '[]');
    local.push({ ...data, ts: new Date().toISOString() });
    localStorage.setItem('coopApplicants', JSON.stringify(local));
    msg.textContent = `${data.name}님, 가입 신청이 접수되었습니다. 곧 연락드립니다.`;
    form.reset();
  });
})();
