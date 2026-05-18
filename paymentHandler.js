const axios = require('axios');
const admin = require('firebase-admin');

// ===============================
// PHONE NORMALIZER
// ===============================
function normalizePhone(input) {
    return input
        .replace(/\D/g, '')
        .replace(/^0/, '234');
}

// ===============================
// FIREBASE INITIALIZATION
// ===============================
let db;

if (admin.apps.length === 0) {

    try {

        // Uses your Render environment variable
        const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT
        );

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        console.log("✅ Firebase Admin Initialized Successfully");

    } catch (initErr) {

        console.log(
            "❌ Firebase Initialization Error:",
            initErr.message
        );
    }
}

db = admin.firestore();

// ===============================
// PAYMENT SERVER URL
// ===============================
const PAYMENT_SERVER_URL =
    "https://jarvis-payments-server.onrender.com";

// ===============================
// HANDLE !PAY COMMAND
// ===============================
async function handlePaymentRequest(
    sock,
    m,
    sender,
    args
) {

    try {

        // ===============================
        // NORMALIZED USER PHONE
        // ===============================
        const userTag = normalizePhone(sender);

        const paidClassGroupLink =
            "https://chat.whatsapp.com/JC7W3YORbIr4GtoktECpaU";

        const privateChatJid = sender;

        console.log(
            "🔍 Processing payment request for:",
            userTag
        );

        // ===============================
        // CHECK IF USER ALREADY PAID
        // ===============================
        let snapshot;

        try {

            snapshot = await db
                .collection("payment_requests")
                .where("phone", "==", userTag)
                .where("status", "==", "completed")
                .limit(1)
                .get();

        } catch (dbErr) {

            console.log(
                "⚠️ Firestore payment query failed:",
                dbErr.message
            );

            snapshot = { empty: true };
        }

        // ===============================
        // USER ALREADY HAS ACCESS
        // ===============================
        if (snapshot && !snapshot.empty) {

            const activeTemplate =
`✨ *FLEXI TUTORS PREMIUM PORTAL* 🎓

Hello @${userTag}, our system shows that you are already a VERIFIED ACTIVE MEMBER.

You do not need another invoice.

👉 Rejoin your premium class workspace below:

${paidClassGroupLink}`;

            return await sock.sendMessage(
                privateChatJid,
                {
                    text: activeTemplate,
                    mentions: [sender]
                }
            );
        }

        // ===============================
        // FETCH USER PROFILE
        // ===============================
        let studentRealName = "";

        try {

            const userProfileDoc = await db
                .collection("users")
                .doc(userTag)
                .get();

            console.log(
                "🔍 Looking for profile:",
                userTag
            );

            if (
                userProfileDoc.exists &&
                userProfileDoc.data().name
            ) {

                studentRealName =
                    userProfileDoc.data().name;

                console.log(
                    "✅ Profile found:",
                    studentRealName
                );
            }

        } catch (profileErr) {

            console.log(
                "⚠️ Student profile query failed:",
                profileErr.message
            );
        }

        // ===============================
        // BLOCK IF NO NAME REGISTERED
        // ===============================
        if (!studentRealName) {

            const registerPrompt =
`⚠️ *PROFILE REGISTRATION REQUIRED* 🎓

Please register your profile before generating a payment invoice.

👉 Reply with:

!name Your Full Name

Example:
!name Tunde Olaniyan`;

            return await sock.sendMessage(
                privateChatJid,
                {
                    text: registerPrompt
                }
            );
        }

        // ===============================
        // PLAN DETECTION
        // ===============================
        let planArg = "";

        if (
            Array.isArray(args) &&
            args.length > 0
        ) {

            planArg =
                args[0]?.toLowerCase();

        } else {

            const body =
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "";

            planArg =
                body
                    .trim()
                    .split(/\s+/)[1]
                    ?.toLowerCase() || "";
        }

        // ===============================
        // PLAN LOGIC
        // ===============================
        const isWeekly =
            (
                planArg === "week" ||
                planArg === "weekly" ||
                planArg === "1500"
            );

        const planType =
            isWeekly ? "week" : "month";

        const displayAmount =
            isWeekly ? "1,500" : "6,000";

        const displayDuration =
            isWeekly
                ? "1 Week Access"
                : "Full Month Access";

        // ===============================
        // PROCESSING MESSAGE
        // ===============================
        await sock.sendMessage(
            privateChatJid,
            {
                text:
`⏳ Compiling your secure ${planType.toUpperCase()} invoice for Flexi Tutors...`
            }
        );

        // ===============================
        // CALL PAYMENT SERVER
        // ===============================
        const response = await axios.post(
            `${PAYMENT_SERVER_URL}/payments/initialize`,
            {
                name: studentRealName,
                phone: userTag,
                planType: planType
            }
        );

        // ===============================
        // SUCCESSFUL PAYMENT LINK
        // ===============================
        if (response.data?.success) {

            const paymentUrl =
                response.data.paymentUrl;

            const tutorialReceiptTemplate =
`💳 *FLEXI TUTORS ACADEMY BILLING* 🎓

Hello *${studentRealName}*,

Your invoice has been generated successfully.

📝 Subscription:
${displayDuration}

💰 Amount:
₦${displayAmount}

🗓️ Access Includes:
• Premium Group Access
• Weekly Mock Portal
• Learning Materials

👉 Pay securely below:
${paymentUrl}

💡 Want another plan?

Reply with:

!pay week
or
!pay month`;

            await sock.sendMessage(
                privateChatJid,
                {
                    text:
                        tutorialReceiptTemplate
                }
            );

        } else {

            await sock.sendMessage(
                privateChatJid,
                {
                    text:
`⚠️ PAYMENT INITIALIZATION FAILED

The payment gateway could not generate your invoice right now.

Please try again later.`
                }
            );
        }

    } catch (err) {

        console.log(
            "❌ JARVIS PAYMENT ERROR:",
            err.message
        );

        try {

            await sock.sendMessage(
                sender,
                {
                    text:
`❌ CONNECTION ERROR

JARVIS could not establish a secure payment session right now.

Please try again in a few minutes.`
                }
            );

        } catch (msgErr) {

            console.log(
                "❌ Failed to send error message:",
                msgErr.message
            );
        }
    }
}

module.exports = {
    handlePaymentRequest
};
