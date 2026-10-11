// ============================================================
// 🚫 JARVIS BAN MANAGER
// ============================================================
// Handles persistent, group-specific member bans with
// automatic re-enforcement when banned members rejoin.
// ============================================================

const mongoose = require('mongoose');

// ============================================================
// BAN SCHEMA
// ============================================================

const BanSchema = new mongoose.Schema({
    groupJid: {
        type: String,
        required: true,
        index: true
    },
    targetJid: {
        type: String,
        required: true,
        index: true
    },
    targetPhone: String,
    bannedBy: {
        type: String,
        required: true
    },
    reason: {
        type: String,
        default: "No reason provided"
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
});

// Compound unique index: one ban per group per target
BanSchema.index({ groupJid: 1, targetJid: 1, isActive: 1 }, { unique: false });

const Ban = mongoose.model('Ban', BanSchema);

// ============================================================
// CREATE OR UPDATE BAN
// ============================================================

async function createBan({
    groupJid,
    targetJid,
    targetPhone,
    bannedBy,
    reason = "No reason provided"
}) {
    try {
        if (!groupJid || !targetJid || !bannedBy) {
            throw new Error("Missing required ban parameters");
        }

        // Check if ban already exists
        const existingBan = await Ban.findOne({
            groupJid,
            targetJid,
            isActive: true
        });

        if (existingBan) {
            console.log(`⚠️ Ban already exists for ${targetJid} in ${groupJid}`);
            return existingBan;
        }

        // Create new ban
        const newBan = new Ban({
            groupJid,
            targetJid,
            targetPhone: targetPhone || targetJid.split('@')[0],
            bannedBy,
            reason,
            isActive: true
        });

        await newBan.save();
        console.log(`✅ Ban created: ${targetJid} in ${groupJid}`);
        return newBan;

    } catch (err) {
        console.log("❌ Create Ban Error:", err.message);
        throw err;
    }
}

// ============================================================
// LIFT BAN
// ============================================================

async function liftBan({ groupJid, targetJid }) {
    try {
        if (!groupJid || !targetJid) {
            throw new Error("Missing group or target JID");
        }

        const ban = await Ban.findOne({
            groupJid,
            targetJid,
            isActive: true
        });

        if (!ban) {
            return null; // No active ban found
        }

        ban.isActive = false;
        await ban.save();

        console.log(`✅ Ban lifted: ${targetJid} in ${groupJid}`);
        return ban;

    } catch (err) {
        console.log("❌ Lift Ban Error:", err.message);
        throw err;
    }
}

// ============================================================
// CHECK IF MEMBER IS BANNED
// ============================================================

async function isBanned({ groupJid, targetJid }) {
    try {
        if (!groupJid || !targetJid) {
            return false;
        }

        const ban = await Ban.findOne({
            groupJid,
            targetJid,
            isActive: true
        });

        return !!ban;

    } catch (err) {
        console.log("❌ Is Banned Check Error:", err.message);
        return false; // Fail open if DB is unavailable
    }
}

// ============================================================
// GET ACTIVE BANS FOR GROUP
// ============================================================

async function getActiveBans(groupJid) {
    try {
        if (!groupJid) {
            return [];
        }

        const bans = await Ban.find({
            groupJid,
            isActive: true
        }).sort({ createdAt: -1 });

        return bans;

    } catch (err) {
        console.log("❌ Get Active Bans Error:", err.message);
        return [];
    }
}

// ============================================================
// RESOLVE TARGET JID
// ============================================================

function resolveTargetJid(input) {
    if (!input) return null;

    // Already a JID
    if (input.includes('@')) {
        return input;
    }

    // Phone number: normalize to WhatsApp JID
    let phone = String(input).replace(/\D/g, '');

    if (phone.startsWith('0')) {
        phone = '234' + phone.slice(1);
    }

    if (phone.length >= 10 && phone.length <= 15) {
        return phone + '@s.whatsapp.net';
    }

    return null;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    Ban,
    createBan,
    liftBan,
    isBanned,
    getActiveBans,
    resolveTargetJid
};
