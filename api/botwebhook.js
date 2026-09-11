import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_TG_ID = 8623982085;

// --- 1. АВТОРИЗАЦИЯ (OTP-КОДЫ) ---
bot.command(['start', 'login'], async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await supabase
      .from('telegram_auth_codes')
      .update({ is_used: true })
      .eq('telegram_id', telegramId)
      .eq('is_used', false);

    await supabase
      .from('telegram_auth_codes')
      .insert({ telegram_id: telegramId, code: code, is_used: false });

    await ctx.reply(
      `🔐 *Авторизация на Coolx Pay*\n\nВаш одноразовый код входа:\n\`${code}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Auth Command Error:', err);
  }
});

// --- 2. ОПЛАТА СЧЕТА В TELEGRAM STARS ---
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);

    if (payload.type === 'buy_item') {
      const { buyerId, sellerId, itemId, priceStars } = payload;

      // Комиссия обмена Stars (-14%): из 50 Stars зачисляется 43 Stars
      const sellerEarned = Math.floor(priceStars * 0.86);

      // 1. Получаем текущую заморозку по заказу продавца
      const { data: seller } = await supabase
        .from('profiles')
        .select('frozen_by_order')
        .eq('id', sellerId)
        .single();

      const newFrozenOrder = (seller?.frozen_by_order || 0) + sellerEarned;

      // 2. Начисляем заморозку ПО ЗАКАЗУ продавцу
      await supabase
        .from('profiles')
        .update({ frozen_by_order: newFrozenOrder })
        .eq('id', sellerId);

      // 3. Обновляем статус лота
      await supabase
        .from('items')
        .update({ status: 'in_deal' })
        .eq('id', itemId);

      // 4. Создаем запись о сделке в escrow
      const { data: deal } = await supabase
        .from('deals')
        .insert({
          item_id: itemId,
          buyer_id: buyerId,
          seller_id: sellerId,
          amount_stars: priceStars,
          status: 'escrow'
        })
        .select()
        .single();

      // 5. Записываем транзакции
      await supabase.from('transactions').insert([
        {
          user_id: buyerId,
          order_id: deal ? deal.id : null,
          type_title: 'Покупка: Успешная оплата',
          amount: -priceStars
        },
        {
          user_id: sellerId,
          order_id: deal ? deal.id : null,
          type_title: 'Продажа: Заморожено по заказу',
          amount: sellerEarned
        }
      ]);

      await ctx.reply(`✅ Оплата прошла успешно!\nПерейдите на сайт в раздел "Чаты" для получения товара.`);
    }
  } catch (err) {
    console.error('Successful Payment Error:', err);
  }
});

// --- 3. АДМИН-КНОПКИ ВЫВОДА СРЕДСТВ (TG ID: 8623982085) ---
bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    const adminId = ctx.from.id;

    if (adminId !== ADMIN_TG_ID) {
      return ctx.answerCbQuery('❌ У вас нет прав администратора!');
    }

    // Принятие выплат
    if (data.startsWith('payout_done_')) {
      const payoutId = data.replace('payout_done_', '');
      
      const { data: payout } = await supabase
        .from('payout_requests')
        .select('*')
        .eq('id', payoutId)
        .single();

      if (payout && payout.status === 'pending') {
        await supabase
          .from('payout_requests')
          .update({ status: 'completed' })
          .eq('id', payoutId);

        await supabase.from('transactions').insert({
          user_id: payout.user_id,
          type_title: 'Вывод: Выполнен',
          amount: payout.amount_stars
        });

        if (payout.telegram_id) {
          await bot.telegram.sendMessage(
            payout.telegram_id,
            `✅ Ваша заявка на вывод ${payout.amount_stars} Stars успешно выполнена!`
          );
        }

        await ctx.editMessageText(
          `${ctx.callbackQuery.message.text}\n\n✅ *СТАТУС: ВЫПОЛНЕН*`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // Отказ в выплате
    if (data.startsWith('payout_reject_')) {
      const payoutId = data.replace('payout_reject_', '');

      const { data: payout } = await supabase
        .from('payout_requests')
        .select('*')
        .eq('id', payoutId)
        .single();

      if (payout && payout.status === 'pending') {
        // Возвращаем отмененные средства на доступный баланс
        const { data: user } = await supabase
          .from('profiles')
          .select('balance_stars')
          .eq('id', payout.user_id)
          .single();

        await supabase
          .from('profiles')
          .update({ balance_stars: (user?.balance_stars || 0) + payout.amount_stars })
          .eq('id', payout.user_id);

        await supabase
          .from('payout_requests')
          .update({ status: 'rejected' })
          .eq('id', payoutId);

        await supabase.from('transactions').insert({
          user_id: payout.user_id,
          type_title: 'Вывод: Отказ (Средства возвращены)',
          amount: payout.amount_stars
        });

        if (payout.telegram_id) {
          await bot.telegram.sendMessage(
            payout.telegram_id,
            `🔴 Ваша заявка на вывод ${payout.amount_stars} Stars была отклонена. Средства возвращены на доступный баланс.`
          );
        }

        await ctx.editMessageText(
          `${ctx.callbackQuery.message.text}\n\n🔴 *СТАТУС: ОТКЛОНЕН (Средства возвращены)*`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  } catch (err) {
    console.error('Callback Query Error:', err);
  }
});

// --- EXPORT FOR VERCEL ---
export default async function handler(req, res) {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body, res);
  } else {
    res.status(200).send('Webhook active');
  }
}
