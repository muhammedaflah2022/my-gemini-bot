const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    browsers
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 8000;

// 1. Gemini API Setup
const API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6LR963aSNzjkrBQ3tZ5Cw1eGPfB4y0XObpjpOiqH2FwDQ";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let sock;

// 2. Web Interface for Pair Code
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Get WhatsApp Pair Code</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { background: #000; color: #fff; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #111; padding: 30px; border-radius: 12px; text-align: center; width: 90%; max-width: 400px; border: 1px solid #222; }
                input { width: 100%; padding: 12px; margin: 15px 0; border-radius: 6px; border: 1px solid #333; background: #222; color: #fff; box-sizing: border-box; font-size: 16px; }
                button { width: 100%; padding: 12px; background: #25D366; border: none; color: #000; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 16px; }
                .code { font-size: 24px; color: #25D366; letter-spacing: 3px; font-weight: bold; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Get Pairing Code</h2>
                <form action="/pair" method="POST">
                    <input type="text" name="number" placeholder="e.g. 919605046174 (With Country Code)" required>
                    <button type="submit">GET CODE</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/pair', async (req, res) => {
    let num = req.body.number.replace(/[^0-9]/g, '');
    if (!num) return res.send("Invalid Number!");

    try {
        if (!sock || !sock.authState) await startBot();
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Your Code</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { background: #000; color: #fff; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                            .card { background: #111; padding: 30px; border-radius: 12px; text-align: center; width: 90%; max-width: 400px; border: 1px solid #222; }
                            .code { font-size: 28px; color: #25D366; letter-spacing: 4px; font-weight: bold; margin: 20px 0; background: #222; padding: 15px; border-radius: 8px; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h3>YOUR PAIRING CODE:</h3>
                            <div class="code">${code}</div>
                            <p style="color:#888; font-size:12px;">Enter this code in WhatsApp -> Linked Devices</p>
                        </div>
                    </body>
                    </html>
                `);
            } catch (err) {
                res.send("Error generating code: " + err.message);
            }
        }, 3000);
    } catch (e) {
        res.send("Server Error!");
    }
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('🎉 Gemini Chatbot Successfully Connected!');
        }
    });

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
                await sock.sendMessage(from, { text: response.text() }, { quoted: msg });
            } catch (error) {
                console.error("Gemini Error:", error);
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBot();
});
