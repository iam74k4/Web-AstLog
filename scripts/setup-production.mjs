// GitHub の外部設定を再現する。既定は設定内容の表示だけ。--apply で実際に設定する。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repository = 'iam74k4/Web-AstLog'
const api = async (path, method = 'GET', body) => {
  const args = ['api', `repos/${repository}/${path}`, '-X', method]
  if (body) args.push('--input', '-')
  // execFile は stdin を渡せないため、body がある要求だけ spawn で送る。
  if (!body) return JSON.parse((await exec('gh', args)).stdout)
  const { spawn } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [],
      err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve(JSON.parse(Buffer.concat(out).toString()))
        : reject(new Error(Buffer.concat(err).toString())),
    )
    child.stdin.end(JSON.stringify(body))
  })
}
const environment = {
  wait_timer: 0,
  prevent_self_review: false,
  reviewers: [{ type: 'User', id: 118629892 }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
}
const protection = {
  required_status_checks: { strict: true, contexts: ['check', 'fit'] },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
  },
  restrictions: null,
  required_conversation_resolution: true,
  allow_force_pushes: false,
  allow_deletions: false,
}
if (!process.argv.includes('--apply')) {
  console.log(
    JSON.stringify(
      { repository, production: environment, allowedBranch: 'main', main: protection },
      null,
      2,
    ),
  )
  console.log(
    '適用: node scripts/setup-production.mjs --apply（GitHub の Administration / Environments の書き込み権限が必要）',
  )
} else {
  await api('environments/production', 'PUT', environment)
  const { branch_policies: policies } = await api(
    'environments/production/deployment-branch-policies',
  )
  if (policies.some((policy) => policy.name !== 'main' || policy.type !== 'branch'))
    throw new Error('production に main 以外の許可ルールがあります。Settings で確認してください')
  if (!policies.length)
    await api('environments/production/deployment-branch-policies', 'POST', {
      name: 'main',
      type: 'branch',
    })
  await api('branches/main/protection', 'PUT', protection)
  const saved = await api('environments/production')
  const branch = await api('branches/main/protection')
  if (
    !saved.protection_rules.some((rule) => rule.type === 'required_reviewers') ||
    !branch.enforce_admins.enabled
  )
    throw new Error('設定の読み戻しが一致しません')
  console.log(
    '✓ production: 本人の承認・main のみ。main: PR・最新の check / fit・会話解決を必須化。強制 push / 削除を禁止',
  )
  console.log(
    'CLOUDFLARE_API_TOKEN は production の Environment secrets に設定してください（このスクリプトでは読み書きしません）',
  )
}
