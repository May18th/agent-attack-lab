const productionApi = 'https://api.yuanyiagentzhandui.cn'
const previewApi = 'https://preview-api.yuanyiagentzhandui.cn'

export function configurePagesApi(env = process.env) {
  if (env.CF_PAGES !== '1') return null

  const branch = env.CF_PAGES_BRANCH?.trim()
  if (!branch) {
    throw new Error('Cloudflare Pages build is missing CF_PAGES_BRANCH; refusing to choose an API target.')
  }

  const api = branch === 'main' ? productionApi : previewApi
  env.VITE_AGENT_API = api
  return { branch, api }
}

export function configureBuildApi({ env = process.env, args = process.argv.slice(2) } = {}) {
  const pagesBuild = configurePagesApi(env)
  if (pagesBuild) {
    return { target: `pages:${pagesBuild.branch}`, api: pagesBuild.api }
  }

  if (!args.includes('--production')) return null

  env.VITE_AGENT_API = productionApi
  return { target: 'production', api: productionApi }
}
