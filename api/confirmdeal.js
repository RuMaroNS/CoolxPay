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

    // 1. Достаем сделку
    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .single();

    if (!deal || deal.buyer_id !== buyerId || deal.status !== 'escrow') {
      return res.status(400).json({ error: 'Сделка недоступна для закрытия' });
    }

    // 2. Получаем профиль продавца
    const { data: seller } = await supabase
      .from('profiles')
      .select('balance_stars, completed_deals')
      .eq('id', deal.seller_id)
      .single();

    // 3. Выплачиваем Stars и обновляем счетчик сделок
    await supabase
      .from('profiles')
      .update({
        balance_stars: (seller?.balance_stars || 0) + deal.amount_stars,
        completed_deals: (seller?.completed_deals || 0) + 1
      })
      .eq('id', deal.seller_id);

    // 4. Обновляем статус сделки и лота
    await supabase.from('deals').update({ status: 'completed' }).eq('id', dealId);
    await supabase.from('items').update({ status: 'sold' }).eq('id', deal.item_id);

    // 5. Добавляем в историю продавца
    await supabase.from('transactions').insert({
      user_id: deal.seller_id,
      type_title: 'Продажа товара (Завершено)',
      amount: deal.amount_stars
    });

    return res.status(200).json({ success: true, message: 'Сделка успешно закрыта' });
  } catch (err) {
    console.error('Confirm Deal Error:', err);
    return res.status(500).json({ error: 'Ошибка сервера при закрытии сделки' });
  }
}
