export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`
// js/profilelogic.js

async function renderProfile(supabaseClient, targetUserId, currentUserId) {
  const isOwner = (!targetUserId || targetUserId === currentUserId);
  const activeId = isOwner ? currentUserId : targetUserId;

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', activeId)
    .single();

  if (error || !profile) {
    document.getElementById('profile-card').innerHTML = \`<div class="empty-state">Пользователь #\${activeId} не найден</div>\`;
    return;
  }

  // Статус
  let statusClass = 'status-offline';
  let statusText = 'Не в сети';
  if (profile.is_banned) {
    statusClass = 'status-banned';
    statusText = 'Заблокирован';
  } else if (profile.is_online) {
    statusClass = 'status-online';
    statusText = 'В сети';
  } else if (profile.last_seen) {
    statusText = \`Был(а) недавно (\${new Date(profile.last_seen).toLocaleDateString()})\`;
  }

  // Карточка
  document.getElementById('profile-card').innerHTML = \`
    <div class="avatar-container">
      <div class="avatar-wrapper">
        <img class="avatar-img" src="\${profile.avatar_url || '[https://via.placeholder.com/150](https://via.placeholder.com/150)'}" alt="Avatar">
      </div>
      <div class="status-badge \${statusClass}"></div>
    </div>
    <div class="user-name">\${profile.username || 'Пользователь'}</div>
    <div class="user-status-text">\${statusText}</div>

    <div class="stats-row">
      <div class="stat-item">
        <span class="stat-val">\${profile.rating || '5.0'} ★</span>
        <span class="stat-label">Рейтинг</span>
      </div>
      <div class="stat-item">
        <span class="stat-val">\${profile.completed_deals || 0}</span>
        <span class="stat-label">Сделок</span>
      </div>
    </div>
  \`;

  // Показываем баланс только владельцу
  const balanceBox = document.getElementById('my-balance-box');
  if (balanceBox) {
    if (isOwner) {
      balanceBox.style.display = 'flex';
      document.getElementById('user-balance').innerText = \`★ \${profile.balance_stars || 0}\`;
    } else {
      balanceBox.style.display = 'none';
    }
  }

  return { isOwner, activeId };
}
  `);
}
