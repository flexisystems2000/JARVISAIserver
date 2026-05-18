const axios = require('axios');
const admin = require('firebase-admin');

// 🔐 BULLETPROOF FIREBASE INITIALIZATION CHECK
let db;
try {
    if (admin.apps.length === 0) {
        admin.initializeApp({
            projectId: "jarvisai-1a594"
        });
        db = admin.firestore();
    } else {
        // If an app instance already exists, safely grab its default firestore connection
        db = admin.firestore();
    }
} catch (initErr) {
    console.log("⚠️ Firebase initialization notice:", initErr.message);
    db = admin.firestore(); // Fallback to whatever instance is currently alive
}

// 🔥 Decoupled Render Payment Server URL Constants
const PAYMENT_SERVER_URL = "https://jarvis-payments-server.onrender.com"; 

/**
 * Handles the !pay command completely inside private DM
 * @param {object} sock - Baileys socket instance
 * @param {object} m - The raw message object
 * @param {string} sender - Student's unique JID (phone number format)
 * @param {string[]} args - Command arguments array
 */
async function handlePaymentRequest(sock, m, sender, args) {
    try {
        const userTag = sender.split('@')[0];
        const paidClassGroupLink = "https://chat.whatsapp.com/JC7W3YORbIr4GtoktECpaU";
        const privateChatJid = sender; 

        // 1. 🔍 SAFE ON-DEMAND CHECK: Query Firestore manually with an inline error guard
        let snapshot;
        try {
            snapshot = await db.collection("payment_requests")
                .where("phone", "==", userTag)
                .where("status", "==", "completed")
                .limit(1)
                .get();
        } catch (dbErr) {
            console.log("⚠️ Firestore query connection fault:", dbErr.message);
            // If anything blocks the query, pass right through to Paystack link generation safely
            snapshot = { empty: true };
        }

        // 2. 🚀 Already Paid? Serve the link instantly and exit!
        if (snapshot && !snapshot.empty) {
            const activeTemplate = 
                `✨ *FLEXI TUTORS PREMIUM PORTAL* 🎓\n\n` +
                `Hello @${userTag}, our system shows you are already a **Verified Active Member**!\n\n` +
                `You don't need a new invoice. Re-enter your paid class workspace via the link below:\n\n` +
                `👉 ${paidClassGroupLink}`;

            return await sock.sendMessage(privateChatJid, { text: activeTemplate, mentions: [sender] });
        }
        
        // 🛡️ CRITICAL BUG FIX: Safely read args without crashing if it's undefined
        let planArg = "";
        if (Array.isArray(args) && args.length > 0) {
            planArg = args[0]?.toLowerCase();
        } else {
            const body = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
            planArg = body.trim().split(/\s+/)[1]?.toLowerCase() || "";
        }

        // Process plan selection logic safely
        const isWeekly = (planArg === "week" || planArg === "weekly" || planArg === "1500");
        const planType = isWeekly ? "week" : "month";
        const displayAmount = isWeekly ? "1,500" : "6,000";
        const displayDuration = isWeekly ? "1 Week Access" : "Full Month Access";

        // Send a direct placeholder update privately first
        await sock.sendMessage(privateChatJid, { 
            text: `⏳ _Compiling your secure ${planType.toUpperCase()} invoice for Flexi Tutorials..._` 
        });

        // 3. Call your decoupled backend payment cluster
        const response = await axios.post(`${PAYMENT_SERVER_URL}/payments/initialize`, {
            name: `WhatsApp Student (@${userTag})`,
            phone: userTag,
            planType: planType
        });

        if (response.data?.success) {
            const paymentUrl = response.data.paymentUrl;

            // Official Flexi Tutors invoice layout
            const tutorialReceiptTemplate = 
                `💳 *FLEXI TUTORS ACADEMY BILLING* 🎓\n\n` +
                `Hello @${userTag}, your requested invoice has been compiled:\n\n` +
                `📝 *Subscription Type:* ${displayDuration}\n` +
                `💰 *Fee Rate:* ₦${displayAmount}\n` +
                `🗓️ *Access Features:* Group Access & Weekly Mock Portal\n\n` +
                `👉 *Click this link to pay securely with Transfer, Card, or USSD:* \n` +
                `${paymentUrl}\n\n` +
                `💡 _Want to switch plans? Reply right here with \`!pay month\` for Monthly (₦6,000) or \`!pay week\` for Weekly (₦1,500)._`;

            // Deliver invoice template to private DM
            await sock.sendMessage(privateChatJid, { text: tutorialReceiptTemplate });

        } else {
            await sock.sendMessage(privateChatJid, { 
                text: "⚠️ *System Error:* The payment gateway could not register your billing key signature." 
            });
        }

    } catch (err) {
        console.log("❌ JARVIS Private Pay Error:", err.message);
        try {
            await sock.sendMessage(sender, { 
                text: "❌ *Connection Fault:* JARVIS could not fetch an active Paystack token right now. Please try again in a few minutes." 
            });
        } catch (msgErr) {
            console.log("Could not drop error message to user:", msgErr.message);
        }
    }
}

module.exports = { handlePaymentRequest };
