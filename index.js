const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    browsers
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');

// 1. Gemini API Setup
const API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6LR963aSNzjkrBQ3tZ5Cw1eGPfB4y0XObpjpOiqH2FwDQ";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 2. WhatsApp Number
const PHONE_NUMBER = "919605046174";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        // macOS Chrome ആയി മാസ്‌ക് ചെയ്ത് ലോഗിൻ എറർ ഒഴിവാക്കുന്നു
        browser: browsers.macOS('Desktop')
    });

    // ലോഗിൻ ആയിട്ടില്ലെങ്കിൽ Pair Code ജനറേറ്റ് ചെയ്യും
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n====================================`);
                console.log(`🔑 NEW PAIRING CODE: ${code}`);
                console.log(`====================================\n`);
            } catch (error) {
                console.error("Pairing Error:", error);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    // Connection Events
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Reconnecting...');
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('🎉 Gemini Chatbot Successfully Connected!');
        }
    });

    // Message Handling
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
