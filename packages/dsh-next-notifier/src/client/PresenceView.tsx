import * as React from 'react'
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Read the public layout hook on both 0.1.7 and desktop 0.2; publish only on commit. */
export function PresenceView({ usePanelInfo, onChange, children }: {
  usePanelInfo: UsePanelInfo
  onChange: (active: boolean) => void
  children: React.ReactNode
}): React.ReactElement {
  const active = usePanelInfo(info => info.activePanelId !== null)
  React.useLayoutEffect(() => { onChange(active) }, [active, onChange])
  return <>{children}</>
}
