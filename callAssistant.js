const WebSocket = require('ws');

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

function getVoiceUrl() {
    const configured = String(process.env.AI_VOICE_URL || '').trim();
    if (configured) return configured.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:').replace(/\/$/, '');
    const base = String(process.env.AI_API_URL || 'https://flexieduconsult-ai-link-wqnb.onrender.com')
        .trim().replace(/\/$/, '');
    return base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:') + '/voice';
}

function connectVoiceGateway() {
    const apiKey = String(process.env.AI_API_KEY || '').trim();
    if (!apiKey) throw new Error('AI_API_KEY is not configured; JARVIS cannot authenticate to AI Link.');
    const url = getVoiceUrl();
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { 'x-api-key': apiKey }, handshakeTimeout: 20000, maxPayload: 1024 * 1024 });
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { ws.terminate(); } catch {}
            reject(new Error('Timed out connecting to the AI Link voice gateway.'));
        }, 25000);
        ws.on('message', raw => {
            let message;
            try { message = JSON.parse(raw.toString()); } catch { return; }
            if (!settled && message.type === 'ready') {
                settled = true;
                clearTimeout(timeout);
                resolve(ws);
            } else if (!settled && message.type === 'error') {
                settled = true;
                clearTimeout(timeout);
                try { ws.close(); } catch {}
                reject(new Error(message.error || 'AI Link voice gateway rejected the session.'));
            }
        });
        ws.once('error', error => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(error);
            }
        });
        ws.once('close', (code, reason) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error('AI Link voice gateway closed before becoming ready: ' + String(reason || code)));
            }
        });
    });
}

async function attachGeminiCallAssistant(sock) {
    if (!sock || typeof sock !== 'object') throw new TypeError('A connected WhatsApp socket is required.');
    if (attachedSockets.has(sock)) return attachedSockets.get(sock);

    const setupPromise = (async () => {
        const [{ default: Voip }] = await Promise.all([
            import('@hiroosy/baileys-lite/voip')
        ]);
        const voip = new Voip(sock, { maxConcurrentCalls: 1, voipLogLevel: 'warn' });
        await voip.listen();

        const cleanupCall = (callId, reason = 'ended') => {
            const active = activeCalls.get(callId);
            if (!active) return;
            activeCalls.delete(callId);
            try { active.gateway.close(1000, 'WhatsApp call ended'); } catch {}
            console.log(`[CALL AI] Call ${callId} closed (${reason}).`);
        };

        // Baileys-Lite emits this event with TWO positional arguments:
        // (callInfo, decodedPcmFloat32). Do not destructure it as one object.
        voip.on('call_inbound_audio', (call, pcm) => {
            const callId = call?.callId;
            const active = activeCalls.get(callId);
            if (!active || !pcm?.length || active.gateway.readyState !== WebSocket.OPEN) return;
            try {
                const encoded = float32ToPcm16Base64(pcm);
                active.gateway.send(JSON.stringify({
                    type: 'audio',
                    data: encoded,
                    mimeType: 'audio/pcm;rate=16000'
                }));
                active.stats.inFrames++;
                active.stats.inSamples += pcm.length;
                if (active.stats.inFrames === 1 || active.stats.inFrames % 50 === 0) {
                    console.log('[CALL AI AUDIO] Caller audio forwarded', {
                        callId, frames: active.stats.inFrames, samples: active.stats.inSamples,
                        lastFrameSamples: pcm.length, gatewayState: active.gateway.readyState
                    });
                }
            } catch (error) {
                console.error('[CALL AI] Could not forward caller audio to AI Link:', error.message);
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
            console.log(`[CALL AI] Incoming call from ${call.peerJid || 'unknown caller'}; connecting to Flexi AI Link voice gateway.`);
            let gateway;
            try {
                gateway = await connectVoiceGateway();
                const active = { gateway, ready: true, stats: { inFrames: 0, inSamples: 0, outFrames: 0, outSamples: 0 } };
                activeCalls.set(callId, active);

                gateway.on('message', raw => {
                    let message;
                    try { message = JSON.parse(raw.toString()); } catch { return; }
                    if (message.type === 'audio' && typeof message.data === 'string') {
                        try {
                            const pcm24k = pcm16Base64ToFloat32(message.data);
                            const pcm16k = resampleFloat32(pcm24k, 24000, 16000);
                            const acceptedSamples = voip.coordinator.feedLiveAudio(callId, pcm16k);
                            active.stats.outFrames++;
                            active.stats.outSamples += pcm16k.length;
                            if (active.stats.outFrames === 1 || active.stats.outFrames % 25 === 0) {
                                console.log('[CALL AI AUDIO] AI audio fed to WhatsApp', {
                                    callId, frames: active.stats.outFrames, samples: active.stats.outSamples,
                                    lastFrameSamples: pcm16k.length, sourceSamples: pcm24k.length,
                                    acceptedSamples
                                });
                            }
                        } catch (error) {
                            console.error('[CALL AI] Could not play AI Link audio into WhatsApp:', error.message);
                        }
                    } else if (message.type === 'transcript' && message.text) {
                        console.log('[CALL AI AUDIO] Gemini response transcript received', { callId, characters: message.text.length });
                    } else if (message.type === 'turn_complete') {
                        console.log('[CALL AI AUDIO] Gemini turn completed', {
                            callId, callerFrames: active.stats.inFrames, responseFrames: active.stats.outFrames
                        });
                    } else if (message.type === 'error') {
                        console.error('[CALL AI] AI Link voice error:', message.code || '', message.error || '');
                    } else if (message.type === 'closed') {
                        console.warn('[CALL AI] AI Link voice session closed:', message.reason || '');
                    }
                });
                gateway.on('close', (code, reason) => {
                    console.warn('[CALL AI] AI Link WebSocket closed:', code, String(reason || ''));
                    if (activeCalls.get(callId)?.gateway === gateway) cleanupCall(callId, 'AI Link disconnected');
                    try { voip.hangup(callId); } catch {}
                });
                gateway.on('error', error => console.error('[CALL AI] AI Link WebSocket error:', error.message));

                await voip.acceptCall(callId);
                voip.coordinator.setExternalAudioMode(callId, true);
                console.log(`[CALL AI] AI Link voice gateway connected; answering call ${callId}.`);
                console.log('[CALL AI AUDIO] Audio diagnostics initialized', { callId, externalAudioMode: 'enabled' });
            } catch (error) {
                console.error('[CALL AI] Could not start AI Link voice session:', error.message);
                try { gateway?.close(); } catch {}
                activeCalls.delete(callId);
                try { await voip.hangup(callId); } catch {}
            } finally {
                pendingCalls.delete(callId);
            }
        });

        console.log('[CALL AI] Baileys-Lite call media listener is ready; Gemini Live is routed through Flexi AI Link.');
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
