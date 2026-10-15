// Click wiring for every control the canvas left unlinked.
// Each rule: [label regex, action]. Action: screen name (go there), 'toast:<msg>',
// 'hide:<selector>' (hide closest ancestor, then toast), or a function(el, api).
// Controls the canvas already wired (data-hot, links to .dc.html) are left alone.
(function () {
  const T = msg => 'toast:' + msg;
  const REACT = (el, api) => api.float(el);

  // Student bottom bar and header, shared by most phone screens.
  const STUDENT = [
    [/^เมนู$/, T('เมนู: เปลี่ยนภาษา · ออกจากเซสชัน')],
    [/เปลี่ยนภาษา/, T('Switched to English (demo)')],
    [/ถูกใจ|หัวใจ|ขำ|ว้าว|ปรบมือ|ส่งรีแอคชัน/, REACT],
    [/^ถาม-ตอบ/, 'S13-QA-list'],
  ];

  const RULES = {
    // Student
    'Main': [],
    'S02-PIN-error': [[/ลองอีกครั้ง/, 'S03-Identity']],
    'S05-Session-full': [[/ลองอีกครั้ง/, 'S03-Identity'], [/PIN อื่น/, 'Main']],
    'S06-Waiting': [[/ปิดแถบรีแอคชัน/, (el, api) => api.hide(el.parentElement, null, 'ปิดแถบรีแอคชันแล้ว', true)]],
    'S07-Poll': [[/เลือกคำตอบก่อนส่ง/, T('เลือกคำตอบก่อนส่ง')], [/^กิจกรรม$/, T('คุณอยู่ที่กิจกรรมแล้ว')]],
    'S07b-Poll-code-math': [[/ส่งคำตอบ/, 'S08-Poll-sent'], [/^กิจกรรม$/, T('คุณอยู่ที่กิจกรรมแล้ว')]],
    'S08-Poll-sent': [[/คำตอบของคุณ/, 'S07-Poll']],
    'S09-Voting-closed': [[/^กิจกรรม$/, 'S10-Poll-results']],
    'S13-QA-list': [[/^ถาม-ตอบ$/, T('คุณอยู่ที่ถาม-ตอบแล้ว')]],
    'S15-Ask-named': [[/ดูตัวอย่าง/, T('ตัวอย่างแสดงด้านล่าง')], [/^$/, 'S14-Ask-anon']],
    'S17-QA-closed': [[/โหวต/, T('ปิดโหวตแล้ว')], [/^กิจกรรม$/, 'S06-Waiting']],
    'S18-Reconnecting': [[/^ส่ง$/, T('จะส่งเมื่อเชื่อมต่อได้')], [/^กิจกรรม$/, 'S06-Waiting']],
    'S19-Connection-lost': [[/ลองเชื่อมต่อ/, 'S18-Reconnecting']],
    'S20-Host-away': [[/ตกลง/, 'S06-Waiting'], [/^กิจกรรม$/, 'S06-Waiting']],
    'E02-Poll-loading': [[/^กิจกรรม$/, 'S07-Poll']],
    'E03-QA-empty': [[/ถามคำถามแรก/, 'S14-Ask-anon'], [/^กิจกรรม$/, 'S06-Waiting'], [/^ถาม-ตอบ$/, T('คุณอยู่ที่ถาม-ตอบแล้ว')]],
    'E04-SSO-error': [[/ลองเข้าสู่ระบบ/, 'S06-Waiting'], [/Guest/, 'S04-Nickname']],

    // Host
    'H00-Login': [[/ไทย/, T('Switched to English (demo)')]],
    'E05-Host-login-error': [[/ลองอีกครั้ง/, 'H01-Decks']],
    'H01-Decks': [[/เด็คของฉัน/, T('คุณอยู่ที่เด็คของฉันแล้ว')], [/^บัญชี/, T('บัญชี: โปรไฟล์ · ออกจากระบบ')]],
    'H12-History': [[/ประวัติเซสชัน/, T('คุณอยู่ที่ประวัติเซสชันแล้ว')], [/^บัญชี/, T('บัญชี: โปรไฟล์ · ออกจากระบบ')]],
    'H02-Editor': [
      [/ดูตัวอย่าง/, 'P03-Poll-live'],
      [/^7 Word Cloud/, 'H04-Preflight'],
      [/^4 /, 'P09-Code'], [/^5 /, 'P08-Math'],
      [/เพิ่มสไลด์/, 'H03-Add-slide'],
      [/มือถือนักศึกษา/, (el, api) => { api.select(el); api.go('S07-Poll'); }],
      [/ลบตัวเลือก/, 'hide:.optrow'],
      [/เพิ่มตัวเลือก/, T('เพิ่มตัวเลือก E แล้ว')],
    ],
    'H03-Add-slide': [
      [/ตั้งค่าเซสชัน/, 'H04b-Settings'], [/ดูตัวอย่าง/, 'P02-Content'], [/เริ่มเซสชัน/, 'H04-Preflight'],
      [/^ยกเลิก$/, 'hide:section'], [/ลองหน้า 7/, T('แปลงหน้า 7 สำเร็จ')],
      [/^ปิด$/, 'H02-Editor'],
      [/^Live Poll/, 'H02-Editor'], [/^Word Cloud/, 'H04-Preflight'],
      [/ข้อความ|โค้ด|คณิตศาสตร์|รูปภาพ/, (el, api) => api.toast('เพิ่มสไลด์ ' + api.label(el).split(' ')[0] + ' แล้ว')],
      [/นำเข้า PDF/, T('เลือกไฟล์ PDF…')],
    ],
    'H04-Preflight': [
      [/กลับไปคุมเซสชัน/, 'H05-Presenter'], [/ดูตัวอย่าง/, 'P05-WordCloud'], [/เริ่มเซสชัน/, 'H05-Presenter'],
      [/^6 Live Poll/, 'H02-Editor'], [/ลบกิจกรรม/, T('ลบกิจกรรมแล้ว')],
    ],
    'H04b-Settings': [],
    'H05-Presenter': [
      [/ออนไลน์|เชิญผู้ช่วย/, 'H08-People'],
      [/สไลด์ก่อนหน้า/, T('สไลด์ 5')],
      [/ไปยังสไลด์/, 'R3-Slide-lookup'],
      [/แสดงบนจอ/, 'P06-QA'],
    ],
    'H06-Presenter-QA': [
      [/ซ่อนคำ/, 'R3-Synonyms'], [/เปิดรับอีกครั้ง/, T('เปิดรับคำตอบอีกครั้ง')], [/ซ่อนผล/, T('ซ่อนผลบนจอแล้ว')],
      [/ไปกิจกรรมถัดไป/, 'P06-QA'], [/ปิดแผงถาม-ตอบ/, 'H05-Presenter'],
      [/ตัวเลือกเพิ่มเติม/, T('ตัวเลือก: ปักหมุด · แก้ไข · ลบ')], [/ซ้ำกับ/, 'R2-QA-clusters'], [/นำผู้ส่งออก/, 'H08-People'],
    ],
    'H07-Activity-states': [[/./, (el, api) => api.toast(api.label(el).replace(/ (Space|S)$/, '') + ' ✓')]],
    'H08-People': [
      [/^ปิด$/, 'H05-Presenter'], [/^เชิญ$/, T('ส่งคำเชิญผู้ช่วยแล้ว')], [/คัดลอกลิงก์/, T('คัดลอกลิงก์เชิญแล้ว')],
      [/^ตัวเลือกสำหรับ/, T('ตัวเลือก: เปลี่ยนชื่อ · นำออก')], [/เปลี่ยนชื่อ/, T('เปลี่ยนชื่อเป็น Guest 17 แล้ว')],
      [/นำออกจากเซสชัน/, T('นำออกจากเซสชันแล้ว')],
    ],
    'H09-End-session': [[/กดค้างไว้/, 'H13-Results'], [/เปิดจอโปรเจกเตอร์/, 'P01-Lobby']],
    'H11-Cohost-QA': [
      [/รับช่วง/, 'H05-Presenter'], [/ปิดรับคำถาม/, T('ปิดรับคำถามแล้ว')], [/แสดงบนจอ/, 'P06-QA'],
      [/^ตอบแล้ว$/, 'hide:article'], [/^ซ่อน$/, 'hide:article'], [/เอาออกจากจอ/, T('เอาออกจากจอแล้ว')],
      [/ซ้ำกับ/, 'R2-QA-clusters'], [/นำผู้ส่งออก/, T('นำผู้ส่งออกแล้ว')],
    ],
    'H13-Results': [[/^$/, 'R2-Analytics']],
    'H-Reconnecting': [[/ลองตอนนี้/, 'H05-Presenter'], [/./, T('ออฟไลน์อยู่ จะส่งเมื่อเชื่อมต่อได้')]],

    // Roadmap
    'R2-Analytics': [[/ผลเซสชัน/, 'H13-Results'], [/PDF/, T('กำลังส่งออก PDF…')]],
    'R2-QA-clusters': [[/ไม่จัดกลุ่ม/, 'H11-Cohost-QA'], [/แสดงบนจอ/, 'P06-QA'], [/ตอบแล้วทั้งกลุ่ม/, 'hide:article'], [/แยกกลุ่ม|ไม่ใช่เรื่องเดียวกัน/, T('แยกกลุ่มแล้ว')]],
    'R2-Quiz-editor': [[/ดูตัวอย่าง/, 'R2-Leaderboard'], [/เริ่มเซสชัน/, 'R2-Quiz-student'], [/^6 Live Poll/, 'H02-Editor'], [/^8 Word Cloud/, 'H04-Preflight']],
    'R2-Quiz-student': [[/./, (el, api) => { api.select(el); setTimeout(() => api.go('R2-Quiz-result'), 450); }]],
    'R3-AI-Suggestion': [
      [/แผนกิจกรรม AI/, T('สร้างแผนใหม่…')], [/เริ่มเซสชัน/, 'H04-Preflight'],
      [/เพิ่มเข้าเด็ค/, (el, api) => api.hide(el, 'article', 'เพิ่มเข้าเด็คแล้ว')],
      [/แก้ก่อนเพิ่ม/, 'H02-Editor'], [/^ข้าม$/, 'hide:article'],
    ],
    'R3-Slide-lookup': [[/แสดงบนจอโดยไม่ย้าย/, 'R3-Peek-presenter'], [/ไปสไลด์นี้/, 'H05-Presenter'], [/ค้นหา/, T('กำลังค้นหาสไลด์…')]],
    'R3-Peek-presenter': [[/กลับสไลด์|ไปสไลด์/, 'H05-Presenter'], [/เอาออกจากจอ/, 'R3-Slide-lookup'], [/ปิดรับ|แสดงผล/, 'P04-Poll-results']],
    'R3-Synonyms': [[/^รวมคำ$/, (el, api) => api.hide(el, 'article', 'รวมคำแล้ว')], [/^ไม่รวม$/, 'hide:article'], [/./, T('ทำแล้ว')]],
  };

  // Screens whose tabs have no drawn content per tab (S13 has its own real tab logic).
  const PANELS = new Set(['R2-QA-clusters']);

  // Click anywhere (outside controls) on screens that have nothing to click.
  const TAP = {
    'P01-Lobby': 'P02-Content', 'P02-Content': 'P03-Poll-live', 'P03-Poll-live': 'P04-Poll-results',
    'P04-Poll-results': 'P05-WordCloud', 'P05-WordCloud': 'P06-QA', 'P06-QA': 'P08-Math', 'P08-Math': 'P09-Code',
    'P09-Code': 'P07-Ended', 'P07-Ended': 'P07b-Blank', 'P07b-Blank': 'P01-Lobby',
    'P-Zero-responses': 'P04-Poll-results', 'P-Reconnecting': 'P01-Lobby',
    'H10-Mirror-overlay': 'H05-Presenter',
    'S21-Ended': 'Main',
    'R2-Quiz-result': 'R2-Leaderboard', 'R2-Leaderboard': 'R2-Team', 'R2-Team': 'R2-Analytics',
    'R3-Peek-projector': 'P02-Content',
  };

  // Loading and reconnecting screens move on by themselves.
  const AUTO = {
    'E01-Joining': ['S06-Waiting', 1800],
    'E02-Poll-loading': ['S07-Poll', 1800],
    'S18-Reconnecting': ['S06-Waiting', 2500],
    'P-Reconnecting': ['P01-Lobby', 2500],
  };

  const label = el => (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim();

  // Copy inline styles from one element tree onto another of the same shape.
  function copyStyles(from, to) {
    const a = [from, ...from.querySelectorAll('*')], b = [to, ...to.querySelectorAll('*')];
    if (a.length !== b.length) { to.setAttribute('style', from.getAttribute('style') || ''); return; }
    a.forEach((n, i) => {
      const s = n.getAttribute('style');
      if (s == null) b[i].removeAttribute('style'); else b[i].setAttribute('style', s);
      if (n.getAttribute('class') != null) b[i].setAttribute('class', n.getAttribute('class'));
    });
  }
  const snap = el => {
    const c = el.cloneNode(true);
    return c;
  };

  const STATE = { switch: 'aria-checked', checkbox: 'aria-checked', radio: 'aria-checked', tab: 'aria-selected' };

  function stateAttr(el) {
    const r = el.getAttribute('role');
    if (STATE[r]) return STATE[r];
    if (el.hasAttribute('aria-pressed')) return 'aria-pressed';
    if (el.classList.contains('thumb')) return 'aria-current';
    return null;
  }
  const isOn = (el, attr) => el.getAttribute(attr) === 'true';

  // Siblings in the same group: same role/kind, nearest ancestor that holds several.
  function group(el, attr) {
    const sel = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : (attr === 'aria-current' ? '.thumb' : `[${attr}]`);
    let p = el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const all = [...p.querySelectorAll(sel)];
      if (all.length > 1) return all;
    }
    return [el];
  }

  // Exclusive select (tab, radio, pressed, thumb): new one takes the "on" look.
  function select(el) {
    const attr = stateAttr(el);
    if (!attr) return;
    const sibs = group(el, attr);
    const old = sibs.find(s => s !== el && isOn(s, attr));
    if (!old) { el.setAttribute(attr, 'true'); return; }
    const before = snap(el);
    copyStyles(old, el);
    copyStyles(before, old);
    el.setAttribute(attr, 'true');
    old.setAttribute(attr, attr === 'aria-current' ? 'false' : 'false');
  }

  // Toggle (switch, checkbox): borrow the look of any element in the opposite state.
  function toggle(el) {
    const attr = stateAttr(el);
    const on = !isOn(el, attr);
    const doc = el.ownerDocument;
    const ex = [...doc.querySelectorAll(`[role="${el.getAttribute('role')}"]`)].find(s => s !== el && isOn(s, attr) === on);
    if (ex) copyStyles(ex, el);
    else if (el.getAttribute('role') === 'switch') {
      el.style.background = on ? '#d63a0e' : '#94a3b8';
      el.style.justifyContent = on ? 'flex-end' : 'flex-start';
    }
    el.setAttribute(attr, String(on));
  }

  window.protoWire = function (doc, screen, host) {
    const api = {
      go: s => host.go(s.endsWith('.dc.html') ? s : s + '.dc.html'),
      toast: host.toast,
      label,
      select,
      hide(el, sel, msg, self) {
        const box = self ? el : sel && el.closest(sel);
        if (box) { box.style.transition = 'opacity .2s'; box.style.opacity = '0'; setTimeout(() => (box.style.display = 'none'), 200); }
        host.toast(msg || label(el) + ' ✓');
      },
      float(el) {
        const r = el.getBoundingClientRect();
        const b = doc.createElement('div');
        b.textContent = '+1';
        b.style.cssText = `position:fixed;left:${r.left + r.width / 2 - 12}px;top:${r.top - 6}px;font:700 16px system-ui;color:#d63a0e;pointer-events:none;transition:transform .7s ease-out,opacity .7s;z-index:99`;
        doc.body.appendChild(b);
        requestAnimationFrame(() => { b.style.transform = 'translateY(-60px)'; b.style.opacity = '0'; });
        setTimeout(() => b.remove(), 750);
        host.toast('ส่งรีแอคชันแล้ว');
      },
    };

    const css = doc.createElement('style');
    css.textContent = 'button:disabled{pointer-events:none}' + (TAP[screen] ? 'body{cursor:pointer}' : '');
    doc.head.appendChild(css);

    // Tab content the canvas never drew: first tab shows the real list, the rest a sketch card.
    function swapPanel(tab, lab) {
      const list = tab.closest('[role="tablist"]');
      if (!list) return;
      const tabs = [...list.querySelectorAll('[role="tab"]')].filter(t => label(t));
      const first = tabs[0] === tab;
      // Everything drawn after the tab bar: cards anywhere below it, or the one block that follows it.
      const kids = screen === 'H13-Results' ? [list.nextElementSibling] :
        [...doc.querySelectorAll('article, .qi, .cluster')].filter(n => list.compareDocumentPosition(n) & 4);
      kids.forEach(n => { if (n) n.style.display = first ? '' : 'none'; });
      let ph = doc.querySelector('[data-proto-ph]');
      if (first) { if (ph) ph.remove(); return; }
      if (!ph) {
        ph = doc.createElement('div');
        ph.setAttribute('data-proto-ph', '');
        ph.style.cssText = 'border:2px dashed #cbd5e1;border-radius:12px;padding:40px 20px;text-align:center;color:#475569;background:#f8fafc;font-size:15px;line-height:24px';
        const anchor = kids[0] || list;
        anchor.parentElement.insertBefore(ph, kids[0] ? anchor : list.nextSibling);
      }
      ph.innerHTML = '<b style="display:block;color:#0f172a;font-size:16px">' + lab.replace(/</g, '&lt;') + '</b>เนื้อหาแท็บนี้เป็นภาพร่าง ยังไม่ได้ออกแบบ';
    }

    const rules = [...(RULES[screen] || []), ...(/^(S|E0[1-4])/.test(screen) ? STUDENT : [])];

    function run(action, el) {
      if (typeof action === 'function') return action(el, api);
      if (action.startsWith('toast:')) return host.toast(action.slice(6));
      if (action.startsWith('hide:')) return api.hide(el, action.slice(5));
      api.go(action);
    }

    doc.addEventListener('click', e => {
      const el = e.target.closest('button, a, [role="switch"], [role="tab"], [role="radio"], [role="checkbox"]');
      if (!el) {
        if (e.target.closest('input, textarea, select, label')) return;
        // Disabled buttons swallow clicks; they pass through (CSS below), so explain why.
        const off = [...doc.querySelectorAll('button:disabled')].find(n => {
          const r = n.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (off) { host.toast('ยังกดไม่ได้: ' + (label(off) || 'ปุ่มนี้')); return; }
        if (doc.querySelector('[role="dialog"]') && e.target.closest('[aria-hidden="true"]')) { host.toast('ทำรายการในหน้าต่างนี้ก่อน'); return; }
        if (TAP[screen]) { api.go(TAP[screen]); return; }
        host.flash();
        return;
      }
      if (el.hasAttribute('data-hot')) return;
      const href = el.getAttribute('href');
      if (href && href.endsWith('.dc.html')) return;
      if (href) e.preventDefault();

      const lab = label(el);
      const rule = rules.find(([re]) => re.test(lab));
      const attr = stateAttr(el);
      const role = el.getAttribute('role');

      // State change first, so a rule that navigates still shows feedback.
      if (el.getAttribute('aria-disabled') === 'true') { host.toast('ยังกดไม่ได้: ' + lab); return; }
      if (role === 'switch' || role === 'checkbox') toggle(el);
      else if (attr && !rule) {
        if (isOn(el, attr)) { host.toast(lab.split('\n')[0] + ' (เลือกอยู่แล้ว)'); return; }
        select(el);
        if (role === 'tab' && PANELS.has(screen)) swapPanel(el, lab);
        if (role === 'tab' || el.classList.contains('thumb')) host.toast('ตัวอย่าง: แสดง "' + lab.replace(/\s+/g, ' ').slice(0, 30) + '"');
      }

      if (rule) run(rule[1], el);
      else if (role === 'switch') host.toast(lab + (isOn(el, 'aria-checked') ? ': เปิด' : ': ปิด'));
      else if (!attr) host.toast(lab ? lab + ' ✓' : 'ทำแล้ว');
    }, true);

    if (AUTO[screen]) {
      const [to, ms] = AUTO[screen];
      const t = setTimeout(() => { if (doc.defaultView) api.go(to); }, ms);
      doc.defaultView.addEventListener('pagehide', () => clearTimeout(t));
    }
  };

  window.protoTapScreens = TAP;
})();
