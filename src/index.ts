import type { ExtensionContext, QuickInputButton, QuickPickItem, StatusBarItem } from 'vscode'
import { exec } from 'node:child_process'
import { commands, StatusBarAlignment, ThemeIcon, window } from 'vscode'

const STORAGE_KEY = 'openInGitHub.gitUsers'
const DEFAULT_USERS: { name: string, email: string }[] = []

let gitUsers: { name: string, email: string }[] = []
let statusBar: StatusBarItem
let contextRef: ExtensionContext

async function getGitUserInfo(): Promise<{ name: string, email: string }> {
  const execPromise = (cmd: string) => new Promise<string>((resolve) => {
    exec(cmd, (err, stdout) => {
      if (err)
        resolve('未知')
      else resolve(stdout.trim() || '未知')
    })
  })
  const name = await execPromise('git config --global user.name')
  const email = await execPromise('git config --global user.email')
  return { name, email }
}

function saveGitUsers() {
  if (contextRef)
    contextRef.globalState.update(STORAGE_KEY, gitUsers)
}

function loadGitUsers(context: ExtensionContext) {
  contextRef = context
  const stored = context.globalState.get<{ name: string, email: string }[]>(STORAGE_KEY)
  gitUsers = (stored && Array.isArray(stored) && stored.length > 0) ? stored : DEFAULT_USERS.slice()
}

async function setGitUserInfo(name: string, email: string) {
  await new Promise<void>((resolve) => {
    exec(`git config --global user.name "${name}"`, () => {
      exec(`git config --global user.email "${email}"`, () => {
        resolve()
      })
    })
  })
  // 自动加入到gitUsers并去重
  if (!gitUsers.find(u => u.name === name && u.email === email)) {
    gitUsers.unshift({ name, email })
    // 最多保存10个
    gitUsers = gitUsers.slice(0, 10)
    saveGitUsers()
  }
  window.showInformationMessage(`已切换为: ${name} <${email}> (全局配置)`)
}

async function customSetGitUserInfo() {
  const name = await window.showInputBox({ prompt: '请输入新的Git用户名', placeHolder: 'user.name' })
  if (!name)
    return
  const email = await window.showInputBox({ prompt: '请输入新的Git邮箱', placeHolder: 'user.email' })
  if (!email)
    return
  // 新增：自定义输入时先做重复校验
  window.showInformationMessage(`gitUsers: ${gitUsers}, name: ${name}, email: ${email}`)
  if (gitUsers.find(u => u.name === name && u.email === email)) {
    window.showWarningMessage(`该用户配置已存在: ${name} <${email}>`)
    return
  }
  await setGitUserInfo(name, email)
}

export async function activate(context: ExtensionContext) {
  loadGitUsers(context)
  statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 0)
  statusBar.command = 'openInGitHub.openProject'
  statusBar.tooltip = '点击管理Git用户信息'
  await updateStatusBar()
  statusBar.show()

  commands.registerCommand('openInGitHub.openProject', async () => {
    const user = await getGitUserInfo()
    // 定义删除按钮
    const deleteButton: QuickInputButton = {
      iconPath: new ThemeIcon('trash'),
      tooltip: '删除该用户',
    }
    // 构造列表
    const picks: (QuickPickItem & { action?: string, user?: { name: string, email: string } })[] = gitUsers.map(u => ({
      label: `$(account) ${u.name}`,
      description: u.email + ((u.name === user.name && u.email === user.email) ? '（当前）' : ''),
      action: 'switch',
      user: u,
      picked: u.name === user.name && u.email === user.email,
      buttons: ((u.name === user.name && u.email === user.email) ? [] : [deleteButton] as any),
    }))
    picks.push({ label: '$(gear) 配置自定义Git用户名和邮箱', description: '手动输入', action: 'config' })
    picks.push({ label: '$(refresh) 刷新', description: '重新获取git用户信息', action: 'refresh' })

    // 使用 createQuickPick 以支持按钮事件
    const quickPick = window.createQuickPick<typeof picks[0]>()
    quickPick.items = picks
    quickPick.placeholder = '选择要切换的Git用户，或进行配置'
    quickPick.onDidTriggerItemButton(async (e) => {
      if (e.item.user && (e.item.user.name !== user.name || e.item.user.email !== user.email)) {
        gitUsers = gitUsers.filter(u => !(u.name === e.item.user!.name && u.email === e.item.user!.email))
        saveGitUsers()
        window.showInformationMessage(`已删除: ${e.item.user.name} <${e.item.user.email}>`)
        quickPick.items = gitUsers.map(u => ({
          label: `$(account) ${u.name}`,
          description: u.email + ((u.name === user.name && u.email === user.email) ? '（当前）' : ''),
          action: 'switch',
          user: u,
          picked: u.name === user.name && u.email === user.email,
          buttons: ((u.name === user.name && u.email === user.email) ? [] : [deleteButton] as any),
        }))
      }
    })
    quickPick.onDidAccept(async () => {
      const pick = quickPick.selectedItems[0]
      if (!pick) {
        quickPick.hide()
        return
      }
      if (pick.action === 'switch' && pick.user) {
        await setGitUserInfo(pick.user.name, pick.user.email)
        await updateStatusBar()
      }
      else if (pick.action === 'config') {
        await customSetGitUserInfo()
        await updateStatusBar()
      }
      else if (pick.action === 'refresh') {
        await updateStatusBar()
        window.showInformationMessage('Git 用户信息已刷新')
      }
      quickPick.hide()
    })
    quickPick.show()
  })

  commands.registerCommand('openInGitHub.configureUser', async () => {
    await customSetGitUserInfo()
    await updateStatusBar()
  })
}

async function updateStatusBar() {
  const user = await getGitUserInfo()
  statusBar.text = `$(github) ${user.name} <${user.email}>`
  statusBar.tooltip = `点击管理Git用户信息`
}

export function deactivate() {}
