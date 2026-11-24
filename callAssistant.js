const attachedSockets = new WeakMap();
const activeCalls = new Map();
const pendingCalls = new Set();

function float32ToPcm16Base64(samples) {
    const buffer = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
        buffer.writeInt16LE(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), i * 2);
    }
    return buffer.toString('base64');
}

function pcm16Base64ToFloat32(base64) {
    const buffer = Buffer.from(base64, 'base64');
    const usableLength = buffer.length - (buffer.length % 2);
    const samples = new Float32Array(usableLength / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
    return samples;
}

function resampleFloat32(input, fromRate = 24000, toRate = 16000) {
    if (!input.length || fromRate === toRate) return input;
    const outputLength = Math.max(1, Math.floor(input.length * toRate / fromRate));
    const output = new Float32Array(outputLength);
    const ratio = fromRate / toRate;
    for (let i = 0; i < outputLength; i++) {
        const position = i * ratio;
        const left = Math.floor(position);
        const right = Math.min(left + 1, input.length - 1);
        const fraction = position - left;
        output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
}

async function attachGeminiCallAssistant(sock) {
    if (!sock || typeof sock !== 'object') throw new TypeError('A connected WhatsApp socket is required.');
    if (!process.env.GEMINI_API_KEY) {
        console.warn('[CALL AI] GEMINI_API_KEY is not configured; live call answering remains disabled.');
        return null;
    }
    if (attachedSockets.has(sock)) return attachedSockets.get(sock);

    const setupPromise = (async () => {
        const [{ default: Voip }, { GoogleGenAI }] = await Promise.all([
            import('@hiroosy/baileys-lite/voip'),
            import('@google/genai')
        ]);
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const model = String(process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025').trim();
        const voip = new Voip(sock, { maxConcurrentCalls: 1, voipLogLevel: 'warn' });

        await voip.listen();

        const cleanupCall = (callId, reason = 'ended') => {
            const active = activeCalls.get(callId);
            if (!active) return;
            activeCalls.delete(callId);
            try { active.session.close(); } catch {}
            console.log(`[CALL AI] Call ${callId} closed (${reason}).`);
        };

        voip.on('call_inbound_audio', ({ call, pcm }) => {
            const callId = call?.callId;
            const active = activeCalls.get(callId);
            if (!active || !pcm?.length) return;
            try {
                active.session.sendRealtimeInput({
                    audio: {
                        data: float32ToPcm16Base64(pcm),
                        mimeType: 'audio/pcm;rate=16000'
                    }
                });
            } catch (error) {
                console.error('[CALL AI] Could not forward caller audio to Gemini:', error.message);
            }
        });

        voip.on('call_ended', call => cleanupCall(call?.callId, call?.stateData?.endReason || 'ended'));

        voip.on('call_incoming', async call => {
            const callId = String(call?.callId || '');
            if (!callId || pendingCalls.has(callId) || activeCalls.has(callId) || !call.canAccept) return;
            if (pendingCalls.size || activeCalls.size) {
                try { await voip.rejectCall(callId); } catch (error) {
                    console.warn('[CALL AI] Could not reject the extra incoming call:', error.message);
                }
                return;
            }

            pendingCalls.add(callId);
            console.log(`[CALL AI] Incoming call from ${call.peerJid || 'unknown caller'}; preparing Gemini Live.`);
            let session;
            try {
                await voip.acceptCall(callId);
                voip.coordinator.setExternalAudioMode(callId, true);

                session = await ai.live.connect({
                    model,
                    config: {
                        responseModalities: ['AUDIO'],
                        systemInstruction: {
                            parts: [{
                                text: 'You are JARVIS, the voice assistant for Flexi Educational Consult. Speak naturally, warmly, clearly and concisely. Listen carefully, answer the caller directly, and ask one clarification at a time when needed. Do not claim to perform an action unless it has actually been completed. Use Nigerian English naturally when appropriate.'
                            }]
                        },
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: 'Aoede' }
                            }
                        },
                        outputAudioTranscription: {}
                    },
                    callbacks: {
                        onmessage: message => {
                            const content = message?.serverContent;
                            if (content?.interrupted) {
                                try {
                                    voip.coordinator.setExternalAudioMode(callId, false);
                                    voip.coordinator.setExternalAudioMode(callId, true);
                                } catch {}
                            }
                            for (const part of content?.modelTurn?.parts || []) {
                                const audioBase64 = part?.inlineData?.data;
                                if (!audioBase64) continue;
                                try {
                                    const pcm24k = pcm16Base64ToFloat32(audioBase64);
                                    voip.coordinator.feedLiveAudio(callId, resampleFloat32(pcm24k, 24000, 16000));
                                } catch (error) {
                                    console.error('[CALL AI] Could not play Gemini audio into WhatsApp:', error.message);
                                }
                            }
                            const transcript = content?.outputTranscription?.text;
                            if (transcript) console.log('[CALL AI] JARVIS:', transcript);
                        },
                        onerror: error => console.error('[CALL AI] Gemini Live error:', error?.message || error),
                        onclose: event => console.log('[CALL AI] Gemini Live connection closed:', event?.reason || 'no reason supplied')
                    }
                });

                activeCalls.set(callId, { session, model });
                console.log(`[CALL AI] Gemini Live connected for call ${callId} using ${model}.`);
            } catch (error) {
                console.error('[CALL AI] Could not start the live assistant:', error.message);
                try { session?.close(); } catch {}
                try { await voip.hangup(callId); } catch {}
            } finally {
                pendingCalls.delete(callId);
            }
        });

        console.log('[CALL AI] Baileys-Lite call media listener is ready on the existing WhatsApp socket.');
        return voip;
    })();

    attachedSockets.set(sock, setupPromise);
    try {
        const voip = await setupPromise;
        attachedSockets.set(sock, voip);
        return voip;
    } catch (error) {
        attachedSockets.delete(sock);
        throw error;
    }
}

module.exports = { attachGeminiCallAssistant };
