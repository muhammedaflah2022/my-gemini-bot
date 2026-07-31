const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');

// 1. Gemini API Setup (നിങ്ങളുടെ API Key ഇവിടെ ചേർത്തിട്ടുണ്ട്)
const API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6LR963aSNzjkrBQ3tZ5Cw1eGPfB4y0XObpjpOiqH2FwDQ";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function startBot() {
    // WhatsApp സെഷൻ ഫയലുകൾ സേവ് ചെയ്യാൻ
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true, // Termux / Server Logs-ൽ QR തെളിയും
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection Status നോക്കാൻ
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Reconnecting...');
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Gemini Chatbot Successfully Connected!');
        }
    });

    // വരുന്ന വാട്ട്‌സ്ആപ്പ് മെസ്സേജുകൾ ഹാൻഡിൽ ചെയ്യാൻ
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text) {
            try {
                // WhatsApp-ൽ Typing... എന്ന് കാണിക്കാൻ
                await sock.sendPresenceUpdate('composing', from);

                // Gemini AI-യോട് ചോദ്യം ചോദിക്കുന്നു
                const result = await model.generateContent(text);
                const response = await result.response;
                const replyText = response.text();

                // ഉത്തരം തിരിച്ച് വാട്ട്‌സ്ആപ്പിൽ അയക്കുന്നു
                await sock.sendMessage(from, { text: replyText }, { quoted: msg });
            } catch (error) {
                console.error("Gemini AI Error:", error);
                await sock.sendMessage(from, { text: "ക്ഷമിക്കണം, എനിക്ക് ഉത്തരം നൽകാൻ കഴിഞ്ഞില്ല. വീണ്ടും ശ്രമിക്കുക." }, { quoted: msg });
            }
        }
    });
}

startBot();
