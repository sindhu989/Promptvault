const variablePattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g

function extractVariables(content) {
  const names = new Set()
  for (const match of content.matchAll(variablePattern)) {
    names.add(match[1])
  }
  return [...names]
}

function renderPrompt(content, variables) {
  const names = extractVariables(content)
  const normalizedValues = {}

  for (const name of names) {
    const value = variables[name]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`A value is required for {{${name}}}.`)
    }
    normalizedValues[name] = value.trim()
  }

  const renderedPrompt = content.replace(variablePattern, (_, name) => normalizedValues[name])
  return {
    variables: normalizedValues,
    renderedPrompt,
    output: [
      'Mock provider preview (no AI model was called):',
      '',
      renderedPrompt,
    ].join('\n'),
    provider: 'mock',
  }
}

module.exports = { extractVariables, renderPrompt }
