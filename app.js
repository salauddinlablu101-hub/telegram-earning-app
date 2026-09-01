const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const initData = tg?.initData || "";
const headers = {"Content-Type":"application/json","X-Telegram-Init-Data":initData};

async function api(url, options={}) {
  const r = await fetch(url, {...options, headers:{...headers,...(options.headers||{})}});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

function render(data) {
  const u = data.user;
  document.getElementById("name").textContent = u.first_name || u.username || "User";
  document.getElementById("avatar").textContent = (u.first_name || "U")[0].toUpperCase();
  document.getElementById("balance").textContent = Number(u.balance).toFixed(2);
  document.getElementById("referrals").textContent = u.referrals || 0;
  document.getElementById("taskCount").textContent = data.tasks.length;

  const link = data.botUsername
    ? `https://t.me/${data.botUsername}?start=ref_${u.telegram_id}`
    : "";
  document.getElementById("refLink").value = link;

  const box = document.getElementById("tasks");
  box.innerHTML = data.tasks.map(t => `
    <div class="task card">
      <div>
        <b>${escapeHtml(t.title)}</b>
        <div class="muted">Reward: ৳${Number(t.reward).toFixed(2)}</div>
      </div>
      <button onclick="claim(${t.id}, '${escapeAttr(t.url||"")}')">Earn</button>
    </div>
  `).join("") || `<div class="card muted">No active tasks yet.</div>`;
}

async function load() {
  try {
    const data = await api("/api/me");
    render(data);
  } catch (e) {
    document.getElementById("name").textContent = "Open this app from Telegram";
    console.error(e);
  }
}

async function claim(id, url) {
  if (url) window.open(url, "_blank");
  try {
    const data = await api("/api/claim-task", {
      method:"POST", body:JSON.stringify({taskId:id})
    });
    alert(`You earned ৳${Number(data.reward).toFixed(2)}`);
    load();
  } catch(e) { alert(e.message); }
}

async function withdraw() {
  try {
    await api("/api/withdraw", {
      method:"POST",
      body:JSON.stringify({
        amount:document.getElementById("amount").value,
        method:document.getElementById("method").value,
        account:document.getElementById("account").value
      })
    });
    document.getElementById("message").textContent = "Withdrawal request submitted.";
    load();
  } catch(e) {
    document.getElementById("message").textContent = e.message;
  }
}

function copyRef() {
  const el = document.getElementById("refLink");
  navigator.clipboard.writeText(el.value).then(()=>alert("Referral link copied."));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g,"&#96;"); }

load();
