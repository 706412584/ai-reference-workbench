import { useState } from 'react'
import type { ModelKind, Provider, ProviderConfig, ProviderModel } from '../providers'
import { DEFAULT_PROVIDER, fetchModels } from '../providers'
import Drawer from './Drawer'
import Select from './Select'
import { IconTrash } from '../icons'

interface Props {
  config: ProviderConfig
  onChange: (c: ProviderConfig) => void
  onClose: () => void
  onToast: (m: string) => void
}

const KIND_LABEL: Record<ModelKind, string> = {
  chat: '文本模型',
  image: '图片模型',
  video: '视频模型',
}

export default function ProviderPanel({ config, onChange, onClose, onToast }: Props) {
  const active = config.providers.find(p => p.id === config.activeId) || null
  const [syncing, setSyncing] = useState(false)
  const [draft, setDraft] = useState<Provider | null>(active)

  const update = (p: Provider) => {
    setDraft(p)
    onChange({
      ...config,
      providers: config.providers.map(x => (x.id === p.id ? p : x)),
    })
  }

  const addProvider = () => {
    const p: Provider = {
      ...DEFAULT_PROVIDER,
      id: 'p' + Date.now(),
      models: [],
      selected: { chat: '', image: '', video: '' },
    }
    onChange({ providers: config.providers.concat([p]), activeId: p.id })
    setDraft(p)
  }

  const removeProvider = (id: string) => {
    const rest = config.providers.filter(p => p.id !== id)
    onChange({ providers: rest, activeId: rest[0] ? rest[0].id : null })
    setDraft(rest[0] || null)
  }

  const sync = async () => {
    if (!draft) return
    if (!draft.baseUrl) {
      onToast('请先填写服务地址')
      return
    }
    setSyncing(true)
    try {
      const models = await fetchModels(draft)
      const next: Provider = { ...draft, models, lastSync: Date.now() }
      // 自动选中每类第一个可用模型
      const sel = { ...next.selected }
      for (const k of ['chat', 'image', 'video'] as ModelKind[]) {
        const list = models.filter(m => m.kind === k)
        if (list.length && !list.some(m => m.id === sel[k])) sel[k] = list[0].id
      }
      next.selected = sel
      update(next)
      onToast(`已获取 ${models.length} 个模型`)
    } catch (e) {
      onToast('获取失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSyncing(false)
    }
  }

  const modelsOf = (kind: ModelKind): ProviderModel[] =>
    (draft?.models || []).filter(m => m.kind === kind)

  return (
    <Drawer
      title="服务商"
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={addProvider}>
            新增服务商
          </button>
          {draft && (
            <button onClick={() => removeProvider(draft.id)}>
              <IconTrash size={13} /> 删除
            </button>
          )}
        </>
      }
    >
      {config.providers.length > 1 && (
        <div className="field">
          <span>选择服务商</span>
          <div className="skill-tabs">
            {config.providers.map(p => (
              <button
                key={p.id}
                className="skill-tab"
                aria-pressed={p.id === config.activeId}
                onClick={() => {
                  onChange({ ...config, activeId: p.id })
                  setDraft(p)
                }}
              >
                {p.label || '未命名'}
              </button>
            ))}
          </div>
        </div>
      )}

      {!draft ? (
        <div className="drawer-empty">
          还没有服务商。点「新增服务商」，填入 OpenAI 兼容地址即可。
        </div>
      ) : (
        <>
          <label className="field">
            <span>名称</span>
            <input
              value={draft.label}
              onChange={e => update({ ...draft, label: e.target.value })}
              placeholder="例如 本地网关"
            />
          </label>

          <label className="field">
            <span>服务地址</span>
            <input
              className="mono-input"
              value={draft.baseUrl}
              onChange={e => update({ ...draft, baseUrl: e.target.value })}
              placeholder="http://192.168.1.3:17990"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>API Key（可留空）</span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={e => update({ ...draft, apiKey: e.target.value })}
              placeholder="sk-..."
              autoComplete="off"
            />
          </label>

          <div className="field">
            <span>模型</span>
            <button className="chip-btn" onClick={sync} disabled={syncing}>
              {syncing ? '获取中…' : '从 /v1/models 获取'}
            </button>
            {draft.models.length === 0 && (
              <p className="set-hint" style={{ marginTop: 8 }}>
                拉取失败时可直接手填模型名（见下方输入框）。
              </p>
            )}
          </div>

          {(['chat', 'image', 'video'] as ModelKind[]).map(kind => {
            const list = modelsOf(kind)
            return (
              <label className="field" key={kind}>
                <span>{KIND_LABEL[kind]}</span>
                {list.length > 0 ? (
                  <Select
                    value={draft.selected[kind] || ''}
                    ariaLabel={KIND_LABEL[kind]}
                    options={[{ value: '', label: '（不指定）' }].concat(
                      list.map(m => ({
                        value: m.id,
                        label: m.name && m.name !== m.id ? `${m.id} · ${m.name}` : m.id,
                      })),
                    )}
                    onChange={v =>
                      update({
                        ...draft,
                        selected: { ...draft.selected, [kind]: v },
                      })
                    }
                  />
                ) : (
                  <input
                    className="mono-input"
                    value={draft.selected[kind] || ''}
                    onChange={e =>
                      update({
                        ...draft,
                        selected: { ...draft.selected, [kind]: e.target.value },
                      })
                    }
                    placeholder={
                      kind === 'video' ? '服务商若支持，填视频模型名' : '手动填写模型名'
                    }
                    spellCheck={false}
                  />
                )}
              </label>
            )
          })}

          {draft.models.length > 0 && (
            <p className="set-hint">
              共 {draft.models.length} 个模型：文本{' '}
              {modelsOf('chat').length} · 图片 {modelsOf('image').length} · 视频{' '}
              {modelsOf('video').length}
            </p>
          )}
        </>
      )}
    </Drawer>
  )
}
