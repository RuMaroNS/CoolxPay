import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- ЛОГИКА АВТОРИЗАЦИИ (Генерация OTP-кодов) ---
bot.command(['start', 'login'], async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // 1. Генерируем случайный 6-значный код (от 000000 до 999999)
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 2. Помечаем старые неиспользованные коды этого юзера как использованные (опционально)
    await supabase
      .from('telegram_auth_codes')
      .update({ is_used: true })
      .eq('telegram_id', telegramId)
      .eq('is_used', false);

    // 3. Записываем новый код в таблицу telegram_auth_codes
    const { error } = await supabase
      .from('telegram_auth_codes')
      .insert({
        telegram_id: telegramId,
        code: code,
        is_used: false
      });

    if (error) {
      console.error('Supabase Auth Code Error:', error);
      await ctx.reply('❌ Ошибка при генерации кода авторизации. Попробуйте позже.');
      return;
    }

    // 4. Отправляем код пользователю
    const messageText = 
      `🔐 *Авторизация на Coolx Pay*\n\n` +
      `Ваш одноразовый код подтверждения:\n` +
      `\`${code}\`\n\n` +
      `Введите этот код на сайте для входа. Код действителен до первой попытки входа.`;

    await ctx.reply(messageText, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('Auth Command Error:', err);
    await ctx.reply('❌ Произошла ошибка при обработке команды.');
  }
});


// --- ЛОГИКА ОПЛАТЫ ( Telegram Stars ) ---

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

// --- ЭКСПОРТ ДЛЯ VERCEL SERVERLESS FUNCTION ---
export default async function handler(req, res) {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body, res);
  } else {
    res.status(200).send('Webhook active');
  }
}
