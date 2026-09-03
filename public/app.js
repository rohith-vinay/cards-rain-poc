/* Aloha cards portal — talks to the sandbox backend on the same origin. */

const $ = (id) => document.getElementById(id);
const money = (cents) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

let ctx = null;         // partners + businesses
let current = null;     // the business currently on screen
let lastTxId = null;    // most recent authorization, for settle / reverse / refund / dispute
let lastAmount = 0;

// ---------------------------------------------------------------- plumbing

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error || body?.detail?.message || `Request failed (${res.status})`);
  return body;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3600);
}

// ---------------------------------------------------------------- rendering

function renderTiles(balances) {
  const tiles = [
    ['Credit limit', balances?.creditLimit, 'Collateral posted by the business'],
    ['Spending power', balances?.spendingPower, 'Available to authorize right now'],
    ['Pending', balances?.pendingCharges, 'Authorized, not yet settled'],
    ['Posted', balances?.postedCharges, 'Settled charges this period'],
  ];
  $('tiles').innerHTML = tiles
    .map(
      ([k, v, n]) => `
      <div class="tile">
        <div class="k">${k}</div>
        <div class="v">${v == null ? '—' : money(v)}</div>
        <div class="n">${n}</div>
      </div>`,
    )
    .join('');
}

function renderCards(cards, partner, businessName) {
  $('cardCount').textContent = cards.length ? `${cards.length} issued` : '';

  if (!cards.length) {
    $('cards').innerHTML =
      '<p class="empty">No cards yet. Issue one to a cardholder to get started.</p>';
    $('spendCard').innerHTML = '<option value="">No cards</option>';
    return;
  }

  const brand = partner?.brand ?? { cardFrom: '#333', cardTo: '#666', cardInk: '#fff' };

  $('cards').innerHTML = cards
    .map((c) => {
      const locked = c.status !== 'active';
      return `
      <div class="cardtile">
        <div class="face ${locked ? 'locked' : ''}"
             style="background:linear-gradient(135deg,${brand.cardFrom},${brand.cardTo});color:${brand.cardInk}">
          <div class="brandrow">
            <span class="pname">${partner?.name ?? 'Mesta'}</span>
            <span class="statustag">${c.status}</span>
            <span class="scheme">VISA</span>
          </div>
          <div class="pan">•••• ${c.last4}</div>
          <div class="meta">
            <span class="owner">
              <span class="holder">${c.holder.toUpperCase()}</span>
              <span class="biz">${(businessName ?? '').toUpperCase()}</span>
            </span>
            <span class="exp">${c.expiry}</span>
          </div>
        </div>
        <div class="cardmeta">
          <span class="who">${c.holder}</span>
          <span class="lim">${c.limit ? `${money(c.limit.amount)} / mo` : 'no limit'}</span>
        </div>
        <div class="cardactions">
          ${
            locked
              ? `<button class="small" data-act="unlock" data-card="${c.id}">Unlock</button>`
              : `<button class="small" data-act="lock" data-card="${c.id}">Lock</button>`
          }
          <button class="small" data-act="limit" data-card="${c.id}">Set limit</button>
        </div>
      </div>`;
    })
    .join('');

  $('spendCard').innerHTML = cards
    .map((c) => `<option value="${c.id}">•••• ${c.last4} — ${c.holder} (${c.status})</option>`)
    .join('');
}

function renderTransactions(txns) {
  if (!txns.length) {
    $('txns').innerHTML = '<p class="empty">No card activity yet.</p>';
    return;
  }
  $('txns').innerHTML = txns
    .map((t) => {
      const when = t.postedAt || t.authorizedAt;
      return `
      <div class="txn">
        <div>
          <div class="m">${t.merchant || 'Unknown merchant'}</div>
          <div class="s">MCC ${t.mcc} · ${when ? new Date(when).toLocaleString() : ''}${
            t.declinedReason ? ` · ${t.declinedReason}` : ''
          }</div>
        </div>
        <span class="pill ${t.status}">${t.status}</span>
        <span class="amt">${money(t.amount)}</span>
      </div>`;
    })
    .join('');
}

function renderEvent(ev) {
  const feed = $('events');
  if (feed.querySelector('.empty')) feed.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'ev';
  row.innerHTML = `
    <div class="t">${ev.resource}.${ev.action}</div>
    <div class="d">
      <span>${new Date(ev.receivedAt).toLocaleTimeString()}</span>
      ${ev.signatureValid ? '<span class="ok">✓ signature verified</span>' : '<span>unverified</span>'}
    </div>`;
  feed.prepend(row);
  while (feed.children.length > 60) feed.lastChild.remove();
}

// ---------------------------------------------------------------- data

async function loadContext() {
  ctx = await api('/api/portal/context');

  const options = ctx.partners
    .flatMap((p) =>
      p.businesses.map(
        (b) => `<option value="${b.companyId}" data-partner="${p.id}">${p.name} › ${b.name}</option>`,
      ),
    )
    .join('');

  const picker = $('businessPicker');
  picker.innerHTML = options || '<option value="">No businesses — run: npm run seed</option>';
  // Browsers restore a previously selected option across reloads; a demo should always
  // open on the same business.
  picker.selectedIndex = 0;

  $('footnote').textContent = ctx.isolationNote +
    ' Card art is resolved from the partner by the backend and never accepted from the browser; ' +
    'the designs shown here are Mesta-side until custom card art is contracted with Rain.';

  if (options) await selectBusiness(picker.value);
  else toast('No businesses provisioned. Run: npm run seed', true);
}

async function selectBusiness(companyId) {
  if (!companyId) return;
  const data = await api(`/api/portal/business/${companyId}`);
  current = data;

  $('businessName').textContent = data.business.name;
  $('partnerLine').textContent = data.partner ? `${data.partner.name} · partner` : 'Direct';
  $('partnerChip').textContent = data.partner?.name ?? '—';
  $('subline').textContent = `${data.cardholders.length} cardholders · company-funded collateral`;
  if (data.partner) document.documentElement.style.setProperty('--accent', data.partner.brand.accent);

  renderTiles(data.balances);
  renderCards(data.cards, data.partner, data.business.name);
  renderTransactions(data.transactions);
}

async function refresh() {
  if (current) await selectBusiness(current.business.companyId);
}

// ---------------------------------------------------------------- actions

$('businessPicker').addEventListener('change', (e) => {
  lastTxId = null;
  $('spendResult').innerHTML = '';
  selectBusiness(e.target.value).catch((err) => toast(err.message, true));
});

$('issueBtn').addEventListener('click', async () => {
  if (!current) return;
  const withoutCard = current.cardholders.filter(
    (h) => !current.cards.some((c) => c.userId === h.id),
  );
  const holder = withoutCard[0] ?? current.cardholders[0];
  if (!holder) return toast('No cardholders on this business.', true);

  $('issueBtn').disabled = true;
  try {
    await api(`/api/users/${holder.id}/cards`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'virtual',
        status: 'active',
        limit: { amount: 250000, frequency: 'per30DayPeriod' },
        companyId: current.business.companyId,
      }),
    });
    toast(`Card issued to ${holder.name}`);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('issueBtn').disabled = false;
  }
});

$('cards').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, card } = btn.dataset;
  btn.disabled = true;
  try {
    if (act === 'lock' || act === 'unlock') {
      await api(`/api/cards/${card}/${act}`, { method: 'POST' });
      toast(act === 'lock' ? 'Card locked' : 'Card unlocked');
    } else if (act === 'limit') {
      const input = prompt('Monthly limit in dollars', '5000');
      if (!input) return;
      const amount = Math.round(parseFloat(input) * 100);
      if (!Number.isInteger(amount) || amount <= 0) return toast('Enter a positive amount.', true);
      await api(`/api/cards/${card}/limit`, {
        method: 'POST',
        body: JSON.stringify({ amount, frequency: 'per30DayPeriod' }),
      });
      toast(`Limit set to ${money(amount)} per month`);
    }
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('spendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cardId = $('spendCard').value;
  if (!cardId) return toast('Issue a card first.', true);
  const amount = Math.round(parseFloat($('amount').value) * 100);
  if (!Number.isInteger(amount) || amount <= 0) return toast('Enter a positive amount.', true);

  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('/api/simulate/authorize', {
      method: 'POST',
      body: JSON.stringify({
        cardId,
        amount,
        currency: 'USD',
        merchantName: $('merchant').value,
        merchantCategoryCode: $('mcc').value,
      }),
    });
    lastTxId = result.transactionId;
    lastAmount = amount;
    if (result.status === 'declined') showVerdict('declined', { reason: result.declinedReason });
    else showVerdict('authorized', { amount });
    await refresh();
  } catch (err) {
    // A locked card is refused outright rather than declined — that refusal is the point.
    $('spendResult').innerHTML = `
      <div class="verdict no">
        <strong>Refused</strong><span>${err.message}</span>
      </div>`;
    await refresh();
  } finally {
    button.disabled = false;
  }
});

/**
 * The verdict bar walks the transaction's real lifecycle, so only the actions Rain
 * will actually accept are offered. A dispute needs a posted transaction, so it only
 * appears once the charge has settled.
 */
function showVerdict(state, detail = {}) {
  const bar = $('spendResult');
  // Never offer to refund more than was actually settled.
  const refundAmount = Math.min(10000, lastAmount || 10000);

  if (state === 'declined') {
    bar.innerHTML = `
      <div class="verdict no">
        <strong>Declined</strong><code>${detail.reason ?? ''}</code>
      </div>`;
    return;
  }
  if (state === 'authorized') {
    bar.innerHTML = `
      <div class="verdict ok">
        <strong>Authorized ${money(detail.amount)}</strong>
        <span>held against spending power</span>
        <button class="small" data-post="settle">Settle</button>
        <button class="small" data-post="reverse">Reverse</button>
      </div>`;
    return;
  }
  if (state === 'settled') {
    bar.innerHTML = `
      <div class="verdict ok">
        <strong>Settled ${money(detail.amount)}</strong>
        <span>the charge has posted</span>
        <button class="small" data-post="refund">Refund ${money(refundAmount)}</button>
        <button class="small" data-post="dispute">Dispute</button>
      </div>`;
    return;
  }
  if (state === 'reversed') {
    bar.innerHTML = `
      <div class="verdict ok">
        <strong>Reversed</strong><span>hold released, nothing posted</span>
      </div>`;
    return;
  }
  if (state === 'refunded') {
    bar.innerHTML = `
      <div class="verdict ok">
        <strong>Refunded ${money(detail.amount ?? refundAmount)}</strong>
        <span>credited back to the business</span>
        <button class="small" data-post="dispute">Dispute</button>
      </div>`;
    return;
  }
  if (state === 'disputed') {
    bar.innerHTML = `
      <div class="verdict ok">
        <strong>Dispute opened &middot; ${money(detail.amount)}</strong>
        <span>filed with the card network, status ${detail.status ?? 'pending'}</span>
      </div>`;
  }
}

$('spendResult').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-post]');
  if (!btn || !lastTxId) return;
  const action = btn.dataset.post;
  btn.disabled = true;

  try {
    if (action === 'dispute') {
      const dispute = await api(`/api/transactions/${lastTxId}/disputes`, {
        method: 'POST',
        body: JSON.stringify({
          disputeType: 'merchandiseIssue',
          textEvidence: 'Goods arrived damaged; the merchant has not credited the account.',
          disputeAmount: Math.min(25000, lastAmount),
        }),
      });
      toast('Dispute opened and filed with the network');
      showVerdict('disputed', { amount: dispute.disputeAmount, status: dispute.status });
    } else {
      const body =
        action === 'settle' ? { amount: lastAmount }
        : action === 'refund' ? { amount: Math.min(10000, lastAmount) }
        : {};
      await api(`/api/simulate/transactions/${lastTxId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (action === 'settle') {
        toast('Settled — the charge has posted');
        showVerdict('settled', { amount: lastAmount });
      } else if (action === 'reverse') {
        toast('Reversed — hold released, nothing posted');
        showVerdict('reversed');
      } else {
        const refunded = Math.min(10000, lastAmount);
        toast(`Refunded ${money(refunded)}`);
        showVerdict('refunded', { amount: refunded });
      }
    }
    await refresh();
  } catch (err) {
    // A dispute needs the charge to have posted, which is not instant after settling.
    const hint = action === 'dispute'
      ? `${err.message} — a dispute needs the charge to have posted. Wait a moment and try again.`
      : err.message;
    toast(hint, true);
    btn.disabled = false;
    return;
  }
});

// ---------------------------------------------------------------- live feed

function connectFeed() {
  const source = new EventSource('/api/events/stream');
  const status = $('feedStatus');

  source.onopen = () => {
    status.className = 'dot on';
    status.textContent = 'live';
  };
  source.onerror = () => {
    status.className = 'dot off';
    status.textContent = 'reconnecting';
  };
  // Named events, so a generic onmessage handler never fires.
  for (const type of [
    'transaction.requested', 'transaction.created', 'transaction.updated',
    'transaction.completed', 'card.updated', 'company.updated', 'user.updated',
    'contract.created', 'dispute.created',
  ]) {
    source.addEventListener(type, (e) => {
      renderEvent(JSON.parse(e.data));
      refresh().catch(() => {});
    });
  }
}

// The ledger must stay correct even if the tunnel drops, so poll independently.
setInterval(() => refresh().catch(() => {}), 15000);

$('events').innerHTML = '<p class="empty">Waiting for webhooks…</p>';
loadContext().catch((err) => toast(err.message, true));
connectFeed();
