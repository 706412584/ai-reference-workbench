import { useEffect, useState } from 'react'
import type { Settings } from '../settings'
import { DEFAULT_SETTINGS } from '../settings'
import { hasMcpHost, mcpLanIp, mcpRunning, mcpStart, mcpStop, platform } from '../native'
import Drawer from './Drawer'
import Select from './Select'
import { IconCopy } from '../icons'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
}

export default function SettingsPanel({
  settings,
  onChange,
  onClose,
  onToast,
  onCopy,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [lanIp, setLanIp] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  // 原生外壳注入的局域网地址（Android: __wbLanIpValue.get()）
  useEffect(() => {
    const w = window as unknown as {
      __wbLanIp?: string
      __wbLanIpValue?: { get: () => string }
    }
    try {
      if (w.__wbLanIpValue && typeof w.__wbLanIpValue.get === 'function') {
        const ip = w.__wbLanIpValue.get()
        if (ip) setLanIp(ip)
        return
      }
    } catch {
      /* 跨进程调用失败时回退 */
    }
    if (w.__wbLanIp) setLanIp(w.__wbLanIp)
  }, [])

  // 内置 MCP 状态
  useEffect(() => {
    setLanIp(mcpLanIp() || lanIp)
    setRunning(mcpRunning())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleMcp = () => {
    if (!hasMcpHost()) {
      onToast('当前环境无内置 MCP，请用 tools/mcp_server.py')
      return
    }
    setStarting(true)
    window.setTimeout(() => {
      if (running) {
        mcpStop()
        setRunning(false)
        onToast('MCP 已停止')
      } else {
        const ok = mcpStart(draft.mcpPort, draft.mcpLan)
        setRunning(ok)
        onToast(ok ? 'MCP 已启动' : 'MCP 启动失败，端口可能被占用')
      }
      setStarting(false)
    }, 60)
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft(d => ({ ...d, [key]: value }))

  const save = () => {
    onChange(draft)
    onToast('设置已保存')
    onClose()
  }

  const endpoint = `http://${draft.mcpLan && lanIp ? lanIp : '127.0.0.1'}:${draft.mcpPort}/mcp`

  return (
    <Drawer
      title="设置"
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={save}>
            保存
          </button>
          <button
            onClick={() => {
              setDraft(DEFAULT_SETTINGS)
              onToast('已恢复默认，记得保存')
            }}
          >
            恢复默认
          </button>
        </>
      }
    >
      <section className="set-group">
        <h4>MCP 服务</h4>
        <p className="set-hint">
          对外暴露只读索引，供外部 AI 按引用取图。默认仅本机可访问。
        </p>

        <label className="set-row">
          <span>端口</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={draft.mcpPort}
            onChange={e => set('mcpPort', Math.max(1024, Math.min(65535, Number(e.target.value) || 7801)))}
          />
        </label>

        <label className="set-row">
          <span>允许局域网访问</span>
          <input
            type="checkbox"
            checked={draft.mcpLan}
            onChange={e => set('mcpLan', e.target.checked)}
          />
        </label>

        <div className="set-row">
          <span>端点</span>
          <code className="set-code">{endpoint}</code>
          <button className="mini-btn" onClick={() => onCopy(endpoint, '已复制端点')}>
            <IconCopy size={13} />
          </button>
        </div>

        <div className="set-row">
          <span>
            内置服务
            <em className={'mcp-state' + (running ? ' on' : '')}>
              {hasMcpHost() ? (running ? '运行中' : '已停止') : '不可用'}
            </em>
          </span>
          <button
            className="mini-btn wide"
            disabled={starting || !hasMcpHost()}
            onClick={toggleMcp}
          >
            {starting ? '处理中' : running ? '停止' : '启动'}
          </button>
        </div>

        {draft.mcpLan && !lanIp && (
          <p className="set-warn">
            当前环境未提供局域网地址。Android/Windows 外壳会注入本机 IP；浏览器预览时仅能使用 127.0.0.1。
          </p>
        )}

        <div className="set-row">
          <span>运行平台</span>
          <code className="set-code">{platform()}</code>
        </div>
      </section>

      <section className="set-group">
        <h4>显示</h4>

        <div className="set-row">
          <span>每行卡片数（宽屏）</span>
          <Select
            value={String(draft.gridCols)}
            ariaLabel="每行卡片数"
            options={[3, 4, 5, 6].map(n => ({ value: String(n), label: String(n) }))}
            onChange={v => set('gridCols', Number(v))}
          />
        </div>

        <label className="set-row">
          <span>隐藏成人向分类</span>
          <input
            type="checkbox"
            checked={draft.hideAdult}
            onChange={e => set('hideAdult', e.target.checked)}
          />
        </label>

      </section>

      <section className="set-group">
        <h4>保存与复制</h4>

        <label className="set-row">
          <span>文件名前缀</span>
          <input
            type="text"
            value={draft.filePrefix}
            maxLength={24}
            onChange={e => set('filePrefix', e.target.value.replace(/[\\/:*?"<>|]/g, ''))}
          />
        </label>
      </section>

      <section className="set-group">
        <h4>提示词</h4>

        <div className="set-row">
          <span>默认技能</span>
          <Select
            value={draft.defaultSkill}
            ariaLabel="默认技能"
            options={[
              { value: 'none', label: '不使用' },
              { value: 'minimax', label: 'MiniMax H3' },
              { value: 'qwen', label: 'Qwen-Image' },
            ]}
            onChange={v => set('defaultSkill', v as Settings['defaultSkill'])}
          />
        </div>

        <div className="set-row">
          <span>默认输出语言</span>
          <Select
            value={draft.promptLang}
            ariaLabel="默认输出语言"
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
            onChange={v => set('promptLang', v as Settings['promptLang'])}
          />
        </div>

        <p className="set-hint">
          技能说明来自 MiniMax H3 的 h3-prompt-writing 与 Qwen-Image 的 prompt_utils_2512，
          已在提示词页面内置查看与复制。
        </p>
      </section>
    </Drawer>
  )
}
