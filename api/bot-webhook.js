import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const bot = new Telegraf(process.env.BOT_TOKEN);

// Подтверждение оплаты до списания
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

// Начисление средств после оплаты
bot.on('successful_payment', async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);

    if (payload.type === 'deposit') {
      const { userId, starsAmount } = payload;

      // 1. Получаем текущий баланс
      const { data: profile } = await supabase
        .from('profiles')
        .select('balance_stars')
        .eq('id', userId)
        .single();

      const newBalance = (profile?.balance_stars || 0) + Number(starsAmount);

      // 2. Обновляем баланс
      await supabase
        .from('profiles')
        .update({ balance_stars: newBalance })
        .eq('id', userId);

      // 3. Добавляем в историю
      await supabase.from('transactions').insert({
        user_id: userId,
        type_title: 'Пополнение через Telegram Stars',
        amount: Number(starsAmount)
      });

      await ctx.reply(`✅ Ваш баланс успешно пополнен на ${starsAmount} Stars!`);
    }
  } catch (err) {
    console.error('Webhook Payment Error:', err);
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body, res);
  } else {
    res.status(200).send('Webhook active');
  }
}
