(function () {
  fetch('/api/coop/info').then(r => r.json()).then(info => {
    document.getElementById('coopSlogan').textContent = info.slogan;
    document.getElementById('statMembers').textContent = info.members + '명';
    document.getElementById('statFounded').textContent = info.founded;
    document.getElementById('statAddr').textContent = info.address;
    document.getElementById('coopMission').textContent = info.mission;
  });

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
