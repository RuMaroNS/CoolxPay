import { createClient } from '@supabase/supabase-js';
import { Telegraf, Markup } from 'telegraf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_TG_ID = 8623982085;

// === НАСТРОЙКА ЛОГИКИ TELEGRAF БОТА ===

// 1. Команда авторизации
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
      .insert({ telegram_id: telegramId, code, is_used: false });

    await ctx.reply(
      `🔐 *Авторизация на Coolx Pay*\n\nВаш одноразовый код входа:\n\`${code}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Auth Command Error:', err);
  }
});

// 2. Оплата Stars (pre_checkout & successful_payment)
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);

    if (payload.type === 'buy_item') {
      const { buyerId, sellerId, itemId, priceStars } = payload;
      const sellerEarned = Math.floor(priceStars * 0.86);

      const { data: seller } = await supabase
        .from('profiles')
        .select('frozen_by_order')
        .eq('id', sellerId)
        .single();

      const newFrozenOrder = (seller?.frozen_by_order || 0) + sellerEarned;

      await supabase
        .from('profiles')
        .update({ frozen_by_order: newFrozenOrder })
        .eq('id', sellerId);

      await supabase
        .from('items')
        .update({ status: 'in_deal' })
        .eq('id', itemId);

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

// 3. Админ-кнопки выплат
bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    if (ctx.from.id !== ADMIN_TG_ID) {
      return ctx.answerCbQuery('❌ У вас нет прав администратора!');
    }

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

    if (data.startsWith('payout_reject_')) {
      const payoutId = data.replace('payout_reject_', '');
      const { data: payout } = await supabase
        .from('payout_requests')
        .select('*')
        .eq('id', payoutId)
        .single();

      if (payout && payout.status === 'pending') {
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
            `🔴 Ваша заявка на вывод ${payout.amount_stars} Stars была отклонена.`
          );
        }

        await ctx.editMessageText(
          `${ctx.callbackQuery.message.text}\n\n🔴 *СТАТУС: ОТКЛОНЕН*`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  } catch (err) {
    console.error('Callback Query Error:', err);
  }
});


// === ЕДИНЫЙ ТОЧЕЧНЫЙ ОБРАБОТЧИК ЗАПРОСОВ (ROUTER) ===

export default async function handler(req, res) {
  // Вытаскиваем путь запроса
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // 1. Webhook от Telegram
    if (pathname === '/api/botwebhook' || pathname === '/api') {
      if (req.method === 'POST') {
        await bot.handleUpdate(req.body, res);
        return;
      }
      return res.status(200).send('Webhook active');
    }

    // 2. Отправка чека покупки (buyitem)
    if (pathname === '/api/buyitem') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
      const { buyerId, itemId } = req.body;

      const { data: item } = await supabase.from('items').select('*').eq('id', itemId).single();
      if (!item || item.status !== 'active') return res.status(400).json({ error: 'Лот недоступен' });

      const { data: buyer } = await supabase.from('profiles').select('telegram_id').eq('id', buyerId).single();
      if (!buyer || !buyer.telegram_id) return res.status(400).json({ error: 'Telegram ID не привязан' });

      const invoicePayload = JSON.stringify({
        type: 'buy_item',
        buyerId,
        sellerId: item.seller_id,
        itemId: item.id,
        priceStars: Number(item.price_stars)
      });

      await bot.telegram.sendInvoice(buyer.telegram_id, {
        title: `Покупка: ${item.title}`,
        description: `Оплата лота через гарант-сервис Coolx Pay`,
        payload: invoicePayload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: item.title, amount: Number(item.price_stars) }]
      });

      return res.status(200).json({ success: true, message: 'Чек отправлен в бота!' });
    }

    // 3. Подтверждение сделки (confirmdeal)
    if (pathname === '/api/confirmdeal') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
      const { buyerId, dealId } = req.body;

      const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();
      if (!deal || deal.buyer_id !== buyerId || deal.status !== 'escrow') {
        return res.status(400).json({ error: 'Сделка недоступна' });
      }

      const sellerEarned = Math.floor(deal.amount_stars * 0.86);
      const { data: seller } = await supabase.from('profiles').select('frozen_by_order, frozen_by_time, completed_deals').eq('id', deal.seller_id).single();

      const unfreezeDate = new Date();
      unfreezeDate.setDate(unfreezeDate.getDate() + 20);

      await supabase.from('profiles').update({
        frozen_by_order: Math.max(0, (seller?.frozen_by_order || 0) - sellerEarned),
        frozen_by_time: (seller?.frozen_by_time || 0) + sellerEarned,
        unfreezes_at: unfreezeDate.toISOString(),
        completed_deals: (seller?.completed_deals || 0) + 1
      }).eq('id', deal.seller_id);

      await supabase.from('deals').update({ status: 'completed' }).eq('id', dealId);
      await supabase.from('items').update({ status: 'sold' }).eq('id', deal.item_id);

      await supabase.from('transactions').insert([
        { user_id: deal.buyer_id, order_id: dealId, type_title: 'Покупка: Успешно завершено', amount: -deal.amount_stars },
        { user_id: deal.seller_id, order_id: dealId, type_title: 'Продажа: Заморожено на 20 дней', amount: sellerEarned }
      ]);

      return res.status(200).json({ success: true });
    }

    // 4. Запрос на вывод (requestpayout)
    if (pathname === '/api/requestpayout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
      const { userId, amount, target } = req.body;

      const { data: user } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

      let currentAvailable = user.balance_stars || 0;
      let currentFrozenTime = user.frozen_by_time || 0;

      if (user.unfreezes_at && new Date(user.unfreezes_at) <= new Date() && currentFrozenTime > 0) {
        currentAvailable += currentFrozenTime;
        currentFrozenTime = 0;
        await supabase.from('profiles').update({ balance_stars: currentAvailable, frozen_by_time: 0 }).eq('id', userId);
      }

      if (currentAvailable < amount) {
        return res.status(400).json({ error: `Недостаточно размороженных Stars! Доступно: ${currentAvailable}` });
      }

      const finalPayoutAmount = Math.max(1, amount - 7);

      await supabase.from('profiles').update({ balance_stars: currentAvailable - amount }).eq('id', userId);

      const { data: payout } = await supabase.from('payout_requests').insert({
        user_id: userId,
        telegram_id: user.telegram_id,
        amount_stars: finalPayoutAmount,
        target_details: target,
        status: 'pending'
      }).select().single();

      await supabase.from('transactions').insert({ user_id: userId, type_title: 'Вывод: Принят', amount: -amount });

      const adminMessage = 
        `💸 *НОВАЯ ЗАЯВКА НА ВЫВОД STARS*\n\n` +
        `👤 *Пользователь:* @${user.username || 'без_юзернейма'} (ID: \`${user.telegram_id}\`)\n` +
        `💰 *Запрошено:* ${amount} Stars\n` +
        `🔻 *К выплате (-7):* ${finalPayoutAmount} Stars\n` +
        `🎯 *Реквизиты:* \`${target}\``;

      await bot.telegram.sendMessage(ADMIN_TG_ID, adminMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Выполнено', `payout_done_${payout.id}`),
            Markup.button.callback('🔴 Отказать', `payout_reject_${payout.id}`)
          ]
        ])
      });

      return res.status(200).json({ success: true });
    }

    // 5. Конфиг (config)
    if (pathname === '/api/config') {
      return res.status(200).json({
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
      });
    }

    // 6. Файл клиенсткого скрипта (apiclient.js)
    if (pathname === '/api/apiclient' || pathname === '/api/apiclient.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.status(200).send(`
        async function apiBuyItem(buyerId, itemId) {
          const res = await fetch('/api/buyitem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buyerId, itemId })
          });
          return await res.json();
        }
        async function apiConfirmDeal(buyerId, dealId) {
          const res = await fetch('/api/confirmdeal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buyerId, dealId })
          });
          return await res.json();
        }
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

    return res.status(404).json({ error: 'Endpoint Not Found' });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
