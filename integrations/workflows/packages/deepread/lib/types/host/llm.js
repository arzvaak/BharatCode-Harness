import { errorMessage, isLlmCatalogService, isLlmStreamService, isRecord } from './types.js';
export function str(v, fallback) {
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}
export function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
export function arr(v) {
    if (Array.isArray(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '')
        return [v.trim()];
    return [];
}
export function repairJson(text) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (const ch of String(text)) {
        if (esc) {
            out += ch;
            esc = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            esc = true;
            continue;
        }
        if (ch === '"') {
            inStr = !inStr;
            out += ch;
            continue;
        }
        if (inStr) {
            if (ch === '\n') {
                out += '\\n';
                continue;
            }
            if (ch === '\r') {
                out += '\\r';
                continue;
            }
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
        }
        out += ch;
    }
    return out;
}
export function parseJson(text) {
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const attempts = [cleaned];
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start)
        attempts.push(cleaned.slice(start, end + 1));
    for (const raw of attempts) {
        const repaired = repairJson(raw);
        for (const candidate of [raw, repaired, raw.replace(/,\s*([}\]])/g, '$1'), repaired.replace(/,\s*([}\]])/g, '$1')]) {
            try {
                return JSON.parse(candidate);
            }
            catch (error) { }
        }
    }
    return null;
}
export function splitChunks(text, size) {
    const paras = text.split(/\n{2,}|\r\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    const chunks = [];
    let current = '';
    for (const para of paras) {
        if (para.length > size) {
            if (current.trim() !== '') {
                chunks.push(current.trim());
                current = '';
            }
            let rest = para;
            while (rest.length > size) {
                let cut = rest.slice(0, size);
                let found = -1;
                for (let k = cut.length - 1; k > Math.floor(size * 0.5); k--) {
                    const ch = cut[k];
                    if (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '.' || ch === '!' || ch === '?' || ch === ';') {
                        found = k + 1;
                        break;
                    }
                }
                if (found > 0)
                    cut = cut.slice(0, found);
                chunks.push(cut.trim());
                rest = rest.slice(cut.length);
            }
            if (rest.trim() !== '')
                current = rest.trim();
        }
        else if ((current === '' ? 0 : current.length + 2) + para.length > size) {
            chunks.push(current.trim());
            current = para;
        }
        else {
            current = current === '' ? para : current + '\n\n' + para;
        }
    }
    if (current.trim() !== '')
        chunks.push(current.trim());
    return chunks;
}
export function createLlmRuntime(deps) {
    const { ctx, estimateTokens, llmCallStats, recordCalibration } = deps;
    function selectedModel() {
        const sel = ctx.get('agentDefaultModel');
        if (sel !== undefined && typeof sel.currentSelection === 'function') {
            const s = sel.currentSelection();
            if (isRecord(s) && typeof s.provider === 'string' && typeof s.model === 'string') {
                return { provider: s.provider, model: s.model, reasoningEffort: s.reasoningEffort };
            }
        }
        return null;
    }
    async function pickConfig() {
        const cfg = selectedModel();
        if (cfg !== null)
            return cfg;
        if (!isLlmCatalogService(ctx.llm)) {
            throw new Error('No model provider is available for close-reading analysis');
        }
        const providers = ctx.llm.listProviders();
        if (!Array.isArray(providers)) {
            throw new Error('No model provider is available for close-reading analysis');
        }
        const first = providers.find((provider) => typeof provider === 'string' || (isRecord(provider) && typeof provider.id === 'string'));
        const providerId = typeof first === 'string' ? first : (isRecord(first) && typeof first.id === 'string' ? first.id : null);
        if (providerId === null) {
            throw new Error('No model provider is available for close-reading analysis');
        }
        const models = await ctx.llm.listModels(providerId);
        if (!Array.isArray(models)) {
            throw new Error('Provider "' + providerId + '" has no available model');
        }
        const firstModel = models.find((model) => typeof model === 'string' || (isRecord(model) && typeof model.id === 'string'));
        const modelId = typeof firstModel === 'string' ? firstModel : (isRecord(firstModel) && typeof firstModel.id === 'string' ? firstModel.id : null);
        if (modelId === null) {
            throw new Error('Provider "' + providerId + '" has no available model');
        }
        return { provider: providerId, model: modelId };
    }
    async function callModel(cfg, system, userText, maxTokens, signal) {
        const options = {
            provider: cfg.provider,
            model: cfg.model,
            system,
            messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
            temperature: 0.2,
            maxTokens,
            signal,
        };
        let text = '';
        let failure = null;
        if (!isLlmStreamService(ctx.llm))
            throw new Error('The model service does not support streaming');
        for await (const chunk of ctx.llm.stream(options)) {
            if (signal !== undefined && signal !== null && signal.aborted)
                throw new Error('The reading task was cancelled');
            if (!isRecord(chunk))
                continue;
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                text += chunk.text;
            }
            else if (chunk.type === 'finish') {
                const reason = chunk.reason;
                if (isRecord(reason) && (reason.kind === 'error' || reason.kind === 'aborted')) {
                    const f = reason.failure;
                    failure = isRecord(f) ? str(f.message, str(f.code, 'Model call failed')) : 'Model call failed';
                }
            }
        }
        if (failure !== null)
            throw new Error('Model call failed: ' + failure);
        if (text.trim() === '')
            throw new Error('The model returned an empty response');
        return text;
    }
    function looksTruncated(text) {
        const t = String(text).trim();
        if (t === '')
            return false;
        const last = t[t.length - 1];
        return last !== '}' && last !== ']';
    }
    async function callModelJson(cfg, system, userText, maxTokens, signal) {
        const MAX_BUDGET = 16000;
        let prompt = userText;
        let budget = maxTokens;
        const history = [];
        const callStarted = Date.now();
        for (let attempt = 0; attempt < 3; attempt++) {
            let text = '';
            let error = null;
            const t0 = Date.now();
            try {
                text = await callModel(cfg, system, prompt, budget, signal);
                const elapsedMs = Math.max(1, Date.now() - t0);
                const tokens = estimateTokens(text);
                const seconds = elapsedMs / 1000;
                if (text.trim() !== '' && tokens > 0) {
                    const rateTokPerSec = tokens / seconds;
                    const generationMs = rateTokPerSec > 0 ? (tokens / rateTokPerSec) * 1000 : elapsedMs;
                    recordCalibration(rateTokPerSec, elapsedMs - generationMs);
                }
            }
            catch (err) {
                error = errorMessage(err);
            }
            const parsed = error === null ? parseJson(text) : null;
            history.push({ text, error });
            if (parsed !== null) {
                llmCallStats.calls++;
                llmCallStats.ms += Date.now() - callStarted;
                return parsed;
            }
            const truncated = error === null && looksTruncated(text);
            if (error !== null || truncated) {
                budget = Math.min(Math.ceil(budget * 1.5), MAX_BUDGET);
            }
            if (error !== null) {
                prompt = userText + '\n\n[Correction] The previous call failed (' + error + '). The output budget was increased. Return exactly one valid JSON object without explanations or extra text.';
            }
            else if (truncated) {
                prompt = userText + '\n\n[Correction] The previous JSON response was truncated. Use at most 6 arguments, 4 quotations, 5 concepts, and 4 questions, each in one sentence. Return a complete JSON object ending with }.';
            }
            else {
                prompt = userText + '\n\n[Correction] The previous response was invalid JSON. Return one JSON object without explanations, Markdown fences, trailing commas, or literal newlines inside strings. Escape multiline text with \\n, escape quotation marks, and omit trailing commas.';
            }
        }
        llmCallStats.calls++;
        llmCallStats.ms += Date.now() - callStarted;
        const kinds = history.map((h) => {
            if (h.error !== null)
                return 'Underlying error (' + h.error + '）';
            if (looksTruncated(h.text))
                return 'Truncated output';
            if (String(h.text).trim() === '')
                return 'Empty output';
            return 'JSON parsing failed';
        });
        const tail = String(history[history.length - 1]?.text ?? '').trim();
        const shown = tail.length > 160 ? tail.slice(-160) : tail;
        throw new Error('The model failed to return valid JSON after 3 attempts: ' + kinds.join('；') + (shown === '' ? '' : '. Last output suffix: ' + shown));
    }
    return { callModelJson, pickConfig, selectedModel };
}
