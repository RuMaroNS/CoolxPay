export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`

// js/apiclient.js

/**
 * Создает инвойс для пополнения Stars
 */
async function apiDepositStars(userId, starsAmount) {
  const res = await fetch('/api/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, starsAmount: Number(starsAmount) })
  });
  return await res.json();
}

/**
 * Покупка лота через Гарант (заморозка)
 */
async function apiBuyItem(buyerId, itemId) {
  const res = await fetch('/api/buyitem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId, itemId })
  });
  return await res.json();
}

/**
 * Подтверждение сделки (выплата продавцу)
 */
async function apiConfirmDeal(buyerId, dealId) {
  const res = await fetch('/api/confirmdeal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId, dealId })
  });
  return await res.json();
}

`);
}
