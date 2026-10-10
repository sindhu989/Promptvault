const fs = require('fs')
const path = require('path')

const dataDirectory = path.resolve(__dirname, '../../.data')
const dataFile = path.join(dataDirectory, 'store.json')

function readState() {
  if (!fs.existsSync(dataFile)) {
    return { users: [], prompts: [], collections: [] }
  }

  const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.prompts)) {
    throw new Error(`Invalid PromptVault local data file: ${dataFile}`)
  }
  if (!Array.isArray(parsed.collections)) parsed.collections = []
  return parsed
}

const state = global.__promptvault_state || readState()
global.__promptvault_state = state

function save() {
  fs.mkdirSync(dataDirectory, { recursive: true })
  const temporaryFile = `${dataFile}.${process.pid}.tmp`
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(temporaryFile, dataFile)
}

module.exports = {
  users: state.users,
  prompts: state.prompts,
  collections: state.collections,
  save,
}
