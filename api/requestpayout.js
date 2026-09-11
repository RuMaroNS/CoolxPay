import { createClient } from '@supabase/supabase-js';
import { Telegraf, Markup } from 'telegraf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_TG_ID = 8623982085;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { userId, amount, target } = req.body;

    if (!userId || !amount || amount < 50 || !target) {
      return res.status(400).json({ error: 'Заполните корректно сумму (мин. 50 Stars) и реквизиты' });
    }

    // 1. Получаем пользователя
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // 2. Проверка 20-дневной заморозки (если время прошло — переносим на доступный баланс)
    let currentAvailable = user.balance_stars || 0;
    let currentFrozenTime = user.frozen_by_time || 0;

    if (user.unfreezes_at && new Date(user.unfreezes_at) <= new Date() && currentFrozenTime > 0) {
      currentAvailable += currentFrozenTime;
      currentFrozenTime = 0;

      await supabase
        .from('profiles')
        .update({
          balance_stars: currentAvailable,
          frozen_by_time: 0
        })
        .eq('id', userId);
    }

    // 3. Проверяем достаточность размороженных средств
    if (currentAvailable < amount) {
      return res.status(400).json({ 
        error: `Недостаточно размороженных Stars! Доступно: ${currentAvailable} Stars. Ожидают разморозки 20 дней: ${currentFrozenTime} Stars.` 
      });
    }

    // Комиссия вывода: -7 Stars
    const finalPayoutAmount = Math.max(1, amount - 7);

    // 4. Списываем доступный баланс
    await supabase
      .from('profiles')
      .update({ balance_stars: currentAvailable - amount })
      .eq('id', userId);

    // 5. Создаем заявку на вывод
    const { data: payout } = await supabase
      .from('payout_requests')
      .insert({
        user_id: userId,
        telegram_id: user.telegram_id,
        amount_stars: finalPayoutAmount,
        target_details: target,
        status: 'pending'
      })
      .select()
      .single();

    // 6. Добавляем в транзакции
    await supabase.from('transactions').insert({
      user_id: userId,
      type_title: 'Вывод: Принят (в ожидании)',
      amount: -amount
    });

    // 7. Отправляем уведомление администратору (8623982085)
    const adminMessage = 
      `💸 *НОВАЯ ЗАЯВКА НА ВЫВОД STARS*\n\n` +
      `👤 *Пользователь:* @${user.username || 'без_юзернейма'} (ID: \`${user.telegram_id}\`)\n` +
      `💰 *Запрошено:* ${amount} Stars\n` +
      `🔻 *К выплате (-7 комиссия):* ${finalPayoutAmount} Stars\n` +
      `🎯 *Реквизиты:* \`${target}\``;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Выполнено', `payout_done_${payout.id}`),
        Markup.button.callback('🔴 Отказать', `payout_reject_${payout.id}`)
      ]
    ]);

    await bot.telegram.sendMessage(ADMIN_TG_ID, adminMessage, {
      parse_mode: 'Markdown',
      ...keyboard
    });

    return res.status(200).json({
      success: true,
      message: 'Заявка на вывод отправлена администратору!'
    });

  } catch (err) {
    console.error('Request Payout Error:', err);
    return res.status(500).json({ error: 'Ошибка при оформлении заявки на вывод' });
  }
}
