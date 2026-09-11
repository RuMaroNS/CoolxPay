export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`

/**
 * Управление чатом в реальном времени для Coolx Pay
 */

let supabaseClient = null;
let currentUserId = null;
let activeChatUser = null;
let messageSubscription = null;

/**
 * 1. Инициализация клиента Supabase и привязка пользователя
 */
async function initChatModule() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    
    supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });

    currentUserId = localStorage.getItem('coolx_user_id');
    if (!currentUserId) {
      window.location.href = 'auth.html';
      return;
    }

    // Загружаем список доступных диалогов слева
    await loadConversationsList();

    // Проверяем, не перенаправлен ли пользователь из карточки товара (?user=UUID)
    const urlParams = new URLSearchParams(window.location.search);
    const targetUser = urlParams.get('user');
    if (targetUser) {
      const { data: targetData } = await supabaseClient
        .from('profiles')
        .select('username')
        .eq('id', targetUser)
        .single();
      
      openChat(targetUser, targetData?.username || 'Пользователь');
    }

  } catch (err) {
    console.error("Ошибка инициализации модуля чатов:", err);
  }
}

/**
 * 2. Загрузка списка пользователей (диалогов) в левую колонку
 */
async function loadConversationsList() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, username')
    .neq('id', currentUserId)
    .limit(20);

  const listContainer = document.getElementById('chats-list');
  if (!listContainer) return;

  if (error || !data || data.length === 0) {
    listContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-gray); font-size: 0.8rem;">Нет доступных чатов</div>`;
    return;
  }

  listContainer.innerHTML = `<div class="sidebar-header">Диалоги</div>` + data.map(user => `
    <div class="chat-item" id="chat-item-${user.id}" onclick="openChat('${user.id}', '${user.username || 'Пользователь'}')">
      <div class="chat-avatar">${(user.username || 'U')[0].toUpperCase()}</div>
      <div class="chat-meta">
        <div class="chat-name">${user.username || 'Пользователь'}</div>
        <div class="chat-lastmsg">Нажмите для общения</div>
      </div>
    </div>
  `).join('');
}

/**
 * 3. Открытие конкретного диалога
 */
async function openChat(userId, username) {
  activeChatUser = userId;
  
  const titleEl = document.getElementById('active-chat-title');
  if (titleEl) titleEl.innerText = username;

  // Визуальная подсветка выбранного чата в левой колонке
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.getElementById(`chat-item-${userId}`);
  if (activeEl) activeEl.classList.add('active');

  // Если уже была подписка на сокеты другого чата — отписываемся
  if (messageSubscription) {
    supabaseClient.removeChannel(messageSubscription);
  }

  // Загружаем старые сообщения из базы и запускаем Realtime-слушатель
  await loadMessagesHistory();
  subscribeToRealtimeMessages();
}

/**
 * 4. Загрузка истории переписки из БД
 */
async function loadMessagesHistory() {
  if (!activeChatUser) return;
  const box = document.getElementById('messages-box');
  if (!box) return;

  box.innerHTML = `<div style="text-align: center; color: var(--text-gray); font-size: 0.8rem; margin-top: 20px;">Загрузка сообщений...</div>`;
  
  const { data, error } = await supabaseClient
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${activeChatUser}),and(sender_id.eq.${activeChatUser},receiver_id.eq.${currentUserId})`)
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) {
    box.innerHTML = `<div style="text-align: center; color: var(--text-gray); font-size: 0.85rem; margin-top: 20px;">История пуста. Напишите первое сообщение!</div>`;
    return;
  }

  box.innerHTML = data.map(m => createMessageBubbleHTML(m)).join('');
  scrollToBottom(box);
}

/**
 * 5. Настройка веб-сокетов (Supabase Realtime) для мгновенного получения сообщений
 */
function subscribeToRealtimeMessages() {
  messageSubscription = supabaseClient
    .channel(`chat_rt_${currentUserId}_${activeChatUser}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, (payload) => {
      const newMsg = payload.new;
      
      // Проверяем, относится ли прилетевшее по сокету сообщение к текущему открытому окну
      const isRelevant = 
        (newMsg.sender_id === currentUserId && newMsg.receiver_id === activeChatUser) ||
        (newMsg.sender_id === activeChatUser && newMsg.receiver_id === currentUserId);

      if (isRelevant) {
        appendMessageToDOM(newMsg);
      }
    })
    .subscribe();
}

/**
 * 6. Отправка нового сообщения в базу данных
 */
async function sendMessage() {
  const input = document.getElementById('message-input');
  if (!input) return;

  const text = input.value.trim();
  if (!text || !activeChatUser) return;

  // Очищаем инпут сразу для лучшего UX
  input.value = '';

  const { error } = await supabaseClient.from('messages').insert({
    sender_id: currentUserId,
    receiver_id: activeChatUser,
    text: text
  });

  if (error) {
    console.error("Ошибка при отправке:", error);
    alert('Не удалось отправить сообщение');
  }
  // Сообщение автоматически отрисуется у обоих клиентов через Realtime-подписку
}

/**
 * Вспомогательные функции рендеринга
 */
function createMessageBubbleHTML(m) {
  const isOutgoing = m.sender_id === currentUserId;
  return `
    <div class="message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}">
      ${escapeHtml(m.text)}
    </div>
  `;
}

function appendMessageToDOM(m) {
  const box = document.getElementById('messages-box');
  if (!box) return;

  // Удаляем плашку "история пуста", если она там была
  const emptyNotice = box.querySelector('div[style*="text-align: center"]');
  if (emptyNotice) emptyNotice.remove();

  box.innerHTML += createMessageBubbleHTML(m);
  scrollToBottom(box);
}

function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Запуск при загрузке DOM
document.addEventListener('DOMContentLoaded', initChatModule);

    `);
}
