import { usePersisted } from './store'

export interface Settings {
  /** MCP 服务端口 */
  mcpPort: number
  /** 是否允许局域网访问 MCP */
  mcpLan: boolean
  /** 卡片每行最大数量（桌面） */
  gridCols: number
  /** 保存图片时使用的文件名前缀 */
  filePrefix: string
  /** 提示词默认使用哪套技能 */
  defaultSkill: 'none' | 'minimax' | 'qwen'
  /** 提示词默认输出语言 */
  promptLang: 'zh' | 'en'
  /** 隐藏成人向分类（内衣/性感） */
  hideAdult: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  mcpPort: 7801,
  mcpLan: false,
  gridCols: 4,
  filePrefix: 'wb',
  defaultSkill: 'none',
  promptLang: 'zh',
  hideAdult: false,
}

export function useSettings() {
  return usePersisted<Settings>('wb.settings', DEFAULT_SETTINGS)
}
