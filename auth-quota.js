/* =========================================================================
 * auth-quota.js — ระบบยืนยันตัวตน + นับโควต้า (กันโกง)
 * -------------------------------------------------------------------------
 * แทรกไฟล์นี้ใน <head> ของ index.html "ก่อน" <script> หลัก
 * ทำงาน: LINE LIFF login -> ผูก Supabase -> นับครั้งบันทึกสะสมที่ backend
 * โค้ดเดิม (UI/สูตร/หน่วย/2 ภาษา) ไม่ถูกแก้ ยกเว้น 3 จุดเล็ก ๆ (ดู README)
 * ======================================================================= */
(function () {
  'use strict';

  // ---- ค่าตั้งต้น (แก้ตรงนี้จุดเดียว) --------------------------------------
  var CONFIG = {
    SUPABASE_URL: 'https://bzemksxqdmnagvzcuske.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6ZW1rc3hxZG1uYWd2emN1c2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTU1MTAsImV4cCI6MjA5NTEzMTUxMH0.TGx9KAws-fIIKodmTuHSpdAhA0wUgrEGZk192NVkLOI',
    FUNCTIONS_URL: 'https://bzemksxqdmnagvzcuske.supabase.co/functions/v1',
    LIFF_ID: '2010175680-yOgHGY8L',
  };

  // global object ที่โค้ดเดิมจะเรียกใช้
  var JackAuth = (window.JackAuth = {
    ready: false,
    isPremium: false, // จะถูกเซ็ตจาก backend
    status: null, // { usage_count, remaining, is_unlimited, limit }
    customerCode: '', // รหัสลูกค้า 8 ตัว (ใช้ส่งให้แอดมินตอนโอนเงิน)
    _supabase: null,
  });

  // โหลด SDK ภายนอกแบบ dynamic (ไม่ต้องแก้ HTML เดิมเพิ่ม)
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error('โหลดไม่สำเร็จ: ' + src));
      };
      document.head.appendChild(s);
    });
  }

  // ---- หน้าจอ overlay บังก่อน login -------------------------------------
  function showGate(message, showRetry) {
    var g = document.getElementById('jackAuthGate');
    if (!g) {
      g = document.createElement('div');
      g.id = 'jackAuthGate';
      g.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:#FAF7F2;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        "gap:14px;text-align:center;padding:24px;font-family:'IBM Plex Sans Thai',sans-serif;";
      document.body.appendChild(g);
    }
    g.innerHTML =
      '<div style="font-size:46px">🧁</div>' +
      '<h2 style="margin:0;color:#1A2B24">พี่แจ็ค เบเกอรี่แมน</h2>' +
      '<p style="color:#5E6B64;margin:0">' + message + '</p>' +
      (showRetry
        ? '<button onclick="location.reload()" style="margin-top:8px;padding:11px 24px;' +
          'border:none;border-radius:10px;background:#06C755;color:#fff;font-size:15px;' +
          "font-family:'IBM Plex Sans Thai',sans-serif;cursor:pointer\">ลองใหม่อีกครั้ง</button>"
        : '<div style="margin-top:6px;width:34px;height:34px;border:3px solid #E0DACE;' +
          'border-top-color:#16C172;border-radius:50%;animation:jackspin .8s linear infinite"></div>' +
          '<style>@keyframes jackspin{to{transform:rotate(360deg)}}</style>');
  }
  function hideGate() {
    var g = document.getElementById('jackAuthGate');
    if (g) g.remove();
  }

  // ---- เรียกตอนกดบันทึกสินค้า: ขออนุญาตจาก backend -----------------------
  // คืน true ถ้าบันทึกได้, false ถ้าโควต้าเต็ม (โค้ดเดิมจะเด้ง showUpgrade)
  JackAuth.consumeQuota = async function () {
    if (JackAuth.isPremium) return true;
    try {
      var r = await JackAuth._supabase.rpc('increment_usage');
      if (r.error || !r.data || r.data.error) return false;
      var d = r.data;
      JackAuth.status = {
        usage_count: d.usage_count,
        remaining: d.remaining,
        is_unlimited: !!d.unlimited,
        limit: d.limit,
      };
      JackAuth.isPremium = !!d.unlimited;
      return !!d.allowed;
    } catch (e) {
      return false;
    }
  };

  // ดึงสถานะปัจจุบัน (ไม่บวกตัวนับ)
  JackAuth.refresh = async function () {
    try {
      var r = await JackAuth._supabase.rpc('get_my_status');
      if (r.error || !r.data || r.data.error) return;
      var d = r.data;
      JackAuth.status = {
        usage_count: d.usage_count,
        remaining: d.remaining,
        is_unlimited: d.is_unlimited,
        limit: d.limit,
      };
      JackAuth.customerCode = d.customer_code || '';
      JackAuth.isPremium = !!d.is_unlimited;
    } catch (e) {}
  };

  // ---- ลำดับการเริ่มทำงาน ------------------------------------------------
  async function init() {
    showGate('กำลังเชื่อมต่อ LINE...', false);
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      await loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js');

      JackAuth._supabase = window.supabase.createClient(
        CONFIG.SUPABASE_URL,
        CONFIG.SUPABASE_ANON_KEY,
        { auth: { persistSession: true, autoRefreshToken: true } }
      );

      // มี session อยู่แล้ว -> ข้าม login
      var sess = await JackAuth._supabase.auth.getSession();
      if (!sess.data.session) {
        await liff.init({ liffId: CONFIG.LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return; // เด้งไป LINE แล้ว reload กลับมา
        }
        showGate('กำลังยืนยันตัวตน...', false);
        var idToken = liff.getIDToken();
        if (!idToken) throw new Error('ไม่พบ ID Token จาก LINE');

        var res = await fetch(CONFIG.FUNCTIONS_URL + '/line-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken }),
        });
        if (!res.ok) throw new Error('ยืนยันตัวตนไม่สำเร็จ');
        var tok = await res.json();
        await JackAuth._supabase.auth.setSession({
          access_token: tok.access_token,
          refresh_token: tok.refresh_token,
        });
      }

      await JackAuth.refresh();
      JackAuth.ready = true;
      hideGate();

      // บอกโค้ดเดิมว่าพร้อมแล้ว -> ให้มัน render ใหม่ด้วยสถานะจริง
      if (typeof window.onJackAuthReady === 'function') window.onJackAuthReady();
    } catch (e) {
      showGate(e && e.message ? e.message : 'เกิดข้อผิดพลาด', true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
