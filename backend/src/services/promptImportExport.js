const MAX_IMPORTS = 100
const MAX_TITLE_LENGTH = 160
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_CONTENT_LENGTH = 50000
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 40
const textSeparator = '\n\n--- PROMPTVAULT PROMPT ---\n\n'
const markdownSeparator = '\n\n<!-- PromptVault Prompt -->\n\n'

function normalizeFormat(format) {
  const normalized = String(format || '').toLowerCase().replace(/^\./, '')
  if (normalized === 'markdown') return 'md'
  if (['json', 'csv', 'md', 'txt'].includes(normalized)) return normalized
  throw new Error('Choose a supported file format: JSON, CSV, Markdown, or TXT.')
}

function encodeMetadata(value) {
  return encodeURIComponent(String(value ?? ''))
}

function decodeMetadata(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Import contains invalid encoded metadata.')
  }
}

function parseTags(value) {
  const text = String(value || '')
  if (text.startsWith('[')) {
    let tags
    try {
      tags = JSON.parse(text)
    } catch {
      throw new Error('Tags must be a valid JSON array or pipe-separated text.')
    }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
      throw new Error('Tags must be a list of text values.')
    }
    return tags
  }
  return text.split('|').map((tag) => tag.trim()).filter(Boolean)
}

function parseEncodedTags(value) {
  return parseTags(decodeMetadata(value))
}

function parseCsv(source) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let quoteClosed = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        quoteClosed = true
      } else {
        field += character
      }
    } else if (character === '"') {
      if (field.length !== 0 || quoteClosed) {
        throw new Error('CSV contains a quote in an unquoted field.')
      }
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
      quoteClosed = false
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ''
      quoteClosed = false
    } else {
      if (quoteClosed) throw new Error('CSV contains characters after a quoted field.')
      field += character
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  if (field.length || row.length) {
    row.push(field)
    if (row.some((value) => value.trim())) rows.push(row)
  }
  if (!rows.length) throw new Error('CSV file is empty.')

  const headers = rows.shift().map((header) => header.trim().toLowerCase())
  const required = ['title', 'content', 'category']
  const missing = required.filter((header) => !headers.includes(header))
  if (missing.length) {
    throw new Error(`CSV is missing required column(s): ${missing.join(', ')}.`)
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV column names must be unique.')
  }

  return rows.map((values, rowIndex) => {
    if (values.length > headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has more values than the header.`)
    }
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))
    for (const key of ['title', 'description', 'content', 'category', 'tags']) {
      if (/^'[\t ]*[=+@-]/.test(record[key])) {
        record[key] = record[key].slice(1)
      }
    }
    return {
      title: record.title,
      description: record.description,
      content: record.content,
      category: record.category,
      tags: parseTags(record.tags),
    }
  })
}

function parseDelimitedText(source, separator, format) {
  const blocks = source
    .split(separator)
    .filter((block) => block.trim())
  if (!blocks.length) throw new Error(`${format.toUpperCase()} file is empty.`)

  return blocks.map((block, index) => {
    const match = block.match(
      /^Title:\s*(.*?)\s*\r?\nCategory:\s*(.*?)\s*\r?\nDescription:\s*([\s\S]*?)\r?\nTags:\s*([\s\S]*?)\r?\nContent:\r?\n([\s\S]*)$/,
    )
    if (!match) {
      if (format === 'txt' && blocks.length === 1) {
        return { title: 'Imported prompt', category: 'Imported', content: block }
      }
      throw new Error(`${format.toUpperCase()} prompt ${index + 1} has an invalid structure.`)
    }
    return {
      title: decodeMetadata(match[1]),
      category: decodeMetadata(match[2]),
      description: decodeMetadata(match[3]),
      tags: parseEncodedTags(match[4]),
      content: match[5],
    }
  })
}

function parseMarkdown(source) {
  const blocks = source
    .split(markdownSeparator)
    .map((block) => block.trim())
    .filter(Boolean)
  if (!blocks.length) throw new Error('Markdown file is empty.')

  return blocks.map((block, index) => {
    const header = block.match(/^##\s+(.+?)\s*\r?\n/)
    const metadata = block.match(
      /^##\s+(.+?)\s*\r?\nDescription:\s*(.*?)\s*\r?\nCategory:\s*(.*?)\s*\r?\nTags:\s*(.*?)\s*\r?\n\r?\n/,
    )
    if (!header || !metadata) {
      throw new Error(`Markdown prompt ${index + 1} has an invalid structure.`)
    }

    const body = block.slice(metadata[0].length)
    const fence = body.match(/^(`{3,}|~{3,})text\s*\r?\n/)
    if (!fence) {
      throw new Error(`Markdown prompt ${index + 1} is missing its text content fence.`)
    }
    const contentStart = fence[0].length
    const closingFence = new RegExp(`\\r?\\n${fence[1]}\\s*$`)
    const closingMatch = body.slice(contentStart).match(closingFence)
    if (!closingMatch) {
      throw new Error(`Markdown prompt ${index + 1} has an unclosed content fence.`)
    }
    const content = body.slice(contentStart, contentStart + closingMatch.index)
    return {
      title: decodeMetadata(metadata[1]),
      description: decodeMetadata(metadata[2]),
      category: decodeMetadata(metadata[3]),
      tags: parseEncodedTags(metadata[4]),
      content,
    }
  })
}

function parseImport(source, format, filename) {
  const normalizedFormat = normalizeFormat(format)
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('The selected file is empty.')
  }
  const text = source.replace(/^\uFEFF/, '')

  if (normalizedFormat === 'json') {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('JSON file is not valid JSON.')
    }
    const records = Array.isArray(parsed) ? parsed : parsed?.prompts
    if (!Array.isArray(records)) {
      throw new Error('JSON must contain a prompt array or a PromptVault backup.')
    }
    if (
      parsed &&
      !Array.isArray(parsed) &&
      parsed.collections !== undefined &&
      !Array.isArray(parsed.collections)
    ) {
      throw new Error('Backup collections must be an array.')
    }
    return {
      prompts: records,
      collections: Array.isArray(parsed?.collections) ? parsed.collections : [],
    }
  }
  if (normalizedFormat === 'csv') {
    return { prompts: parseCsv(text), collections: [] }
  }
  if (normalizedFormat === 'md') {
    return { prompts: parseMarkdown(text), collections: [] }
  }

  const exportedTextPrompts = text.includes(textSeparator) || /^Title:\s/m.test(text)
    ? parseDelimitedText(text, textSeparator, 'txt')
    : [{
        title: String(filename || 'Imported prompt').replace(/\.[^.]+$/, '') || 'Imported prompt',
        category: 'Imported',
        content: text,
      }]
  return { prompts: exportedTextPrompts, collections: [] }
}

function validateRecords(records, collectionRecords) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Import must contain at least one prompt.')
  }
  if (records.length > MAX_IMPORTS) {
    throw new Error(`Import is limited to ${MAX_IMPORTS} prompts at a time.`)
  }
  if (collectionRecords === undefined) collectionRecords = []
  if (!Array.isArray(collectionRecords)) {
    throw new Error('Backup collections must be an array.')
  }
  if (collectionRecords.length > MAX_IMPORTS) {
    throw new Error(`Import is limited to ${MAX_IMPORTS} collections at a time.`)
  }

  const errors = []
  const prompts = records.map((record, index) => {
    const row = index + 1
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`Prompt ${row}: expected an object.`)
      return null
    }
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const content = typeof record.content === 'string' ? record.content : ''
    const category = typeof record.category === 'string' ? record.category.trim() : ''
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    if (!title) errors.push(`Prompt ${row}: title is required.`)
    if (!content.trim()) errors.push(`Prompt ${row}: content is required.`)
    if (!category) errors.push(`Prompt ${row}: category is required.`)
    if (title.length > MAX_TITLE_LENGTH) errors.push(`Prompt ${row}: title exceeds ${MAX_TITLE_LENGTH} characters.`)
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Prompt ${row}: description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`)
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      errors.push(`Prompt ${row}: content exceeds ${MAX_CONTENT_LENGTH} characters.`)
    }
    if (category.length > 80) errors.push(`Prompt ${row}: category exceeds 80 characters.`)

    const sourceTags = Array.isArray(record.tags)
      ? record.tags
      : typeof record.tags === 'string'
        ? record.tags.split('|')
        : []
    if (sourceTags.some((tag) => typeof tag !== 'string')) {
      errors.push(`Prompt ${row}: tags must be text values.`)
    }
    const tags = [...new Set(sourceTags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean))]
    if (tags.length > MAX_TAGS) errors.push(`Prompt ${row}: no more than ${MAX_TAGS} tags are allowed.`)
    if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
      errors.push(`Prompt ${row}: tags must be ${MAX_TAG_LENGTH} characters or fewer.`)
    }

    return {
      sourceId: record.id == null ? '' : String(record.id),
      title,
      description,
      content,
      category,
      tags,
      favorite: record.favorite === true,
      archived: record.archived === true,
      versionHistory: Array.isArray(record.versionHistory) ? record.versionHistory : [],
      testRuns: Array.isArray(record.testRuns) ? record.testRuns : [],
    }
  })

  const sourceIds = new Set(prompts.filter(Boolean).map((prompt) => prompt.sourceId).filter(Boolean))
  const seenSourceIds = new Set()
  for (const prompt of prompts.filter(Boolean)) {
    if (prompt.sourceId && seenSourceIds.has(prompt.sourceId)) {
      errors.push('Prompt IDs in the backup must be unique.')
      break
    }
    if (prompt.sourceId) seenSourceIds.add(prompt.sourceId)
  }
  const collections = collectionRecords.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`Collection ${index + 1}: expected an object.`)
      return null
    }
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    if (!name) errors.push(`Collection ${index + 1}: name is required.`)
    if (name.length > 80) errors.push(`Collection ${index + 1}: name exceeds 80 characters.`)
    if (description.length > 240) errors.push(`Collection ${index + 1}: description exceeds 240 characters.`)
    if (!Array.isArray(record.promptIds)) {
      errors.push(`Collection ${index + 1}: promptIds must be an array.`)
    }
    const promptIds = Array.isArray(record.promptIds) ? record.promptIds.map(String) : []
    if (promptIds.length > MAX_IMPORTS) {
      errors.push(`Collection ${index + 1}: no more than ${MAX_IMPORTS} prompts are allowed.`)
    }
    const missingPrompts = promptIds.filter((id) => !sourceIds.has(id))
    if (missingPrompts.length) {
      errors.push(`Collection ${index + 1}: references prompts missing from this import.`)
    }
    return { name, description, sourcePromptIds: promptIds }
  })

  if (errors.length) {
    throw new Error(`Import validation failed. ${errors.slice(0, 12).join(' ')}`)
  }
  return { prompts, collections }
}

function escapeCsv(value) {
  const text = String(value ?? '')
  const safeText = /^[\t ]*[=+@-]/.test(text)
    ? `'${text}`
    : text
  return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText
}

function toTextRecord(prompt) {
  return [
    `Title: ${encodeMetadata(prompt.title)}`,
    `Category: ${encodeMetadata(prompt.category)}`,
    `Description: ${encodeMetadata(prompt.description || '')}`,
    `Tags: ${encodeMetadata(JSON.stringify(prompt.tags || []))}`,
    'Content:',
    prompt.content,
  ].join('\n')
}

function exportPrompts(prompts, collections, format) {
  const normalizedFormat = normalizeFormat(format)
  if (normalizedFormat === 'json') {
    return {
      contentType: 'application/json; charset=utf-8',
      extension: 'json',
      body: JSON.stringify({
        app: 'PromptVault',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        prompts: prompts.map((prompt) => ({
          id: prompt.id,
          title: prompt.title,
          description: prompt.description || '',
          content: prompt.content,
          category: prompt.category,
          tags: prompt.tags || [],
          favorite: Boolean(prompt.favorite),
          archived: Boolean(prompt.archived),
          versionHistory: prompt.versionHistory || [],
          testRuns: prompt.testRuns || [],
          createdAt: prompt.createdAt,
          updatedAt: prompt.updatedAt,
        })),
        collections: collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          description: collection.description || '',
          promptIds: collection.promptIds || [],
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
        })),
      }, null, 2),
    }
  }

  if (normalizedFormat === 'csv') {
    const headers = ['title', 'description', 'content', 'category', 'tags']
    const rows = prompts.map((prompt) => [
      prompt.title,
      prompt.description || '',
      prompt.content,
      prompt.category,
      JSON.stringify(prompt.tags || []),
    ].map(escapeCsv).join(','))
    return {
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
      body: [headers.join(','), ...rows].join('\r\n'),
    }
  }

  if (normalizedFormat === 'md') {
    const blocks = prompts.map((prompt) => {
      const content = String(prompt.content || '')
      const longestFence = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length))
      const fence = '`'.repeat(longestFence + 1)
      return [
        `## ${encodeMetadata(prompt.title)}`,
        `Description: ${encodeMetadata(prompt.description || '')}`,
        `Category: ${encodeMetadata(prompt.category)}`,
        `Tags: ${encodeMetadata(JSON.stringify(prompt.tags || []))}`,
        '',
        `${fence}text`,
        content,
        fence,
      ].join('\n')
    })
    return {
      contentType: 'text/markdown; charset=utf-8',
      extension: 'md',
      body: blocks.join(markdownSeparator),
    }
  }

  return {
    contentType: 'text/plain; charset=utf-8',
    extension: 'txt',
    body: prompts.map(toTextRecord).join(textSeparator),
  }
}

module.exports = {
  exportPrompts,
  parseImport,
  validateRecords,
  MAX_CONTENT_LENGTH,
}
