import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const bot = new Telegraf(process.env.BOT_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { buyerId, itemId } = req.body;

    if (!buyerId || !itemId) {
      return res.status(400).json({ error: 'Неверные параметры запроса' });
    }

    // 1. Получаем лот из БД
    const { data: item, error: itemErr } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (itemErr || !item || item.status !== 'active') {
      return res.status(400).json({ error: 'Лот недоступен или уже выкуплен' });
    }

    if (item.seller_id === buyerId) {
      return res.status(400).json({ error: 'Нельзя купить собственный лот' });
    }

    // 2. Получаем профиль покупателя
    const { data: buyer, error: buyerErr } = await supabase
      .from('profiles')
      .select('telegram_id, username')
      .eq('id', buyerId)
      .single();

    if (buyerErr || !buyer || !buyer.telegram_id) {
      return res.status(400).json({ error: 'Telegram ID не привязан. Авторизуйтесь через бота.' });
    }

    // Приводим Telegram ID к числу
    const chatId = Number(buyer.telegram_id);
    const priceAmount = Math.round(Number(item.price_stars));

    if (isNaN(chatId)) {
      return res.status(400).json({ error: 'Некорректный Telegram ID пользователя' });
    }

    // 3. Формируем payload и отправляем чек Telegram Stars
    const invoicePayload = JSON.stringify({
      type: 'buy_item',
      buyerId: buyerId,
      sellerId: item.seller_id,
      itemId: item.id,
      priceStars: priceAmount
    });

    await bot.telegram.sendInvoice(chatId, {
      title: `Покупка: ${item.title}`.substring(0, 32), // Telegram ограничивает длину title до 32 символов
      description: `Оплата лота через гарант-сервис Coolx Pay`.substring(0, 255),
      payload: invoicePayload,
      provider_token: '', // Пусто для Telegram Stars (XTR)
      currency: 'XTR',
      prices: [{ label: 'Оплата Stars', amount: priceAmount }]
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Чек на оплату успешно отправлен в Telegram-бота!' 
    });

  } catch (err) {
    // Выводим точный текст ошибки от Telegram в логи Vercel
    console.error('Buy Item Error Detail:', err.response || err);
    
    const message = err.description || err.message || 'Ошибка сервера при отправке чека в бота';
    return res.status(500).json({ error: message });
  }
}
