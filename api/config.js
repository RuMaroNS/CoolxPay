export default function handler(req, res) {
    // Разрешаем браузерам читать скрипт
    res.setHeader('Content-Type', 'application/javascript');
    
    // Записываем ключи прямо в window до того, как сработает код страниц
    const jsCode = `
        window.SUPABASE_URL = "${process.env.SUPABASE_URL || ''}";
        window.SUPABASE_ANON_KEY = "${process.env.SUPABASE_ANON_KEY || ''}";
    `;
    
    return res.status(200).send(jsCode);
}
