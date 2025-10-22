import type { ExtensionContext, QuickInputButton, QuickPickItem, StatusBarItem } from 'vscode'
import { exec } from 'node:child_process'
import { commands, StatusBarAlignment, ThemeIcon, window } from 'vscode'
const STORAGE_KEY = 'openInGitHub.gitUsers'
const DEFAULT_USERS: { name: string, email: string, registry?: string }[] = []

let gitUsers: { name: string, email: string, registry?: string }[] = []
let statusBar: StatusBarItem
let contextRef: ExtensionContext
const execPromise = (cmd: string) => new Promise<string>((resolve) => {
  exec(cmd, (err, stdout) => {
    if (err)
      resolve('未知')
    else resolve(stdout.trim() || '未知')
  })
})

async function getGitUserInfo(): Promise<{ name: string, email: string }> {
  const name = await execPromise('git config --global user.name')
  const email = await execPromise('git config --global user.email')
  return { name, email }
}

async function getNpmRegistry(): Promise<string> {
  return await execPromise('npm config get registry')
}

function saveGitUsers() {
  if (contextRef)
    contextRef.globalState.update(STORAGE_KEY, gitUsers)
}
function loadGitUsers(context: ExtensionContext) {
  contextRef = context
  const stored = context.globalState.get<{ name: string, email: string, registry?: string }[]>(STORAGE_KEY)
  gitUsers = (stored && Array.isArray(stored) && stored.length > 0) ? stored : DEFAULT_USERS.slice()
}
async function setGitUserInfo(name: string, email: string, registry?: string) {
  await new Promise<void>((resolve) => {
    exec(`git config --global user.name "${name}"`, () => {
      exec(`git config --global user.email "${email}"`, () => {
        resolve()
      })
    })
  })
  
  // 如果有registry，也设置npm源
  if (registry) {
    await setNpmRegistry(registry)
  }
  
  // 自动加入到gitUsers并去重
  if (!gitUsers.find(u => u.name === name && u.email === email)) {
    gitUsers.unshift({ name, email, registry })
    // 最多保存10个
    gitUsers = gitUsers.slice(0, 10)
    saveGitUsers()
  }
  window.showInformationMessage(`已切换为: ${name} <${email}> ${registry ? `| npm源: ${registry}` : ''}`)
}
function isUrl(str: string): boolean {
  const urlRegex = /^https?:\/\/.+/
  return urlRegex.test(str)
}

async function setNpmRegistry(registry: string) {
  if (isUrl(registry)) {
    // 如果是URL，直接设置
    await new Promise<void>((resolve) => {
      exec(`npm config set registry "${registry}"`, () => {
        resolve()
      })
    })
  } else {
    // 如果是名称，使用nrm
    await new Promise<void>((resolve) => {
      exec(`nrm use "${registry}"`, () => {
        resolve()
      })
    })
  }
}
async function customSetGitUserInfo() {
  const name = await window.showInputBox({ prompt: '请输入新的Git用户名', placeHolder: 'user.name' })
  if (!name)
    return
  const email = await window.showInputBox({ prompt: '请输入新的Git邮箱', placeHolder: 'user.email' })
  if (!email)
    return
  const registry = await window.showInputBox({ 
    prompt: '请输入npm源名称或URL（可选）', 
    placeHolder: '例如: taobao 或 https://registry.npmmirror.com/' 
  })
  
  // 检查是否已存在
  if (gitUsers.find(u => u.name === name && u.email === email)) {
    window.showWarningMessage(`该用户配置已存在: ${name} <${email}>`)
    return
  }
  await setGitUserInfo(name, email, registry || undefined)
}

export async function activate(context: ExtensionContext) {
  loadGitUsers(context)
  statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 0)
  statusBar.command = 'openInGitHub.openProject'
  statusBar.tooltip = '点击管理Git用户信息和npm源'
  await updateStatusBar()
  statusBar.show()

  commands.registerCommand('openInGitHub.openProject', async () => {
    const user = await getGitUserInfo()
    const currentRegistry = await getNpmRegistry()
    // 定义按钮
    const deleteButton: QuickInputButton = {
      iconPath: new ThemeIcon('trash'),
      tooltip: '删除该配置',
    }
    const addButton: QuickInputButton = {
      iconPath: new ThemeIcon('add'),
      tooltip: '添加新配置',
    }
    const refreshButton: QuickInputButton = {
      iconPath: new ThemeIcon('refresh'),
      tooltip: '刷新',
    }
    
    // 构造列表
    const picks: (QuickPickItem & { action?: string, user?: { name: string, email: string, registry?: string } })[] = []
    
    gitUsers.forEach(u => {
      const isCurrent = u.name === user.name && u.email === user.email
      const registryDisplay = u.registry ? ` | ${u.registry}` : ''
      picks.push({
        label: `$(account) ${u.name}`,
        description: `${u.email}${registryDisplay}${isCurrent ? ' （当前）' : ''}`,
        action: 'switch',
        user: u,
        picked: isCurrent,
        buttons: isCurrent ? [] : [deleteButton] as any,
      })
    })

    // 使用 createQuickPick 以支持按钮事件
    const quickPick = window.createQuickPick<typeof picks[0]>()
    quickPick.items = picks
    quickPick.placeholder = '选择要切换的用户配置'
    quickPick.buttons = [addButton, refreshButton]
    quickPick.onDidTriggerButton(async (button) => {
      if (button === addButton) {
        await customSetGitUserInfo()
        await updateStatusBar()
        quickPick.hide()
      } else if (button === refreshButton) {
        await updateStatusBar()
        window.showInformationMessage('Git 用户信息和npm源已刷新')
        quickPick.hide()
      }
    })
    
    quickPick.onDidTriggerItemButton(async (e) => {
      if (e.item.user && (e.item.user.name !== user.name || e.item.user.email !== user.email)) {
        gitUsers = gitUsers.filter(u => !(u.name === e.item.user!.name && u.email === e.item.user!.email))
        saveGitUsers()
        window.showInformationMessage(`已删除: ${e.item.user.name} <${e.item.user.email}>`)
        // 重新构建列表
        const newPicks: (QuickPickItem & { action?: string, user?: { name: string, email: string, registry?: string } })[] = []
        gitUsers.forEach(u => {
          const isCurrent = u.name === user.name && u.email === user.email
          const registryDisplay = u.registry ? ` | ${u.registry}` : ''
          newPicks.push({
            label: `$(account) ${u.name}`,
            description: `${u.email}${registryDisplay}${isCurrent ? ' （当前）' : ''}`,
            action: 'switch',
            user: u,
            picked: isCurrent,
            buttons: isCurrent ? [] : [deleteButton] as any,
          })
        })
        quickPick.items = newPicks
      }
    })
    quickPick.onDidAccept(async () => {
      const pick = quickPick.selectedItems[0]
      if (!pick) {
        quickPick.hide()
        return
      }
      if (pick.action === 'switch' && pick.user) {
        await setGitUserInfo(pick.user.name, pick.user.email, pick.user.registry)
        await updateStatusBar()
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
  const registry = await getNpmRegistry()
  const currentUser = gitUsers.find(u => u.name === user.name && u.email === user.email)
  const registryDisplay = currentUser?.registry || registry
  statusBar.text = `$(github) ${user.name} | $(package) ${registryDisplay}`
  statusBar.tooltip = `点击管理Git用户信息和npm源`
}

export function deactivate() {}
