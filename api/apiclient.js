export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`

/**
 * Запрос вызова оплаты товара (Бот присылает чек Stars в ЛС)
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
 * Подтверждение получения товара (Переводит заморозку в 20 дней)
 */
async function apiConfirmDeal(buyerId, dealId) {
  const res = await fetch('/api/confirmdeal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId, dealId })
  });
  return await res.json();
}

/**
 * Отправка заявки на вывод Stars
 */
async function apiRequestPayout(userId, amount, target) {
  const res = await fetch('/api/requestpayout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, amount: Number(amount), target })
  });
  return await res.json();
}

`);
}
