import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { userId, starsAmount } = req.body;

    if (!userId || !starsAmount || starsAmount <= 0) {
      return res.status(400).json({ error: 'Укажите ID пользователя и сумму' });
    }

    // Создаем ссылку на оплату Stars
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: 'Пополнение баланса Coolx Pay',
      description: `Пополнение счета на ${starsAmount} Stars`,
      payload: JSON.stringify({ userId, starsAmount: Number(starsAmount), type: 'deposit' }),
      provider_token: '', // Для Telegram Stars оставляем пустым
      currency: 'XTR',
      prices: [{ label: `${starsAmount} Stars`, amount: Number(starsAmount) }]
    });

    return res.status(200).json({ success: true, invoiceLink });
  } catch (err) {
    console.error('Deposit Link Error:', err);
    return res.status(500).json({ error: 'Ошибка генерации инвойса', details: err.message });
  }
}
