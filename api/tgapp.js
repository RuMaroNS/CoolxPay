export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`

// js/tgapp.js

function getTgUser() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return null;
  
  tg.ready();
  tg.expand();

  const user = tg.initDataUnsafe?.user;
  if (!user) return null;

  return {
    id: String(user.id),
    username: user.username ? `@${user.username}` : (user.first_name || `User_${user.id}`),
    avatar_url: user.photo_url || ''
  };
}

/**
 * Авторизация/Регистрация пользователя в Supabase при входе
 */
async function syncTgUserWithSupabase(supabaseClient) {
  const tgUser = getTgUser();
  if (!tgUser) return null;

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', tgUser.id)
    .single();

  if (!profile) {
    await supabaseClient.from('profiles').insert({
      id: tgUser.id,
      username: tgUser.username,
      avatar_url: tgUser.avatar_url,
      balance_stars: 0,
      is_online: true
    });
  } else {
    await supabaseClient.from('profiles').update({
      is_online: true,
      last_seen: new Date().toISOString()
    }).eq('id', tgUser.id);
  }

  return tgUser.id;
}

`);
}
