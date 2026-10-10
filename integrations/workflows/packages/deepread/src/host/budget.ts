import type { DeepreadDepth, EstimateCall, EstimateResult, RuntimeConfig } from './types.js'

const EST_PROMPT_OVERHEAD = 600

export function createBudgetRuntime(
  tune: RuntimeConfig,
  rates: { calibratedRate(): number | null; effectiveLatency(): number; effectiveRate(): number },
) {
  function estimateTokens(text: string): number {
    let cjk = 0
    let latin = 0
    let other = 0
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef)) cjk += 1
      else if (code >= 32 && code < 127) latin += 1
      else other += 1
    }
    return Math.ceil(cjk * 0.6 + latin * 0.25 + other * 0.5)
  }

  function estimateCall(calls: number, inputTokens: number, outputTokens: number): EstimateCall {
    const rate = rates.effectiveRate()
    const latency = rates.effectiveLatency()
    const minutes = (inputTokens + outputTokens) / rate / 60 + (calls * latency) / 60000
    return {
      calls,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      minutes: Math.round(minutes * 10) / 10,
      minutesFormula: '（(' + inputTokens + '+' + outputTokens + ') ÷ ' + Math.round(rate * 10) / 10 + ' tok/s + ' + calls + ' calls × ' + Math.round(latency) + 'ms）',
      estTokensPerSecond: Math.round(rate * 10) / 10,
      estLatencyPerCallMs: Math.round(latency),
      calibrated: rates.calibratedRate() !== null,
    }
  }

  function buildEstimate(text: string, depth: DeepreadDepth, ext: { chars?: number; tokensPerChar?: number } = {}): EstimateResult {
    const extrapolated = typeof ext.chars === 'number' ? ext : null
    const chars = extrapolated === null ? text.length : Math.max(1, Math.round(extrapolated.chars ?? text.length))
    const tokenRatio = extrapolated !== null && typeof extrapolated.tokensPerChar === 'number' && extrapolated.tokensPerChar > 0 ? extrapolated.tokensPerChar : null
    const tokOf = (length: number): number => tokenRatio === null ? estimateTokens(text.slice(0, length)) : Math.ceil(length * tokenRatio)
    const effectiveLength = Math.min(chars, tune.maxInputChars)
    const parts = Math.min(Math.ceil(effectiveLength / tune.chunkChars), tune.maxParts)
    const perInput = tokOf(Math.min(effectiveLength, tune.chunkChars)) + EST_PROMPT_OVERHEAD
    const summaryInput = parts * 400 + EST_PROMPT_OVERHEAD
    const modes: EstimateResult['modes'] = []
    modes.push({ mode: 'quick', note: 'One model call; input limited to 30000 characters', ...estimateCall(1, tokOf(Math.min(effectiveLength, 30000)) + EST_PROMPT_OVERHEAD, 2500) })
    modes.push(effectiveLength <= 9000
      ? { mode: 'deep', note: 'One model call for a short document', ...estimateCall(1, tokOf(effectiveLength) + EST_PROMPT_OVERHEAD, 4000) }
      : { mode: 'deep', note: 'Analyze ' + parts + ' sections and synthesize once', ...estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000) })
    const bookParts = Math.max(1, parts)
    modes.push({ mode: 'book', note: 'Analyze and synthesize ' + bookParts + ' book sections', ...estimateCall(bookParts + 1, bookParts * perInput + summaryInput, bookParts * 5000 + 5000) })
    modes.push(effectiveLength <= 9000
      ? { mode: 'map', note: 'One knowledge-map call for a short source', ...estimateCall(1, tokOf(effectiveLength) + EST_PROMPT_OVERHEAD, 5000) }
      : { mode: 'map', note: 'Extract ' + parts + ' sections and synthesize once', ...estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000) })
    const structureCalls = effectiveLength > 9000 ? 1 : 0
    const structureInput = structureCalls > 0 ? tokOf(5000) + EST_PROMPT_OVERHEAD : 0
    modes.push({ mode: 'feynman', note: (structureCalls > 0 ? 'One table-of-contents question call plus ' : '') + 'Analyze ' + Math.max(1, parts) + ' chapters plus one synthesis and review-plan call', ...estimateCall(Math.max(1, parts) + structureCalls + 1, Math.max(1, parts) * perInput + structureInput + summaryInput, Math.max(1, parts) * 5000 + 5000) })
    const result: EstimateResult = {
      chars,
      modes: modes.filter(entry => ['quick', 'deep', 'book'].includes(entry.mode)),
      estTokensPerSecond: Math.round(rates.effectiveRate() * 10) / 10,
      estLatencyPerCallMs: Math.round(rates.effectiveLatency()),
      calibrated: rates.calibratedRate() !== null,
    }
    if (extrapolated !== null) {
      result.sampled = true
      result.note = 'Extrapolated from sampled PDF pages'
    }
    return result
  }

  return { buildEstimate, estimateCall, estimateTokens }
}
