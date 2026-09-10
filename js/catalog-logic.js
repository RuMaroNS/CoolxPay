// js/catalog-logic.js

async function loadCatalogItems(supabaseClient, category = null) {
  let query = supabaseClient
    .from('items')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (category && category !== 'all') {
    query = query.eq('category', category);
  }

  const { data: items, error } = await query;
  const container = document.getElementById('catalog-items-list');

  if (error || !items || items.length === 0) {
    container.innerHTML = `<div style="grid-column: span 2; text-align: center; color: var(--text-gray); padding: 30px 0;">Лоты не найдены</div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="item-card" onclick="location.href='item.html?id=${item.id}'">
      <div class="item-cat">${item.category}</div>
      <div class="item-title">${item.title}</div>
      <div class="item-price">★ ${item.price_stars}</div>
    </div>
  `).join('');
}
