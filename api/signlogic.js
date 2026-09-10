export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`

// signlogic.js — полная логика авторизации Coolx Pay через Telegram OTP (с использованием Cookies)

let supabaseClient = null;
let verifiedTelegramData = null;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Подтягиваем конфиг Supabase
        const res = await fetch('/api/config');
        const config = await res.json();
        supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

        // Вешаем обработчики на кнопки
        const verifyBtn = document.getElementById('verify-btn');
        if (verifyBtn) {
            verifyBtn.addEventListener('click', handleVerifyOtp);
        }

        const registerBtn = document.getElementById('register-btn');
        if (registerBtn) {
            registerBtn.addEventListener('click', handleCompleteRegistration);
        }

    } catch (err) {
        console.error("Ошибка инициализации авторизации:", err);
        showError("Не удалось инициализировать систему авторизации");
    }
});

// Шаг 1: Проверка введенного 6-значного OTP-кода
async function handleVerifyOtp() {
    const otpInput = document.getElementById('otp-input');
    const errorBox = document.getElementById('auth-error');
    if (errorBox) errorBox.innerText = '';

    const code = otpInput ? otpInput.value.trim() : '';

    if (!code || code.length !== 6) {
        showError('Введите корректный 6-значный код из бота');
        return;
    }

    try {
        // Ищем код в таблице telegram_auth_codes в Supabase
        const { data, error } = await supabaseClient
            .from('telegram_auth_codes')
            .select('*')
            .eq('code', code)
            .eq('is_used', false)
            .single();

        if (error || !data) {
            showError('Неверный или уже использованный код');
            return;
        }

        verifiedTelegramData = data; // Сохраняем данные сессии (telegram_id)

        // Помечаем код как использованный для защиты от повторного ввода
        await supabaseClient
            .from('telegram_auth_codes')
            .update({ is_used: true })
            .eq('id', data.id);

        // Проверяем, зарегистрирован ли уже этот Telegram ID в таблице profiles
        const { data: existingProfile } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('telegram_id', data.telegram_id)
            .single();

        if (existingProfile) {
            // Если профиль есть — сохраняем ID в куку (на 30 дней) и редиректим в профиль
            setCookie('coolx_user_id', existingProfile.id, 30);
            location.href = 'profile.html';
        } else {
            // Если профиль новый — скрываем блок ввода кода и показываем форму ввода юзернейма
            document.getElementById('step-code').style.display = 'none';
            document.getElementById('step-register').style.display = 'block';
        }

    } catch (err) {
        console.error("Ошибка при проверке кода:", err);
        showError('Произошла ошибка соединения с базой данных');
    }
}

// Шаг 2: Завершение регистрации (создание юзернейма для нового юзера)
async function handleCompleteRegistration() {
    const usernameInput = document.getElementById('username-input');
    const errorBox = document.getElementById('auth-error');
    if (errorBox) errorBox.innerText = '';

    const username = usernameInput ? usernameInput.value.trim() : '';

    if (!username || username.length < 3) {
        showError('Никнейм должен содержать минимум 3 символа');
        return;
    }

    if (!verifiedTelegramData) {
        showError('Ошибка сессии. Повторите вход с получения кода.');
        return;
    }

    try {
        const newUserId = crypto.randomUUID(); // Генерируем уникальный ID нового юзера

        // Создаем профиль в таблице profiles
        const { error } = await supabaseClient
            .from('profiles')
            .insert({
                id: newUserId,
                telegram_id: verifiedTelegramData.telegram_id,
                username: username,
                balance_stars: 0,
                rating: 5.0,
                completed_deals: 0,
                is_online: true
            });

        if (error) {
            console.error("Ошибка вставки профиля:", error);
            showError('Этот никнейм уже занят или произошла ошибка');
            return;
        }

        // Сохраняем сессию в куки
        setCookie('coolx_user_id', newUserId, 30);
        
        // Перенаправляем на страницу профиля
        location.href = 'profile.html';

    } catch (err) {
        console.error("Ошибка регистрации:", err);
        showError('Не удалось завершить регистрацию');
    }
}

// --- Вспомогательные функции для работы с Cookies ---

function setCookie(name, value, days = 30) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
}

function showError(text) {
    const errorBox = document.getElementById('auth-error');
    if (errorBox) {
        errorBox.innerText = text;
    } else {
        alert(text);
    }
}

`);
}
