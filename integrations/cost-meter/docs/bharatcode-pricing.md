# Direct API rate scope

Rates are USD per million tokens, checked October 8, 2026. This fork uses exact route and model identifiers. These are standard direct-provider estimates; they do not establish custom gateway or subscription costs.

OpenAI rates come from https://developers.openai.com/api/docs/pricing. The default subset includes GPT-6.1 Sol, GPT-6 Astra, GPT-6 Luna and GPT-5.6 Sol. Sol is $2 input, $0.10 cached input, $2.50 cache write and $10 output in the short tier; the long tier is $4/$0.20/$5/$15. The entire request uses the long tier above 272,000 input tokens including cache reads and writes. Regional, FedRAMP, Batch, Flex, Fast and Ultrafast pricing need route-specific configuration.

Anthropic rates come from https://platform.claude.com/docs/en/about-claude/pricing. The default subset includes the current Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5, plus explicitly listed legacy models. Default cache writes use the five-minute price; one-hour cache writes need configuration. Haiku 5.5 requests above 100,000 input tokens use the provider's long tier. Direct global API pricing excludes regional surcharges and tool charges.

DeepSeek rates come from https://api-docs.deepseek.com/quick_start/pricing. Flash off-peak cache hit/input/output rates are $0.003/$0.15/$0.60; peak rates are double. Pro off-peak rates remain $0.022/$0.66/$1.98, with double peak rates. Flash's official aliases are supported. Peak hours are 01:00–04:00 and 06:00–10:00 UTC on weekdays excluding Chinese public holidays. Historical rate records remain separate from current rates.

Unknown direct models, xAI, Google API routes, hosted gateways and custom endpoints are configurable and unpriced by default in this fork. The upstream broad catalog is retained only as legacy source data for historical migration; it is not automatically used as current billing evidence. No official price was inferred from a model name or third-party catalog.

The five subscription routes record plan token usage without claiming per-token API charges. Provider quota percentages are not a currency charge and are not converted into API costs.
