/** Read effective runtime services and invoke the real selected search adapter. */
export const inject = ['web', 'agentDefaultModel', 'agentPresets', 'webServer', 'llm']
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/compatibility-observer',
    async handler(_request, response) {
      response.setHeader('content-type', 'application/json')
      try {
        const search = await ctx.web.search({ query: 'fork compatibility', maxResults: 2 })
        response.end(JSON.stringify({ model: ctx.agentDefaultModel.currentSelection(), preset: ctx.agentPresets.defaultId,
          presets: (await ctx.agentPresets.list()).map(preset => preset.id), catalog: await ctx.llm.resolveModelInfo('bharatcode', 'deepseek-v4.1-flash'), search }))
      } catch (error) {
        response.statusCode = 500
        response.end(JSON.stringify({ error: String(error) }))
      }
    },
  }))
}
