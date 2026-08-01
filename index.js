const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    browsers
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// 1. Gemini API Setup
const API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6LR963aSNzjkrBQ3tZ5Cw1eGPfB4y0XObpjpOiqH2FwDQ";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 2. Session ID Restore
async function setupSession() {
    const sessionData = process.env.SESSION_ID;
    if (!sessionData) {
        console.error("❌ SESSION_ID നൽകിയിട്ടില്ല! Koyeb-ലെ Environment Variables-ൽ SESSION_ID ചേർക്കുക.");
        return false;
    }

    const authDir = path.join(__dirname, 'auth_info');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir);
    }

    try {
        // Base64 അല്ലെങ്കിൽ JSON ഫോർമാറ്റിലുള്ള Session Decode ചെയ്യുന്നു
        let cleanedSession = sessionData.replace(/^(ArslanMD~|SESSION~)/, ''); // Prefix ഉണ്ടെങ്കിൽ മാറ്റാൻ
        let decoded = Buffer.from(cleanedSession, 'base64').toString('utf-8');
        fs.writeFileSync(path.join(authDir, 'creds.json'), decoded);
        return true;
    } catch (e) {
        try {
            fs.writeFileSync(path.join(authDir, 'creds.json'), sessionData);
            return true;
        } catch (err) {
            console.error("❌ Session decode ചെയ്യാൻ സാധിച്ചില്ല:", err);
            return false;
        }
    }
}

async function startBot() {
    await setupSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection Events
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Reconnecting...');
            if (shouldReconnect) startBot();
            else console.log('❌ Connection Closed. Re-check Session ID.');
        } else if (connection === 'open') {
            console.log('🎉 Gemini Chatbot Successfully Connected!');
        }
    });

    // Chatbot Message Handling
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text) {
            try {
                await sock.sendPresenceUpdate('composing', from);

                const result = await model.generateContent(text);
                const response = await result.response;
                const replyText = response.text();

                await sock.sendMessage(from, { text: replyText }, { quoted: msg });
            } catch (error) {
                console.error("Gemini Error:", error);
            }
        }
    });
}

startBot();
