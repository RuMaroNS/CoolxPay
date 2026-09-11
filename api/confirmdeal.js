import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { buyerId, dealId } = req.body;

    if (!buyerId || !dealId) {
      return res.status(400).json({ error: 'Некорректные данные' });
    }

    // 1. Проверяем сделку
    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .single();

    if (!deal || deal.buyer_id !== buyerId || deal.status !== 'escrow') {
      return res.status(400).json({ error: 'Сделка недоступна для подтверждения' });
    }

    const sellerEarned = Math.floor(deal.amount_stars * 0.86);

    // 2. Достаем продавца
    const { data: seller } = await supabase
      .from('profiles')
      .select('frozen_by_order, frozen_by_time, completed_deals')
      .eq('id', deal.seller_id)
      .single();

    // Дата разморозки: ТЕКУЩАЯ ДАТА + 20 ДНЕЙ
    const unfreezeDate = new Date();
    unfreezeDate.setDate(unfreezeDate.getDate() + 20);

    const updatedFrozenOrder = Math.max(0, (seller?.frozen_by_order || 0) - sellerEarned);
    const updatedFrozenTime = (seller?.frozen_by_time || 0) + sellerEarned;

    // 3. Переводим деньги из "Заморожено по заказу" в "Заморожено от вывода на 20 дней"
    await supabase
      .from('profiles')
      .update({
        frozen_by_order: updatedFrozenOrder,
        frozen_by_time: updatedFrozenTime,
        unfreezes_at: unfreezeDate.toISOString(),
        completed_deals: (seller?.completed_deals || 0) + 1
      })
      .eq('id', deal.seller_id);

    // 4. Закрываем статусы
    await supabase.from('deals').update({ status: 'completed' }).eq('id', dealId);
    await supabase.from('items').update({ status: 'sold' }).eq('id', deal.item_id);

    // 5. Записываем транзакции
    await supabase.from('transactions').insert([
      {
        user_id: deal.buyer_id,
        order_id: dealId,
        type_title: 'Покупка: Успешно завершено',
        amount: -deal.amount_stars
      },
      {
        user_id: deal.seller_id,
        order_id: dealId,
        type_title: 'Продажа: Успешно (Заморожено от вывода на 20 дней)',
        amount: sellerEarned
      }
    ]);

    return res.status(200).json({ success: true, message: 'Сделка завершена, запуск 20-дневной заморозки!' });

  } catch (err) {
    console.error('Confirm Deal Error:', err);
    return res.status(500).json({ error: 'Ошибка при закрытии сделки' });
  }
}
