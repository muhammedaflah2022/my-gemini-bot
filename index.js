const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const readline = require('readline');

// 1. Gemini API Setup
const API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6LR963aSNzjkrBQ3tZ5Cw1eGPfB4y0XObpjpOiqH2FwDQ";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// CLI Input Read ചെയ്യാൻ
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // QR ഒഴിവാക്കി
        auth: state
    });

    // 2. Phone Number വഴി Pair Code എടുക്കാൻ
    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('\n📱 Your WhatsApp Number with Country Code (e.g., 919876543210): ');
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m\n`);
    }

    sock.ev.on('creds.update', saveCreds);

    // Connection Events
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Connecting again...');
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('🎉 Gemini Chatbot Successfully Connected!');
        }
    });

    // Message Listener
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
