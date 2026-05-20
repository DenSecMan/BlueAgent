/**
 * Tool: tavily_search
 * Search the web using the Tavily API.
 * Requires: TAVILY_API_KEY environment variable
 */

export const schema = {
  name: 'tavily_search',
  description: 'Search the web for current information, news, and facts',
  parameters: {
    type: 'object',
    properties: {
      query:      { type: 'string',  description: 'The search query' },
      maxResults: { type: 'integer', description: 'Number of results to return (default 5, max 10)' },
    },
    required: ['query'],
  },
}

export async function invoke({ query, maxResults = 5 }) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:      process.env.TAVILY_API_KEY,
      query,
      max_results:  Math.min(maxResults, 10),
      search_depth: 'basic',
    }),
  })

  if (!res.ok) throw new Error(`Tavily API ${res.status}: ${await res.text()}`)

  const data = await res.json()
  return data.results.map(r => ({
    title:   r.title,
    url:     r.url,
    content: r.content,
    score:   r.score,
  }))
}
