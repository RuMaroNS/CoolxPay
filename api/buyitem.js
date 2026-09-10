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
    const { buyerId, itemId } = req.body;

    // 1. Получаем лот
    const { data: item } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (!item || item.status !== 'active') {
      return res.status(400).json({ error: 'Лот недоступен или продан' });
    }

    if (item.seller_id === buyerId) {
      return res.status(400).json({ error: 'Нельзя купить свой же лот' });
    }

    // 2. Проверяем баланс покупателя
    const { data: buyer } = await supabase
      .from('profiles')
      .select('balance_stars')
      .eq('id', buyerId)
      .single();

    if (!buyer || buyer.balance_stars < item.price_stars) {
      return res.status(400).json({ error: 'Недостаточно Stars на балансе' });
    }

    // 3. Списываем средства
    await supabase
      .from('profiles')
      .update({ balance_stars: buyer.balance_stars - item.price_stars })
      .eq('id', buyerId);

    // 4. Меняем статус лота
    await supabase
      .from('items')
      .update({ status: 'in_deal' })
      .eq('id', itemId);

    // 5. Создаем сделку
    const { data: deal } = await supabase
      .from('deals')
      .insert({
        item_id: itemId,
        buyer_id: buyerId,
        seller_id: item.seller_id,
        amount_stars: item.price_stars,
        status: 'escrow'
      })
      .select()
      .single();

    // 6. Добавляем в историю покупателя
    await supabase.from('transactions').insert({
      user_id: buyerId,
      type_title: `Покупка "${item.title}" (Удержание)`,
      amount: -item.price_stars
    });

    return res.status(200).json({ success: true, dealId: deal.id });
  } catch (err) {
    console.error('Buy Item Error:', err);
    return res.status(500).json({ error: 'Ошибка сервера при оформлении покупки' });
  }
}
