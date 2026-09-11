export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`

/**
 * Модуль управления страницей лота (item.js)
 */

let supabaseClient = null;
let currentUserId = null;
let currentItem = null;

/**
 * 1. Инициализация Supabase и загрузка данных
 */
async function initItemModule() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();

    supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });

    currentUserId = localStorage.getItem('coolx_user_id');

    await loadItemDetails();
  } catch (err) {
    console.error("Ошибка инициализации страницы лота:", err);
    showErrorMessage("Не удалось загрузить данные лота.");
  }
}

/**
 * 2. Получение данных лота по ID из URL
 */
async function loadItemDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const itemId = urlParams.get('id');
  const container = document.getElementById('item-container');

  if (!itemId) {
    showErrorMessage("Лот не найден (не указан ID в URL)");
    return;
  }

  // Получаем лот вместе с данными продавца из таблицы profiles
  const { data: item, error } = await supabaseClient
    .from('items')
    .select('*, profiles(id, username)')
    .eq('id', itemId)
    .single();

  if (error || !item) {
    console.error("Ошибка загрузки лота:", error);
    showErrorMessage("Лот не найден или был удален продавцом");
    return;
  }

  currentItem = item;
  renderItemCard(item);
}

/**
 * 3. Рендеринг карточки лота
 */
function renderItemCard(item) {
  const container = document.getElementById('item-container');
  if (!container) return;

  const sellerName = item.profiles?.username || 'Продавец';
  const sellerAvatarChar = sellerName[0].toUpperCase();

  container.innerHTML = `
    <div class="item-card">
      <div class="item-category">${escapeHtml(item.category || 'Лот')}</div>
      <h1 class="item-title">${escapeHtml(item.title)}</h1>
      <div class="item-price-box">★ ${item.price_stars}</div>
      
      <div class="item-desc-title">Описание лота</div>
      <div class="item-desc">${escapeHtml(item.description || 'Описание отсутствует.')}</div>

      <div class="seller-box">
        <div class="seller-info">
          <div class="seller-avatar">${sellerAvatarChar}</div>
          <div>
            <div class="seller-name">${escapeHtml(sellerName)}</div>
            <div class="seller-status">Продавец на Coolx Pay</div>
          </div>
        </div>
        <button class="profile-btn" onclick="openProfile('${item.seller_id}')">Профиль</button>
      </div>

      <button class="buy-btn" onclick="startDeal()">КУПИТЬ (БЕЗОПАСНАЯ СДЕЛКА)</button>
    </div>
  `;
}

/**
 * 4. Запуск процедуры безопасной покупки / сделки
 */
async function startDeal() {
  if (!currentUserId) {
    alert('Для покупки необходимо авторизоваться!');
    window.location.href = 'auth.html';
    return;
  }

  if (currentUserId === currentItem.seller_id) {
    alert('Вы не можете купить собственный лот!');
    return;
  }

  const confirmed = confirm(`Вы уверены, что хотите купить "${currentItem.title}" за ★ ${currentItem.price_stars}?`);
  if (!confirmed) return;

  try {
    // Создаем запись сделки со статусом 'created'
    const { data: deal, error } = await supabaseClient
      .from('deals')
      .insert({
        item_id: currentItem.id,
        buyer_id: currentUserId,
        seller_id: currentItem.seller_id,
        amount: currentItem.price_stars,
        status: 'created'
      })
      .select()
      .single();

    if (error) throw error;

    // Автоматически отправляем системное сообщение в чат
    await supabaseClient.from('messages').insert({
      sender_id: currentUserId,
      receiver_id: currentItem.seller_id,
      text: `🛒 Здравствуйте! Я начал сделку по покупке лота "${currentItem.title}" (★ ${currentItem.price_stars}).`
    });

    // Перенаправляем покупателя в чат с продавцом
    window.location.href = `chat.html?user=${currentItem.seller_id}&deal=${deal.id}`;

  } catch (err) {
    console.error("Ошибка при создании сделки:", err);
    alert('Не удалось оформить сделку. Попробуйте позже.');
  }
}

/**
 * Переход в профиль продавца
 */
function openProfile(sellerId) {
  window.location.href = `profile.html?id=${sellerId}`;
}

/**
 * Вспомогательные функции
 */
function showErrorMessage(msg) {
  const container = document.getElementById('item-container');
  if (container) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-gray); padding: 40px 0; font-size: 0.9rem;">${msg}</div>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Запуск модуля после загрузки страницы
document.addEventListener('DOMContentLoaded', initItemModule);


  `);
}
